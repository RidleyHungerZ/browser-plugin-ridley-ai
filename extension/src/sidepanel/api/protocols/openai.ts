import type { ContentBlock, StoredMessage } from '@/shared/types'
import { attachmentApi } from '../../storage/bridge'
import { parseSSE } from '../sse'
import type { ChatOptions, ProtocolAdapter, StreamEvent } from './types'

const IMAGE_CACHE_LIMIT = 24
const imageCache = new Map<string, string>()

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error ?? new Error('读取图片失败'))
    reader.readAsDataURL(blob)
  })
}

async function imageToDataUrl(hash: string, mime: string): Promise<string> {
  const key = `${hash}:${mime}`
  const cached = imageCache.get(key)
  if (cached) {
    imageCache.delete(key)
    imageCache.set(key, cached)
    return cached
  }
  const blob = await attachmentApi.getBlob(hash, mime)
  const dataUrl = await blobToDataUrl(blob)
  imageCache.set(key, dataUrl)
  while (imageCache.size > IMAGE_CACHE_LIMIT) {
    const first = imageCache.keys().next().value
    if (first === undefined) break
    imageCache.delete(first)
  }
  return dataUrl
}

function textOfBlock(block: ContentBlock): string {
  if (block.type === 'text' || block.type === 'reasoning') return block.text
  if (block.type === 'file') return block.text
  return ''
}

async function toWireMessages(
  messages: StoredMessage[],
  system?: string,
): Promise<Array<Record<string, unknown>>> {
  const wire: Array<Record<string, unknown>> = []
  if (system?.trim()) wire.push({ role: 'system', content: system.trim() })

  for (const message of messages) {
    if (message.role === 'system') {
      const text = message.blocks.map(textOfBlock).join('')
      if (text.trim()) wire.push({ role: 'system', content: text })
      continue
    }

    if (message.role === 'assistant') {
      const text = message.blocks
        .filter((block) => block.type === 'text')
        .map((block) => (block.type === 'text' ? block.text : ''))
        .join('')
      const calls = message.blocks.filter(
        (block): block is Extract<ContentBlock, { type: 'tool-call' }> =>
          block.type === 'tool-call',
      )

      if (calls.length > 0) {
        wire.push({
          role: 'assistant',
          content: text.trim() ? text : null,
          tool_calls: calls.map((call) => ({
            id: call.id,
            type: 'function',
            function: { name: call.name, arguments: call.arguments },
          })),
        })
      } else if (text.trim()) {
        wire.push({ role: 'assistant', content: text })
      }
      continue
    }

    if (message.role === 'tool') {
      for (const block of message.blocks) {
        if (block.type !== 'tool-result') continue
        wire.push({
          role: 'tool',
          tool_call_id: block.id,
          content: block.content,
        })
      }
      continue
    }

    const parts: Array<Record<string, unknown>> = []
    let hasImage = false

    for (const block of message.blocks) {
      if (block.type === 'text') {
        if (block.text) parts.push({ type: 'text', text: block.text })
      } else if (block.type === 'file') {
        parts.push({
          type: 'text',
          text: `[文件：${block.name}]\n\`\`\`\n${block.text}\n\`\`\``,
        })
      } else if (block.type === 'image') {
        hasImage = true
        parts.push({
          type: 'image_url',
          image_url: { url: await imageToDataUrl(block.hash, block.mime) },
        })
      }
    }

    if (parts.length === 0) continue
    if (hasImage) {
      wire.push({ role: 'user', content: parts })
    } else {
      // 引用内容、用户补充、文件内容之间用空行分隔，避免粘成一段
      const text = parts.map((part) => String(part.text ?? '')).join('\n\n')
      if (text.trim()) wire.push({ role: 'user', content: text })
    }
  }

  return wire
}

function resolveUrl(baseUrl: string, autoV1: boolean | undefined): string {
  let url = (baseUrl || '').trim().replace(/\/+$/, '')
  if (!url) throw new Error('未配置 Base URL')
  if (/\/chat\/completions$/i.test(url)) return url
  if (autoV1 !== false && !/\/v\d+$/i.test(url)) url += '/v1'
  return `${url}/chat/completions`
}

function errorHint(status: number): string {
  if (status === 401 || status === 403) return '认证失败，请检查 API Key'
  if (status === 404) return '接口地址不存在，请检查 Base URL'
  if (status === 413) return '请求体过大'
  if (status === 429) return '请求过于频繁或额度不足'
  if (status >= 500) return '服务端错误'
  if (status === 400) return '请求参数被拒绝'
  return `HTTP ${status}`
}

function extractError(body: string): string {
  try {
    const parsed = JSON.parse(body)
    return (
      parsed?.error?.message ||
      parsed?.message ||
      parsed?.error ||
      body.slice(0, 500)
    )
  } catch {
    return body.slice(0, 500) || '未知错误'
  }
}

async function* parseOpenAIStream(response: Response): AsyncGenerator<StreamEvent> {
  let doneEmitted = false
  const toolCalls = new Map<number, { id: string; name: string; arguments: string }>()

  const takeToolCalls = (): Array<{ id: string; name: string; arguments: string }> | null => {
    if (toolCalls.size === 0) return null
    const calls = [...toolCalls.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([, call], index) => ({
        id: call.id || `call_${Date.now()}_${index}`,
        name: call.name,
        arguments: call.arguments || '{}',
      }))
      .filter((call) => call.name.length > 0)
    toolCalls.clear()
    return calls.length > 0 ? calls : null
  }

  for await (const event of parseSSE(response)) {
    const data = event.data.trim()
    if (!data) continue
    if (data === '[DONE]') {
      const calls = takeToolCalls()
      if (calls) yield { type: 'tool-calls', calls }
      if (!doneEmitted) yield { type: 'done', finishReason: 'stop' }
      return
    }

    let json: any
    try {
      json = JSON.parse(data)
    } catch {
      continue
    }

    if (json?.error) {
      throw new Error(extractError(JSON.stringify(json)))
    }

    const choice = json?.choices?.[0]
    const delta = choice?.delta ?? choice?.message

    const rawCalls = delta?.tool_calls
    if (Array.isArray(rawCalls)) {
      for (const item of rawCalls) {
        const index = typeof item?.index === 'number' ? item.index : 0
        const entry = toolCalls.get(index) ?? { id: '', name: '', arguments: '' }
        if (typeof item?.id === 'string' && item.id) entry.id = item.id
        if (typeof item?.function?.name === 'string') entry.name += item.function.name
        if (typeof item?.function?.arguments === 'string') {
          entry.arguments += item.function.arguments
        }
        toolCalls.set(index, entry)
      }
    }

    const reasoning = delta?.reasoning_content ?? delta?.reasoning
    if (typeof reasoning === 'string' && reasoning.length > 0) {
      yield { type: 'reasoning', delta: reasoning }
    }

    const content = delta?.content
    if (typeof content === 'string' && content.length > 0) {
      yield { type: 'text', delta: content }
    } else if (Array.isArray(content)) {
      for (const part of content) {
        if (typeof part?.text === 'string' && part.text) {
          yield { type: 'text', delta: part.text }
        }
      }
    }

    if (json?.usage) {
      yield {
        type: 'usage',
        input: Number(json.usage.prompt_tokens ?? 0),
        output: Number(json.usage.completion_tokens ?? 0),
      }
    }

    if (choice?.finish_reason) {
      const calls = takeToolCalls()
      if (calls) yield { type: 'tool-calls', calls }
      doneEmitted = true
      yield { type: 'done', finishReason: String(choice.finish_reason) }
    }
  }

  const calls = takeToolCalls()
  if (calls) yield { type: 'tool-calls', calls }
  if (!doneEmitted) yield { type: 'done', finishReason: 'stop' }
}

export const openAICompletions: ProtocolAdapter = {
  id: 'openai-completions',
  label: 'OpenAI 兼容（chat/completions）',

  async buildRequest(options: ChatOptions) {
    const { provider, model, messages, system, maxTokens, temperature, tools, signal } = options
    const url = resolveUrl(provider.baseUrl, provider.autoV1)
    const wireMessages = await toWireMessages(messages, system)

    const body: Record<string, unknown> = {
      model: model.id,
      messages: wireMessages,
      stream: true,
    }

    const temp = temperature ?? model.temperature ?? provider.temperature
    if (temp !== undefined && temp !== null) body.temperature = temp
    if (maxTokens > 0) {
      if (model.useMaxCompletionTokens) body.max_completion_tokens = maxTokens
      else body.max_tokens = maxTokens
    }
    if (model.includeUsage !== false) {
      body.stream_options = { include_usage: true }
    }
    if (tools && tools.length > 0) {
      body.tools = tools
      body.tool_choice = 'auto'
    }
    if (model.extraBody) Object.assign(body, model.extraBody)

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    }
    if (provider.apiKey) headers.Authorization = `Bearer ${provider.apiKey}`
    if (provider.headers) Object.assign(headers, provider.headers)

    return {
      url,
      init: {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal,
      },
    }
  },

  async *parseStream(response: Response): AsyncGenerator<StreamEvent> {
    if (!response.ok) {
      const body = await response.text().catch(() => '')
      throw new Error(`${errorHint(response.status)}：${extractError(body)}`)
    }
    yield* parseOpenAIStream(response)
  },
}
