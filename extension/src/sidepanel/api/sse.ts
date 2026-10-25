export interface SSEEvent {
  event: string
  data: string
}

function parseBlock(block: string): SSEEvent | null {
  const lines = block.split(/\r?\n/)
  let event = ''
  const data: string[] = []
  for (const line of lines) {
    if (!line || line.startsWith(':')) continue
    const idx = line.indexOf(':')
    const field = idx === -1 ? line : line.slice(0, idx)
    let value = idx === -1 ? '' : line.slice(idx + 1)
    if (value.startsWith(' ')) value = value.slice(1)
    if (field === 'event') event = value
    else if (field === 'data') data.push(value)
  }
  if (data.length === 0) return null
  return { event, data: data.join('\n') }
}

/** 解析 SSE 流；处理 CRLF、多行 data、跨 chunk 的 UTF-8 与结尾无空行。 */
export async function* parseSSE(response: Response): AsyncGenerator<SSEEvent> {
  if (!response.body) throw new Error('响应没有可读取的内容')

  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader()
  let buffer = ''

  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += value
      for (;;) {
        const match = /\r?\n\r?\n/.exec(buffer)
        if (!match) break
        const block = buffer.slice(0, match.index)
        buffer = buffer.slice(match.index + match[0].length)
        const parsed = parseBlock(block)
        if (parsed) yield parsed
      }
    }
    if (buffer.trim()) {
      const parsed = parseBlock(buffer)
      if (parsed) yield parsed
    }
  } finally {
    reader.releaseLock()
  }
}
