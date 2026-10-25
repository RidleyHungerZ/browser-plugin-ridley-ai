/** 全项目共享的类型与常量。 */

export type ProtocolId = 'openai-completions' | 'openai-responses' | 'anthropic-messages'

export interface ModelConfig {
  /** 发送给接口的 model 名 */
  id: string
  label?: string
  /** 上下文窗口（tokens） */
  contextWindow: number
  /** 单次最大输出（tokens） */
  maxOutput: number
  vision?: boolean
  reasoning?: boolean
  /** 是否允许该模型使用工具调用 */
  tools?: boolean
  temperature?: number
  /** 部分厂商要求 max_completion_tokens 而非 max_tokens */
  useMaxCompletionTokens?: boolean
  /** 是否发送 stream_options.include_usage（部分兼容端点会报错） */
  includeUsage?: boolean
  extraBody?: Record<string, unknown>
}

export interface ProviderConfig {
  id: string
  name: string
  protocol: ProtocolId
  baseUrl: string
  apiKey: string
  headers?: Record<string, string>
  temperature?: number
  /** baseUrl 未以 /v1 结尾时自动补上 */
  autoV1?: boolean
  models: ModelConfig[]
}

export interface UiPrefs {
  theme: 'light' | 'dark' | 'system'
  fontSize: number
  enterToSend: boolean
  /** 右键带入选区后的行为 */
  selectionBehavior: 'insert' | 'send'
  showReasoning: boolean
}

export interface AppSettings {
  version: 1
  providers: ProviderConfig[]
  /** providerId::modelId */
  activeModelKey: string
  recentModels: string[]
  ui: UiPrefs
  tools: ToolsSettings
}

export interface WebSearchToolSettings {
  enabled: boolean
  /** Anthropic 兼容 Messages 基址，不含 /messages */
  baseUrl: string
  apiKey: string
  model: string
  /** 每次调用返回给模型的最大来源数 */
  maxResults: number
  /** 单次搜索允许的原生工具调用次数 */
  maxUses: number
}

export interface WebFetchToolSettings {
  enabled: boolean
  /** local = 扩展直接抓取；remote = 走可配置的抓取服务 */
  mode: 'local' | 'remote'
  /** remote 模式的地址，支持 {url} 占位符；否则会追加 ?url= */
  baseUrl: string
  apiKey: string
  /** 返回给模型的最大字符数 */
  maxChars: number
  /** 本地抓取时是否允许 localhost / 内网地址 */
  allowPrivateHosts: boolean
}

export interface ToolsSettings {
  search: WebSearchToolSettings
  fetch: WebFetchToolSettings
  /** 单次提问最多执行多少轮工具调用（达到后让模型基于已有信息收尾） */
  maxRounds: number
}

export type ContentBlock =
  | { type: 'text'; text: string; quote?: boolean }
  | { type: 'reasoning'; text: string }
  | { type: 'image'; hash: string; mime: string; name?: string; width?: number; height?: number }
  | { type: 'file'; name: string; mime: string; text: string }
  | { type: 'tool-call'; id: string; name: string; arguments: string }
  | { type: 'tool-result'; id: string; name: string; content: string; isError?: boolean }

export interface Usage {
  input: number
  output: number
}

export interface StoredMessage {
  id: string
  role: 'system' | 'user' | 'assistant' | 'tool'
  blocks: ContentBlock[]
  createdAt: number
  /** providerId::modelId */
  model?: string
  usage?: Usage
  interrupted?: boolean
  error?: string
}

export interface SessionMeta {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  providerId: string
  modelId: string
  messageCount: number
  preview: string
  pinned?: boolean
  sourceUrl?: string
  sourceTitle?: string
  rev: number
}

export interface SessionMessagesPage {
  messages: StoredMessage[]
  /** 下一页游标（从旧到新的行号偏移），null 表示已到开头 */
  nextCursor: number | null
  total: number
}

export interface SessionListFilter {
  search?: string
  /** providerId::modelId */
  modelKey?: string
  since?: number
  pinnedOnly?: boolean
}

export type SessionSortField = 'createdAt' | 'updatedAt'
export type SortOrder = 'asc' | 'desc'

/** 右键菜单写入 storage.session 的待处理请求 */
export interface PendingAsk {
  nonce: string
  kind: 'ask' | 'call'
  text: string
  url: string
  title: string
  at: number
}

export const PENDING_ASK_KEY = 'pendingAsk'
export const NATIVE_HOST_NAME = 'com.ridley.ai'

export const modelKey = (providerId: string, modelId: string) => `${providerId}::${modelId}`

export const splitModelKey = (key: string): { providerId: string; modelId: string } => {
  const idx = key.indexOf('::')
  if (idx < 0) return { providerId: '', modelId: key }
  return { providerId: key.slice(0, idx), modelId: key.slice(idx + 2) }
}
