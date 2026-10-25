/**
 * Native Messaging 客户端。Service Worker 是唯一持有 native 端口的进程：
 * - 多个窗口/面板共享同一条连接，文件写天然串行；
 * - connectNative 打开的端口会保活 Service Worker。
 */
import { NATIVE_HOST_NAME } from '@/shared/types'

interface PendingEntry {
  resolve: (value: unknown) => void
  reject: (reason: Error) => void
  timer: ReturnType<typeof setTimeout>
}

let port: chrome.runtime.Port | null = null
let nextId = 1
let lastDisconnectReason: string | null = null
const pending = new Map<number, PendingEntry>()

function handleMessage(msg: unknown): void {
  const data = msg as { id?: unknown; ok?: unknown; result?: unknown; error?: { message?: string } }
  if (!data || typeof data.id !== 'number') return
  const entry = pending.get(data.id)
  if (!entry) return
  pending.delete(data.id)
  clearTimeout(entry.timer)
  if (data.ok) entry.resolve(data.result)
  else entry.reject(new Error(data.error?.message ?? '本地服务返回错误'))
}

function failAll(reason: string): void {
  for (const [id, entry] of pending) {
    clearTimeout(entry.timer)
    entry.reject(new Error(reason))
    pending.delete(id)
  }
}

function connect(): chrome.runtime.Port {
  if (port) return port
  const p = chrome.runtime.connectNative(NATIVE_HOST_NAME)
  p.onMessage.addListener(handleMessage)
  p.onDisconnect.addListener(() => {
    const reason = chrome.runtime.lastError?.message ?? '与本地服务的连接已断开'
    lastDisconnectReason = reason
    port = null
    failAll(reason)
  })
  port = p
  lastDisconnectReason = null
  return p
}

export function nativeRpc<T = unknown>(
  method: string,
  params?: unknown,
  timeoutMs = 20_000,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let p: chrome.runtime.Port
    try {
      p = connect()
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)))
      return
    }

    const id = nextId++
    const timer = setTimeout(() => {
      pending.delete(id)
      reject(new Error(`本地服务响应超时：${method}`))
    }, timeoutMs)

    pending.set(id, {
      resolve: resolve as (value: unknown) => void,
      reject,
      timer,
    })

    try {
      p.postMessage({ v: 1, id, method, params })
    } catch (err) {
      pending.delete(id)
      clearTimeout(timer)
      reject(err instanceof Error ? err : new Error(String(err)))
    }
  })
}

export function nativeStatus(): { connected: boolean; reason: string | null } {
  return { connected: port !== null, reason: lastDisconnectReason }
}
