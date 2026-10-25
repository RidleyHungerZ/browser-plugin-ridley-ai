import { create } from 'zustand'
import type { AppSettings, SessionMeta, StoredMessage } from '@/shared/types'

export interface AttachmentDraft {
  id: string
  kind: 'image' | 'file'
  name: string
  mime: string
  size: number
  hash?: string
  text?: string
  dataUrl?: string
  uploading?: boolean
  error?: string
}

export interface Quote {
  text: string
  url: string
  title: string
}

export type GenerationStatus = 'idle' | 'connecting' | 'thinking' | 'streaming' | 'tool'

export interface StreamingState {
  sessionId: string
  messageId: string
  text: string
  reasoning: string
  startedAt: number
  /** 本次请求因上下文预算被裁掉的历史消息条数 */
  trimmed: number
  /** 正在执行的工具（名称展示用） */
  tool?: string
}

export interface AppState {
  ready: boolean
  nativeError: string | null
  settings: AppSettings | null
  settingsError: string | null

  sessions: SessionMeta[]
  sessionsLoading: boolean

  activeSessionId: string | null
  activeMeta: SessionMeta | null
  messages: StoredMessage[]
  cursor: number | null
  hasMore: boolean
  messagesLoading: boolean
  messagesError: string | null

  draftText: string
  quote: Quote | null
  attachments: AttachmentDraft[]

  status: GenerationStatus
  streaming: StreamingState | null
  error: string | null

  historyOpen: boolean
  settingsOpen: boolean
}

export interface AppActions {
  patch(state: Partial<AppState>): void
  setDraftText(text: string): void
  setQuote(quote: Quote | null): void
  addAttachment(attachment: AttachmentDraft): void
  updateAttachment(id: string, patch: Partial<AttachmentDraft>): void
  removeAttachment(id: string): void
  clearComposer(): void
  reset(): void
}

const initialState: AppState = {
  ready: false,
  nativeError: null,
  settings: null,
  settingsError: null,

  sessions: [],
  sessionsLoading: false,

  activeSessionId: null,
  activeMeta: null,
  messages: [],
  cursor: null,
  hasMore: false,
  messagesLoading: false,
  messagesError: null,

  draftText: '',
  quote: null,
  attachments: [],

  status: 'idle',
  streaming: null,
  error: null,

  historyOpen: false,
  settingsOpen: false,
}

export const useAppStore = create<AppState & AppActions>((set) => ({
  ...initialState,

  patch: (state) => set(state),
  setDraftText: (draftText) => set({ draftText }),
  setQuote: (quote) => set({ quote }),
  addAttachment: (attachment) =>
    set((state) => ({ attachments: [...state.attachments, attachment] })),
  updateAttachment: (id, patch) =>
    set((state) => ({
      attachments: state.attachments.map((item) =>
        item.id === id ? { ...item, ...patch } : item,
      ),
    })),
  removeAttachment: (id) =>
    set((state) => ({ attachments: state.attachments.filter((item) => item.id !== id) })),
  clearComposer: () => set({ draftText: '', quote: null, attachments: [] }),
  reset: () => set({ ...initialState }),
}))

export const getState = () => useAppStore.getState()
