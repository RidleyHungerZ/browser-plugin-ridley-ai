import type { ModelConfig, ProtocolId, ProviderConfig, StoredMessage } from '@/shared/types'

export interface ToolCall {
  id: string
  name: string
  arguments: string
}

export interface WireTool {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
  }
}

export type StreamEvent =
  | { type: 'text'; delta: string }
  | { type: 'reasoning'; delta: string }
  | { type: 'usage'; input: number; output: number }
  | { type: 'tool-calls'; calls: ToolCall[] }
  | { type: 'done'; finishReason: string }

export interface ChatOptions {
  provider: ProviderConfig
  model: ModelConfig
  messages: StoredMessage[]
  system?: string
  maxTokens: number
  temperature?: number
  tools?: WireTool[]
  signal: AbortSignal
}

export interface ProtocolAdapter {
  id: ProtocolId
  label: string
  buildRequest(options: ChatOptions): Promise<{ url: string; init: RequestInit }>
  parseStream(response: Response): AsyncGenerator<StreamEvent>
}
