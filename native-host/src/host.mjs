import { createSender, attachReader } from './protocol.mjs'
import { Store } from './store.mjs'
import { createRpc } from './rpc.mjs'
import { initLogger, log } from './logger.mjs'

// ── 先隔离 stdout ────────────────────────────────────────────────
// Native messaging 的 stdout 只允许协议帧。任何日志、依赖库输出、
// console.log 都必须改道 stderr，否则会破坏帧边界。
const rawWrite = process.stdout.write.bind(process.stdout)
process.stdout.write = ((chunk, encoding, callback) =>
  process.stderr.write(chunk, encoding, callback))

async function main() {
  const store = new Store()
  initLogger(store.root)
  await store.init()

  const send = createSender(rawWrite)
  const dispatch = createRpc(store)

  attachReader(process.stdin, (message) => {
    void dispatch(message).then((response) => {
      try {
        send(response)
      } catch (err) {
        log('send failed', err?.message || String(err))
        try {
          send({
            id: response?.id,
            ok: false,
            error: { code: 'PAYLOAD_TOO_LARGE', message: '响应超过 1MB，请分页读取' },
          })
        } catch {
          /* 端口已关闭 */
        }
      }
    })
  })

  process.on('uncaughtException', (err) => {
    log('uncaughtException', err?.stack || String(err))
  })
  process.on('unhandledRejection', (err) => {
    log('unhandledRejection', err?.stack || String(err))
  })

  log('host started', { pid: process.pid, argv: process.argv.slice(2) })
}

main().catch((err) => {
  try {
    log('host failed to start', err?.stack || String(err))
  } catch {
    /* ignore */
  }
  process.exit(1)
})
