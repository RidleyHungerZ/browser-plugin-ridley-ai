/** Chrome native messaging 帧协议：4 字节本机字节序长度 + UTF-8 JSON。 */

const MAX_FRAME = 1024 * 1024 - 8

/**
 * @param {NodeJS.WriteStream['write']} rawWrite 未被打日志污染的原始写函数
 */
export function createSender(rawWrite) {
  return function send(message) {
    const body = Buffer.from(JSON.stringify(message), 'utf8')
    if (body.length > MAX_FRAME) {
      throw new Error(`outgoing frame too large: ${body.length} bytes`)
    }
    const head = Buffer.allocUnsafe(4)
    head.writeUInt32LE(body.length, 0)
    rawWrite(Buffer.concat([head, body]))
  }
}

/**
 * @param {NodeJS.ReadStream} stream
 * @param {(msg: any) => void} onMessage
 */
export function attachReader(stream, onMessage) {
  let buffer = Buffer.alloc(0)

  stream.on('data', (chunk) => {
    buffer = buffer.length ? Buffer.concat([buffer, chunk]) : chunk
    while (buffer.length >= 4) {
      const length = buffer.readUInt32LE(0)
      if (length > 64 * 1024 * 1024) {
        // 帧损坏，无法可靠恢复
        process.exit(1)
      }
      if (buffer.length < 4 + length) break
      const body = buffer.subarray(4, 4 + length)
      buffer = buffer.subarray(4 + length)
      let parsed
      try {
        parsed = JSON.parse(body.toString('utf8'))
      } catch {
        continue
      }
      onMessage(parsed)
    }
  })

  stream.on('end', () => process.exit(0))
  stream.on('error', () => process.exit(1))
  stream.resume()
}
