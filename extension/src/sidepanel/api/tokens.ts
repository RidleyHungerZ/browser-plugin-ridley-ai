import type { StoredMessage } from '@/shared/types'

function isCjk(code: number): boolean {
  return (
    (code >= 0x2e80 && code <= 0x9fff) ||
    (code >= 0xac00 && code <= 0xd7af) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xff00 && code <= 0xffef)
  )
}

/** 粗略估算：CJK 约 1 字 1 token，其余约 4 字符 1 token。 */
export function estimateTextTokens(text: string): number {
  let cjk = 0
  let other = 0
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0
    if (isCjk(code)) cjk++
    else other++
  }
  return Math.ceil(cjk * 1.1 + other / 4)
}

export function estimateMessageTokens(message: StoredMessage): number {
  let total = 4
  for (const block of message.blocks) {
    if (block.type === 'text' || block.type === 'reasoning') total += estimateTextTokens(block.text)
    else if (block.type === 'file') total += estimateTextTokens(block.text) + 8
    else if (block.type === 'image') total += 800
  }
  return total
}

export function estimateMessagesTokens(messages: StoredMessage[]): number {
  let total = 0
  for (const message of messages) total += estimateMessageTokens(message)
  return total
}

export interface TrimResult {
  messages: StoredMessage[]
  trimmedCount: number
  estimatedInput: number
}

/**
 * 保留最近的消息直到填满预算；裁剪后确保第一条不是 assistant。
 */
export function trimMessages(
  messages: StoredMessage[],
  contextWindow: number,
  maxOutput: number,
): TrimResult {
  const budget = Math.max(1024, contextWindow - maxOutput - 512)
  const kept: StoredMessage[] = []
  let total = 0

  for (let i = messages.length - 1; i >= 0; i--) {
    const cost = estimateMessageTokens(messages[i])
    if (kept.length > 0 && total + cost > budget) break
    total += cost
    kept.unshift(messages[i])
  }

  while (kept.length > 1 && kept[0].role === 'assistant') {
    kept.shift()
  }

  return {
    messages: kept,
    trimmedCount: messages.length - kept.length,
    estimatedInput: total,
  }
}
