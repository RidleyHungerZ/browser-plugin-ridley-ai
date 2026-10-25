import type { ProtocolId } from '@/shared/types'
import { openAICompletions } from './openai'
import type { ProtocolAdapter } from './types'

export const PROTOCOLS: Array<{ id: ProtocolId; label: string; implemented: boolean }> = [
  { id: 'openai-completions', label: 'OpenAI 兼容 · chat/completions', implemented: true },
  { id: 'openai-responses', label: 'OpenAI Responses API（暂未支持）', implemented: false },
  { id: 'anthropic-messages', label: 'Anthropic Messages（暂未支持）', implemented: false },
]

export function getAdapter(id: ProtocolId): ProtocolAdapter {
  if (id === 'openai-completions') return openAICompletions
  throw new Error(`暂不支持该接口协议：${id}`)
}
