#!/usr/bin/env node
/**
 * 不依赖浏览器的 host 冒烟测试：直接以 native messaging 帧协议和 host 对话。
 * 用法：node native-host/scripts/smoke-test.mjs
 */
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const useExe = process.argv.includes('--exe')
const hostPath = useExe
  ? resolve(here, '..', 'build', 'ridley-host.exe')
  : resolve(here, '..', 'src', 'host.mjs')

const proc = useExe
  ? spawn(hostPath, [], { stdio: ['pipe', 'pipe', 'inherit'] })
  : spawn(process.execPath, [hostPath], { stdio: ['pipe', 'pipe', 'inherit'] })

let buffer = Buffer.alloc(0)
const waiters = new Map()

proc.stdout.on('data', (chunk) => {
  buffer = Buffer.concat([buffer, chunk])
  while (buffer.length >= 4) {
    const length = buffer.readUInt32LE(0)
    if (buffer.length < 4 + length) break
    const body = buffer.subarray(4, 4 + length)
    buffer = buffer.subarray(4 + length)
    const msg = JSON.parse(body.toString('utf8'))
    const waiter = waiters.get(msg.id)
    if (waiter) {
      waiters.delete(msg.id)
      waiter(msg)
    }
  }
})

let nextId = 1
function call(method, params) {
  const id = nextId++
  const body = Buffer.from(JSON.stringify({ id, method, params }), 'utf8')
  const head = Buffer.alloc(4)
  head.writeUInt32LE(body.length, 0)
  proc.stdin.write(Buffer.concat([head, body]))
  return new Promise((resolvePromise, reject) => {
    const timer = setTimeout(() => reject(new Error(`超时：${method}`)), 5000)
    waiters.set(id, (msg) => {
      clearTimeout(timer)
      if (msg.ok) resolvePromise(msg.result)
      else reject(new Error(msg.error?.message ?? 'unknown'))
    })
  })
}

try {
  console.log('ping →', await call('ping'))
  const settings = await call('settings.read')
  console.log('settings.providers →', settings.providers.map((p) => p.name))

  const id = `smoke-${Date.now()}`
  const meta = await call('session.create', {
    id,
    title: '冒烟测试',
    providerId: 'deepseek',
    modelId: 'deepseek-chat',
  })
  console.log('session.create →', meta.id, meta.rev)

  await call('session.appendMessage', {
    id,
    message: {
      id: 'm1',
      role: 'user',
      blocks: [{ type: 'text', text: '你好，这是一条测试消息' }],
      createdAt: Date.now(),
    },
  })
  const page = await call('session.getMessages', { id, limit: 20 })
  console.log('session.getMessages →', page.total, page.messages[0].blocks[0].text)

  const list = await call('session.list', { sort: 'updatedAt', order: 'desc' })
  console.log('session.list →', list.length, list[0]?.title)

  await call('session.updateMeta', { id, patch: { title: '重命名后的会话' } })
  console.log('session.getMeta →', (await call('session.getMeta', { id })).title)

  const hash = 'a'.repeat(64)
  await call('attachment.put', { hash, base64: Buffer.from('hello').toString('base64') })
  const chunk = await call('attachment.get', { hash, offset: 0, size: 1024 })
  console.log('attachment.get →', Buffer.from(chunk.data, 'base64').toString(), chunk.total)

  await call('session.delete', { id })
  console.log('session.delete → ok')
  console.log('\n全部通过')
} catch (err) {
  console.error('失败：', err.message)
  process.exitCode = 1
} finally {
  proc.stdin.end()
  setTimeout(() => proc.kill(), 200)
}
