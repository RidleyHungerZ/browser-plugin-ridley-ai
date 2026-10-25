import type {
  AppSettings,
  SessionListFilter,
  SessionMeta,
  SessionMessagesPage,
  SessionSortField,
  SortOrder,
  StoredMessage,
} from '@/shared/types'

interface RpcEnvelope<T> {
  ok: boolean
  result?: T
  error?: { code?: string; message?: string }
}

function friendly(message: string): string {
  const lower = message.toLowerCase()
  if (lower.includes('native messaging host not found') || lower.includes('not registered')) {
    return '未找到本地服务。请先运行 pnpm host:install，然后完全重启浏览器。'
  }
  if (lower.includes('forbidden') || lower.includes('access to the specified native messaging host')) {
    return '本地服务拒绝了当前扩展 ID。请重新运行 pnpm host:install。'
  }
  if (lower.includes('disconnected') || lower.includes('connection')) {
    return '与本地服务的连接已断开。请重载扩展，或重新运行 pnpm host:install。'
  }
  return message
}

export async function rpc<T>(method: string, params?: unknown): Promise<T> {
  let response: RpcEnvelope<T> | undefined
  try {
    response = (await chrome.runtime.sendMessage({ type: 'native-rpc', method, params })) as
      | RpcEnvelope<T>
      | undefined
  } catch (err) {
    throw new Error('无法连接扩展后台，请在 chrome://extensions 中重新加载扩展。')
  }
  if (!response) throw new Error('后台没有响应，请重新加载扩展。')
  if (!response.ok) throw new Error(friendly(response.error?.message ?? '本地服务不可用'))
  return response.result as T
}

/* ---------------- settings ---------------- */

export const settingsApi = {
  read: () => rpc<AppSettings>('settings.read'),
  write: (settings: AppSettings) => rpc<AppSettings>('settings.write', { settings }),
}

/* ---------------- sessions ---------------- */

export const sessionApi = {
  list: (filter: SessionListFilter = {}, sort: SessionSortField = 'updatedAt', order: SortOrder = 'desc') =>
    rpc<SessionMeta[]>('session.list', { filter, sort, order }),
  getMeta: (id: string) => rpc<SessionMeta>('session.getMeta', { id }),
  getMessages: (id: string, cursor: number | null = null, limit = 20) =>
    rpc<SessionMessagesPage>('session.getMessages', { id, cursor, limit }),
  create: (input: {
    id: string
    title?: string
    providerId?: string
    modelId?: string
    sourceUrl?: string
    sourceTitle?: string
    createdAt?: number
  }) => rpc<SessionMeta>('session.create', input),
  updateMeta: (id: string, patch: Partial<SessionMeta>) =>
    rpc<SessionMeta>('session.updateMeta', { id, patch }),
  appendMessage: (id: string, message: StoredMessage) =>
    rpc<SessionMeta>('session.appendMessage', { id, message }),
  updateDraft: (id: string, draft: unknown) => rpc<{ ok: true }>('session.updateDraft', { id, draft }),
  getDraft: (id: string) =>
    rpc<{ messageId: string; text: string; reasoning: string; at: number } | null>(
      'session.getDraft',
      { id },
    ),
  clearDraft: (id: string) => rpc<{ ok: true }>('session.clearDraft', { id }),
  delete: (id: string) => rpc<{ ok: true }>('session.delete', { id }),
}

/* ---------------- attachments ---------------- */

const CHUNK_BYTES = 3 * 1024 * 1024

export async function sha256Hex(data: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', data)
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const step = 0x8000
  for (let i = 0; i < bytes.length; i += step) {
    binary += String.fromCharCode(...bytes.subarray(i, i + step))
  }
  return btoa(binary)
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

export const attachmentApi = {
  /** 分块写入，避免单条 native 消息过大 */
  async put(bytes: Uint8Array): Promise<string> {
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
    const hash = await sha256Hex(buffer)
    for (let offset = 0; offset < bytes.length; offset += CHUNK_BYTES) {
      const chunk = bytes.subarray(offset, offset + CHUNK_BYTES)
      await rpc('attachment.put', { hash, base64: bytesToBase64(chunk), offset })
    }
    return hash
  },

  async getBlob(hash: string, mime: string): Promise<Blob> {
    const parts: Uint8Array[] = []
    let offset = 0
    for (;;) {
      const res = await rpc<{ data: string; offset: number; size: number; total: number }>(
        'attachment.get',
        { hash, offset, size: 512 * 1024 },
      )
      if (res.size > 0) parts.push(base64ToBytes(res.data))
      offset += res.size
      if (res.size === 0 || offset >= res.total) break
    }
    return new Blob(parts as BlobPart[], { type: mime })
  },
}
