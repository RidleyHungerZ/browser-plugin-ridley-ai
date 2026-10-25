import {
  PENDING_ASK_KEY,
  splitModelKey,
  type AppSettings,
  type ContentBlock,
  type PendingAsk,
  type SessionMeta,
  type StoredMessage,
  type Usage,
} from '@/shared/types'
import { attachmentApi, sessionApi, settingsApi } from '../storage/bridge'
import { getAdapter } from '../api/protocols'
import type { ToolCall } from '../api/protocols/types'
import { estimateMessagesTokens, trimMessages } from '../api/tokens'
import { executeToolCall } from '../tools'
import { buildToolDefinitions, toolDisplayName } from '../tools/definitions'
import { toast } from '../ui/Toast'
import { getState, useAppStore, type AttachmentDraft, type Quote } from './store'

function errorMessage(err: unknown): string {
  if (err instanceof Error) {
    if (err.name === 'AbortError') return '已停止生成'
    return err.message
  }
  return String(err)
}

export function applyTheme(theme: 'light' | 'dark' | 'system'): void {
  const media = window.matchMedia('(prefers-color-scheme: dark)')
  const apply = () => {
    const dark = theme === 'dark' || (theme === 'system' && media.matches)
    document.documentElement.dataset.theme = dark ? 'dark' : 'light'
  }
  apply()
  try {
    localStorage.setItem('ridley.theme', theme)
  } catch {
    /* ignore */
  }
}

export function watchSystemTheme(): () => void {
  const media = window.matchMedia('(prefers-color-scheme: dark)')
  const onChange = () => {
    const theme = getState().settings?.ui.theme ?? 'system'
    if (theme === 'system') applyTheme('system')
  }
  media.addEventListener('change', onChange)
  return () => media.removeEventListener('change', onChange)
}

/* ---------------- bootstrap ---------------- */

let bootstrapped = false
/** 本次浏览器启动后的第一次「呼叫」要新开会话，不再恢复上次会话 */
let suppressLastSessionRestore = false

/**
 * chrome.storage.session 会随浏览器重启清空，用它区分「本次启动后的第一次呼叫」。
 * @returns 是否是本次启动后的第一次呼叫
 */
async function consumeLaunchCall(): Promise<boolean> {
  try {
    const stored = await chrome.storage.session.get('callOpenedThisLaunch')
    if (stored?.callOpenedThisLaunch) return false
    await chrome.storage.session.set({ callOpenedThisLaunch: true })
    return true
  } catch {
    return false
  }
}

export async function bootstrap(): Promise<void> {
  if (bootstrapped) return
  bootstrapped = true
  const state = getState()
  try {
    const settings = await settingsApi.read()
    state.patch({ settings, ready: true, settingsError: null, nativeError: null })
    applyTheme(settings.ui.theme)
    await refreshSessions()

    // 重开面板时回到上次的会话（本次启动的第一次「呼叫」例外）
    try {
      const stored = await chrome.storage.local.get('lastSessionId')
      const last = stored?.lastSessionId as string | undefined
      if (
        !suppressLastSessionRestore &&
        last &&
        getState().sessions.some((session) => session.id === last)
      ) {
        void openSession(last)
      }
    } catch {
      /* ignore */
    }
  } catch (err) {
    state.patch({ ready: true, settingsError: errorMessage(err) })
  }
}

export async function refreshSessions(): Promise<void> {
  const state = getState()
  state.patch({ sessionsLoading: true })
  try {
    const sessions = await sessionApi.list({}, 'updatedAt', 'desc')
    state.patch({ sessions, sessionsLoading: false })
  } catch {
    state.patch({ sessionsLoading: false })
  }
}

export async function saveSettings(next: AppSettings): Promise<void> {
  useAppStore.getState().patch({ settings: next })
  applyTheme(next.ui.theme)
  await settingsApi.write(next)
}

export async function setActiveModel(key: string): Promise<void> {
  const state = getState()
  if (!state.settings) return
  const recentModels = [key, ...state.settings.recentModels.filter((item) => item !== key)].slice(0, 6)
  try {
    await saveSettings({ ...state.settings, activeModelKey: key, recentModels })
  } catch (err) {
    toast(`保存模型选择失败：${errorMessage(err)}`, 'error')
  }
}

export function resolveActiveModel(settings: AppSettings) {
  const { providerId, modelId } = splitModelKey(settings.activeModelKey)
  const provider = settings.providers.find((item) => item.id === providerId)
  const model = provider?.models.find((item) => item.id === modelId)
  return { provider, model, providerId, modelId }
}

/* ---------------- sessions ---------------- */

export function startNewSession(options?: {
  quote?: Quote
  keepComposer?: boolean
  force?: boolean
}): void {
  const state = getState()
  if (
    !options?.force &&
    !state.activeSessionId &&
    state.messages.length === 0 &&
    !options?.quote
  ) {
    return
  }
  void chrome.storage.local.remove('lastSessionId').catch(() => {})
  state.patch({
    activeSessionId: null,
    activeMeta: null,
    messages: [],
    cursor: null,
    hasMore: false,
    messagesError: null,
    error: null,
  })
  if (!options?.keepComposer) state.clearComposer()
  if (options?.quote) state.setQuote(options.quote)
}

export async function openSession(id: string): Promise<void> {
  const state = getState()
  if (state.activeSessionId === id && state.messages.length > 0) return
  void chrome.storage.local.set({ lastSessionId: id }).catch(() => {})
  state.patch({
    activeSessionId: id,
    messages: [],
    cursor: null,
    hasMore: false,
    messagesLoading: true,
    messagesError: null,
    error: null,
  })
  try {
    const [meta, page] = await Promise.all([
      sessionApi.getMeta(id),
      sessionApi.getMessages(id, null, 30),
    ])
    const current = getState()
    if (current.activeSessionId !== id) return
    current.patch({
      activeMeta: meta,
      messages: page.messages,
      cursor: page.nextCursor,
      hasMore: page.nextCursor !== null,
      messagesLoading: false,
    })
    if (meta.providerId && meta.modelId) {
      const key = `${meta.providerId}::${meta.modelId}`
      if (current.settings && current.settings.activeModelKey !== key) {
        const next = { ...current.settings, activeModelKey: key }
        current.patch({ settings: next })
        void settingsApi.write(next).catch(() => {})
      }
    }

    await recoverDraft(id)
  } catch (err) {
    const current = getState()
    if (current.activeSessionId !== id) return
    current.patch({ messagesLoading: false, messagesError: errorMessage(err) })
  }
}

/**
 * 面板在生成过程中被关闭时，host 里会留下 draft.json。
 * 重新打开该会话时把它落成一条「已中断」的助手消息，避免内容丢失或重复恢复。
 */
async function recoverDraft(sessionId: string): Promise<void> {
  const state = getState()
  if (state.status !== 'idle' && state.streaming?.sessionId === sessionId) return

  try {
    const draft = await sessionApi.getDraft(sessionId)
    if (!draft || (!draft.text && !draft.reasoning)) return
    if (getState().activeSessionId !== sessionId) return

    const messageId = draft.messageId || crypto.randomUUID()
    if (getState().messages.some((item) => item.id === messageId)) {
      await sessionApi.clearDraft(sessionId)
      return
    }

    const blocks: ContentBlock[] = []
    if (draft.reasoning) blocks.push({ type: 'reasoning', text: draft.reasoning })
    if (draft.text) blocks.push({ type: 'text', text: draft.text })

    const message: StoredMessage = {
      id: messageId,
      role: 'assistant',
      blocks,
      createdAt: draft.at || Date.now(),
      interrupted: true,
    }

    const meta = await sessionApi.appendMessage(sessionId, message)
    await sessionApi.clearDraft(sessionId)
    const latest = getState()
    if (latest.activeSessionId === sessionId) {
      latest.patch({
        messages: [...latest.messages, message],
        activeMeta: latest.activeMeta?.id === sessionId ? meta : latest.activeMeta,
      })
    }
    void refreshSessions()
  } catch {
    /* 草稿恢复失败不影响正常使用 */
  }
}

export async function loadMoreMessages(): Promise<void> {
  const state = getState()
  if (!state.activeSessionId || state.cursor === null || state.messagesLoading) return
  state.patch({ messagesLoading: true })
  try {
    const page = await sessionApi.getMessages(state.activeSessionId, state.cursor, 30)
    const current = getState()
    current.patch({
      messages: [...page.messages, ...current.messages],
      cursor: page.nextCursor,
      hasMore: page.nextCursor !== null,
      messagesLoading: false,
    })
  } catch (err) {
    getState().patch({ messagesLoading: false, messagesError: errorMessage(err) })
  }
}

export async function renameSession(id: string, title: string): Promise<void> {
  const trimmed = title.trim()
  if (!trimmed) return
  const meta = await sessionApi.updateMeta(id, { title: trimmed })
  const state = getState()
  state.patch({
    sessions: state.sessions.map((item) => (item.id === id ? meta : item)),
    activeMeta: state.activeMeta?.id === id ? meta : state.activeMeta,
  })
}

export async function togglePin(id: string): Promise<void> {
  const state = getState()
  const target = state.sessions.find((item) => item.id === id)
  const meta = await sessionApi.updateMeta(id, { pinned: !target?.pinned })
  getState().patch({
    sessions: getState().sessions.map((item) => (item.id === id ? meta : item)),
    activeMeta: getState().activeMeta?.id === id ? meta : getState().activeMeta,
  })
}

export async function deleteSession(id: string): Promise<void> {
  await sessionApi.delete(id)
  const state = getState()
  state.patch({ sessions: state.sessions.filter((item) => item.id !== id) })
  if (state.activeSessionId === id) {
    startNewSession()
  }
}

/* ---------------- composer ---------------- */

export async function addAttachments(files: FileList | File[]): Promise<void> {
  for (const file of Array.from(files)) {
    const id = crypto.randomUUID()
    const isImage = file.type.startsWith('image/')
    const isText =
      file.type.startsWith('text/') ||
      /\.(txt|md|markdown|json|ya?ml|csv|tsv|log|xml|html|css|js|ts|tsx|jsx|py|java|go|rs|c|h|cpp|sql|sh)$/i.test(
        file.name,
      )

    if (isImage) {
      const state = getState()
      state.addAttachment({
        id,
        kind: 'image',
        name: file.name,
        mime: file.type || 'image/png',
        size: file.size,
        uploading: true,
      })
      try {
        const bytes = new Uint8Array(await file.arrayBuffer())
        const hash = await attachmentApi.put(bytes)
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader()
          reader.onload = () => resolve(String(reader.result))
          reader.onerror = () => reject(reader.error)
          reader.readAsDataURL(file)
        })
        getState().updateAttachment(id, { hash, dataUrl, uploading: false })
      } catch (err) {
        getState().updateAttachment(id, { uploading: false, error: errorMessage(err) })
        toast(`图片上传失败：${errorMessage(err)}`, 'error')
      }
      continue
    }

    if (isText && file.size <= 2 * 1024 * 1024) {
      try {
        const text = await file.text()
        getState().addAttachment({
          id,
          kind: 'file',
          name: file.name,
          mime: file.type || 'text/plain',
          size: file.size,
          text,
        })
      } catch (err) {
        toast(`读取文件失败：${errorMessage(err)}`, 'error')
      }
      continue
    }

    toast(`暂不支持该文件类型：${file.name}`, 'error')
  }
}

function composerBlocks(): ContentBlock[] {
  const state = getState()
  const blocks: ContentBlock[] = []
  if (state.quote?.text) blocks.push({ type: 'text', text: state.quote.text, quote: true })
  if (state.draftText.trim()) blocks.push({ type: 'text', text: state.draftText.trim() })
  for (const attachment of state.attachments) {
    if (attachment.kind === 'image' && attachment.hash) {
      blocks.push({
        type: 'image',
        hash: attachment.hash,
        mime: attachment.mime,
        name: attachment.name,
      })
    } else if (attachment.kind === 'file' && attachment.text) {
      blocks.push({
        type: 'file',
        name: attachment.name,
        mime: attachment.mime,
        text: attachment.text,
      })
    }
  }
  return blocks
}

function deriveTitle(blocks: ContentBlock[]): string {
  const text = blocks
    .filter((block): block is Extract<ContentBlock, { type: 'text' }> => block.type === 'text')
    .map((block) => block.text)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!text) return '新会话'
  return text.length > 30 ? `${text.slice(0, 30)}…` : text
}

/* ---------------- generation ---------------- */

let abortController: AbortController | null = null
let draftTimer: ReturnType<typeof setTimeout> | null = null
let lastDraftAt = 0

export async function send(): Promise<void> {
  const state = getState()
  if (state.status !== 'idle') return

  const settings = state.settings
  if (!settings) return

  const blocks = composerBlocks()
  if (blocks.length === 0) return

  const { provider, model, providerId, modelId } = resolveActiveModel(settings)
  if (!provider || !model) {
    toast('当前模型不可用，请在设置中重新选择', 'error')
    return
  }

  const sessionId = state.activeSessionId ?? crypto.randomUUID()
  const now = Date.now()
  const userMessage: StoredMessage = {
    id: crypto.randomUUID(),
    role: 'user',
    blocks,
    createdAt: now,
    model: settings.activeModelKey,
  }

  state.clearComposer()

  try {
    if (!state.activeSessionId) {
      const meta = await sessionApi.create({
        id: sessionId,
        title: deriveTitle(blocks),
        providerId,
        modelId,
        sourceUrl: state.quote?.url,
        sourceTitle: state.quote?.title,
        createdAt: now,
      })
      getState().patch({
        activeSessionId: sessionId,
        activeMeta: meta,
        messages: [],
        cursor: null,
        hasMore: false,
      })
      void chrome.storage.local.set({ lastSessionId: sessionId }).catch(() => {})
    } else if (
      state.activeMeta &&
      (state.activeMeta.providerId !== providerId || state.activeMeta.modelId !== modelId)
    ) {
      const meta = await sessionApi.updateMeta(sessionId, { providerId, modelId })
      getState().patch({ activeMeta: meta })
    }

    const meta = await sessionApi.appendMessage(sessionId, userMessage)
    getState().patch({
      messages: [...getState().messages, userMessage],
      activeMeta: meta,
      error: null,
    })
    void refreshSessions()
  } catch (err) {
    getState().patch({ error: errorMessage(err) })
    toast(errorMessage(err), 'error')
    return
  }

  await runGeneration(sessionId, provider, model)
}

const DEFAULT_MAX_TOOL_ROUNDS = 5

async function runGeneration(
  sessionId: string,
  provider: NonNullable<ReturnType<typeof resolveActiveModel>['provider']>,
  model: NonNullable<ReturnType<typeof resolveActiveModel>['model']>,
): Promise<void> {
  const startedAt = Date.now()
  const controller = new AbortController()
  abortController = controller
  lastDraftAt = 0

  const settings = getState().settings
  const toolDefs = settings ? buildToolDefinitions(settings.tools) : []
  const activeTools = model.tools === false ? [] : toolDefs
  const maxToolRounds = Math.min(
    10,
    Math.max(1, Math.round(settings?.tools.maxRounds ?? DEFAULT_MAX_TOOL_ROUNDS)),
  )
  const conversation: StoredMessage[] = [...getState().messages]

  let rounds = 0
  let toolRounds = 0
  let toolsAllowed = activeTools.length > 0

  try {
    // 正常轮次 + 一轮「不带工具」的收尾请求，再加几轮保险
    while (!controller.signal.aborted && rounds < maxToolRounds + 3) {
      rounds++
      const assistantId = crypto.randomUUID()
      let text = ''
      let reasoning = ''
      let roundUsage: Usage | undefined
      const toolCalls: ToolCall[] = []
      let flushTimer: ReturnType<typeof setTimeout> | null = null

      getState().patch({
        status: rounds === 1 ? 'connecting' : 'thinking',
        streaming: {
          sessionId,
          messageId: assistantId,
          text: '',
          reasoning: '',
          startedAt,
          trimmed: 0,
        },
        error: null,
      })

      const scheduleFlush = () => {
        if (flushTimer) return
        flushTimer = setTimeout(() => {
          flushTimer = null
          const current = getState()
          if (current.streaming?.messageId !== assistantId) return
          current.patch({
            status: text ? 'streaming' : reasoning ? 'thinking' : 'connecting',
            streaming: { ...current.streaming, text, reasoning },
          })
          if (Date.now() - lastDraftAt > 1500) {
            lastDraftAt = Date.now()
            void sessionApi
              .updateDraft(sessionId, { messageId: assistantId, text, reasoning, at: Date.now() })
              .catch(() => {})
          }
        }, 60)
      }

      try {
        const {
          messages: trimmed,
          estimatedInput,
          trimmedCount,
        } = trimMessages(conversation, model.contextWindow, model.maxOutput)
        if (trimmedCount > 0) {
          const current = getState()
          if (current.streaming?.messageId === assistantId) {
            current.patch({ streaming: { ...current.streaming, trimmed: trimmedCount } })
          }
        }
        const maxTokens = Math.max(
          256,
          Math.min(model.maxOutput, model.contextWindow - estimatedInput - 512),
        )

        const adapter = getAdapter(provider.protocol)
        const { url, init } = await adapter.buildRequest({
          provider,
          model,
          messages: trimmed,
          maxTokens,
          tools: toolsAllowed && activeTools.length > 0 ? activeTools : undefined,
          signal: controller.signal,
        })

        const response = await fetch(url, init)
        for await (const event of adapter.parseStream(response)) {
          if (event.type === 'text') {
            text += event.delta
            scheduleFlush()
          } else if (event.type === 'reasoning') {
            reasoning += event.delta
            scheduleFlush()
          } else if (event.type === 'usage') {
            roundUsage = { input: event.input, output: event.output }
          } else if (event.type === 'tool-calls') {
            toolCalls.push(...event.calls)
          }
        }
      } catch (err) {
        if (flushTimer) clearTimeout(flushTimer)
        const aborted = controller.signal.aborted
        const blocks: ContentBlock[] = []
        if (reasoning) blocks.push({ type: 'reasoning', text: reasoning })
        if (text) blocks.push({ type: 'text', text })
        if (blocks.length === 0) {
          blocks.push({ type: 'text', text: aborted ? '（已停止）' : '（请求失败）' })
        }

        await persistMessage(sessionId, {
          id: assistantId,
          role: 'assistant',
          blocks,
          createdAt: Date.now(),
          model: settings?.activeModelKey,
          interrupted: aborted || undefined,
          error: aborted ? undefined : errorMessage(err),
        })

        if (!aborted) {
          getState().patch({ error: errorMessage(err) })
          toast(errorMessage(err), 'error')
        }
        return
      } finally {
        if (flushTimer) clearTimeout(flushTimer)
      }

      const blocks: ContentBlock[] = []
      if (reasoning) blocks.push({ type: 'reasoning', text: reasoning })
      if (text) blocks.push({ type: 'text', text })
      for (const call of toolCalls) {
        blocks.push({ type: 'tool-call', id: call.id, name: call.name, arguments: call.arguments })
      }
      if (blocks.length === 0) blocks.push({ type: 'text', text: '（空响应）' })

      const assistantMessage: StoredMessage = {
        id: assistantId,
        role: 'assistant',
        blocks,
        createdAt: Date.now(),
        model: settings?.activeModelKey,
        usage: roundUsage,
      }
      await persistMessage(sessionId, assistantMessage)
      conversation.push(assistantMessage)

      if (toolCalls.length === 0) break

      // 收尾轮（不带工具）理论上不会再请求工具；若模型仍然请求，补结果并结束，
      // 保证 tool_call 与 tool_result 成对出现，会话下次还能继续。
      if (!toolsAllowed) {
        const toolMessage: StoredMessage = {
          id: crypto.randomUUID(),
          role: 'tool',
          blocks: toolCalls.map((call) => ({
            type: 'tool-result' as const,
            id: call.id,
            name: call.name,
            content: '工具调用已停用，请直接回答。',
            isError: true,
          })),
          createdAt: Date.now(),
        }
        await persistMessage(sessionId, toolMessage)
        break
      }

      const atLimit = toolRounds >= maxToolRounds
      if (!atLimit) toolRounds++

      // 执行工具（串行）；达到上限时不再执行，而是把「已到上限」作为结果回填给模型
      const settled: Array<{ call: ToolCall; result: { content: string; isError: boolean } }> = []
      for (const call of toolCalls) {
        if (atLimit) {
          settled.push({
            call,
            result: {
              content: `已达到工具调用上限（本次最多 ${maxToolRounds} 轮）。请基于目前已经获得的信息直接回答用户，不要再请求工具。`,
              isError: true,
            },
          })
          continue
        }
        if (controller.signal.aborted) {
          settled.push({ call, result: { content: '工具执行已取消', isError: true } })
          continue
        }
        const current = getState()
        if (current.streaming?.sessionId === sessionId) {
          current.patch({
            status: 'tool',
            streaming: { ...current.streaming, tool: toolDisplayName(call.name) },
          })
        }
        const result = settings
          ? await executeToolCall(call, settings, controller.signal)
          : { content: '设置未加载', isError: true }
        settled.push({ call, result })
      }

      const toolMessage: StoredMessage = {
        id: crypto.randomUUID(),
        role: 'tool',
        blocks: settled.map(({ call, result }) => ({
          type: 'tool-result' as const,
          id: call.id,
          name: call.name,
          content: result.content,
          isError: result.isError,
        })),
        createdAt: Date.now(),
      }
      await persistMessage(sessionId, toolMessage)
      conversation.push(toolMessage)

      if (atLimit) {
        // 下一轮不带工具，让模型基于已有结果收尾
        toolsAllowed = false
        toast(`工具调用已达上限（${maxToolRounds} 轮），正在基于已有结果收尾`, 'info')
      }

      if (controller.signal.aborted) break
    }
  } finally {
    if (abortController === controller) abortController = null
    getState().patch({ status: 'idle', streaming: null })
  }
}

async function persistMessage(sessionId: string, message: StoredMessage): Promise<void> {
  try {
    const meta = await sessionApi.appendMessage(sessionId, message)
    await sessionApi.clearDraft(sessionId)
    const latest = getState()
    latest.patch({
      activeMeta: latest.activeMeta?.id === sessionId ? meta : latest.activeMeta,
      messages:
        latest.activeSessionId === sessionId ? [...latest.messages, message] : latest.messages,
    })
    void refreshSessions()
  } catch (err) {
    toast(`保存消息失败：${errorMessage(err)}`, 'error')
  }
}

export function stop(): void {
  abortController?.abort()
}

/* ---------------- pending ask from context menu ---------------- */

let lastPendingKey = ''
let lastPendingNonce = ''
let pendingTextApplied = false

export function processPendingAsk(pending: PendingAsk): void {
  if (!pending) return
  const key = `${pending.nonce}:${pending.at}`
  if (key === lastPendingKey) return
  lastPendingKey = key

  if (pending.nonce !== lastPendingNonce) {
    lastPendingNonce = pending.nonce
    pendingTextApplied = false
  }

  if (pending.kind !== 'ask') {
    void consumeLaunchCall().then((freshLaunch) => {
      if (freshLaunch) {
        // 浏览器本次启动后的第一次「呼叫」：从空白会话开始
        suppressLastSessionRestore = true
        startNewSession({ force: true })
      }
      focusComposer()
    })
    return
  }

  // 占位事件（selectionText 可能为空）：等注入脚本返回全量文本
  if (!pending.text) return

  const quote: Quote = { text: pending.text, url: pending.url, title: pending.title }

  if (pendingTextApplied) {
    // 同一请求的全量文本覆盖占位内容，不重复建会话
    getState().setQuote(quote)
    return
  }
  pendingTextApplied = true

  const state = getState()
  if (state.messages.length > 0 || state.activeSessionId) {
    startNewSession({ keepComposer: false })
  }
  getState().setQuote(quote)
  focusComposer()

  if (getState().settings?.ui.selectionBehavior === 'send') {
    void send()
  }
}

export function focusComposer(): void {
  window.dispatchEvent(new CustomEvent('ridley:focus-composer'))
}

export function watchPendingAsk(): () => void {
  void chrome.storage.session.get(PENDING_ASK_KEY).then((result) => {
    const pending = result?.[PENDING_ASK_KEY] as PendingAsk | undefined
    if (pending) processPendingAsk(pending)
  })
  const listener = (changes: { [key: string]: chrome.storage.StorageChange }) => {
    const change = changes[PENDING_ASK_KEY]
    if (change?.newValue) processPendingAsk(change.newValue as PendingAsk)
  }
  chrome.storage.session.onChanged.addListener(listener)
  return () => chrome.storage.session.onChanged.removeListener(listener)
}
