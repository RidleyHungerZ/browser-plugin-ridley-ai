import { log } from './logger.mjs'

/**
 * 所有请求串行执行：host 是单进程，串行化可以彻底避免同一会话的并发写。
 * @param {import('./store.mjs').Store} store
 */
export function createRpc(store) {
  let chain = Promise.resolve()
  const enqueue = (fn) => {
    const next = chain.then(fn)
    chain = next.then(
      () => undefined,
      () => undefined,
    )
    return next
  }

  const handlers = {
    ping: () => ({ pong: true, version: 1, root: store.root, time: Date.now() }),

    'settings.read': () => store.readSettings(),
    'settings.write': ({ settings }) => store.writeSettings(settings),

    'session.list': ({ filter = {}, sort = 'updatedAt', order = 'desc' } = {}) =>
      store.listSessions(filter, sort, order),
    'session.getMeta': ({ id }) => store.getMeta(id),
    'session.getMessages': ({ id, cursor = null, limit = 20 }) =>
      store.getMessages(id, cursor, limit),
    'session.create': (input) => store.createSession(input || {}),
    'session.updateMeta': ({ id, patch = {} }) => store.updateMeta(id, patch),
    'session.appendMessage': ({ id, message }) => store.appendMessage(id, message),
    'session.updateDraft': ({ id, draft }) => store.updateDraft(id, draft),
    'session.getDraft': ({ id }) => store.getDraft(id),
    'session.clearDraft': ({ id }) => store.clearDraft(id),
    'session.delete': ({ id }) => store.deleteSession(id),

    'attachment.put': ({ hash, base64, offset = 0 }) => store.putAttachment(hash, base64, offset),
    'attachment.get': ({ hash, offset = 0, size = 512 * 1024 }) =>
      store.getAttachment(hash, offset, size),
    'attachment.exists': ({ hash }) => store.attachmentExists(hash),
  }

  return async function dispatch(message) {
    const id = message?.id
    const method = message?.method
    try {
      const handler = handlers[method]
      if (!handler) throw new Error(`未知方法：${String(method)}`)
      const result = await enqueue(() => handler(message.params || {}))
      return { id, ok: true, result }
    } catch (err) {
      log('rpc error', method, err?.stack || err?.message || String(err))
      return {
        id,
        ok: false,
        error: { code: 'RPC_ERROR', message: err?.message || String(err) },
      }
    }
  }
}
