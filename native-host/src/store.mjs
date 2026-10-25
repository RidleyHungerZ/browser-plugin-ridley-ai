import { promises as fs } from 'node:fs'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { log } from './logger.mjs'

const ID_RE = /^[A-Za-z0-9-]{1,64}$/
const HASH_RE = /^[a-f0-9]{64}$/

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export const DEFAULT_SETTINGS = {
  version: 1,
  providers: [
    {
      id: 'deepseek',
      name: 'DeepSeek',
      protocol: 'openai-completions',
      baseUrl: 'https://api.deepseek.com',
      apiKey: '',
      autoV1: true,
      temperature: 0.7,
      models: [
        {
          id: 'deepseek-chat',
          label: 'DeepSeek Chat',
          contextWindow: 131072,
          maxOutput: 8192,
          vision: false,
          reasoning: false,
          tools: true,
          includeUsage: true,
        },
        {
          id: 'deepseek-reasoner',
          label: 'DeepSeek Reasoner',
          contextWindow: 131072,
          maxOutput: 65536,
          vision: false,
          reasoning: true,
          tools: true,
          includeUsage: true,
        },
      ],
    },
  ],
  activeModelKey: 'deepseek::deepseek-chat',
  recentModels: [],
  ui: {
    theme: 'system',
    fontSize: 14,
    enterToSend: true,
    selectionBehavior: 'insert',
    showReasoning: true,
  },
  tools: {
    search: {
      enabled: false,
      baseUrl: 'https://api.deepseek.com/v1/tools/search',
      apiKey: '',
      model: 'deepseek-v4-flash',
      maxResults: 10,
      maxUses: 3,
    },
    fetch: {
      enabled: false,
      mode: 'remote',
      baseUrl: 'https://api.deepseek.com/v1/tools/fetch',
      apiKey: '',
      maxChars: 20000,
      allowPrivateHosts: false,
    },
    maxRounds: 5,
  },
}

function monthOf(ts) {
  const d = new Date(ts)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function assertId(id) {
  if (typeof id !== 'string' || !ID_RE.test(id)) {
    throw new Error(`非法会话 ID: ${String(id)}`)
  }
  return id
}

function assertHash(hash) {
  if (typeof hash !== 'string' || !HASH_RE.test(hash)) {
    throw new Error(`非法附件哈希: ${String(hash)}`)
  }
  return hash
}

async function writeAtomic(file, content) {
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`
  await fs.writeFile(tmp, content, 'utf8')
  const fh = await fs.open(tmp, 'r+')
  try {
    await fh.sync()
  } finally {
    await fh.close()
  }
  for (let attempt = 0; ; attempt++) {
    try {
      await fs.rename(tmp, file)
      return
    } catch (err) {
      const retryable = ['EPERM', 'EBUSY', 'EACCES'].includes(err.code)
      if (!retryable || attempt >= 5) throw err
      await sleep(30 * (attempt + 1))
    }
  }
}

function safeParse(text, fallback = null) {
  try {
    return JSON.parse(text)
  } catch {
    return fallback
  }
}

export class Store {
  constructor(rootDir = process.env.RIDLEY_AI_HOME || join(homedir(), '.ridley-ai')) {
    this.root = resolve(rootDir)
    this.sessionsDir = join(this.root, 'sessions')
    this.attachmentsDir = join(this.root, 'attachments')
    this.trashDir = join(this.root, '.trash')
    this.settingsPath = join(this.root, 'settings.json')
    /** @type {Map<string, string>} sessionId -> 会话目录 */
    this.dirCache = new Map()
  }

  async init() {
    await fs.mkdir(this.sessionsDir, { recursive: true })
    await fs.mkdir(this.attachmentsDir, { recursive: true })
    await fs.mkdir(this.trashDir, { recursive: true })
    await fs.mkdir(join(this.root, 'logs'), { recursive: true })
    log('store ready at', this.root)
  }

  /* ---------------- settings ---------------- */

  async readSettings() {
    try {
      const text = await fs.readFile(this.settingsPath, 'utf8')
      const parsed = safeParse(text, null)
      if (parsed && parsed.version === 1) {
        return {
          ...DEFAULT_SETTINGS,
          ...parsed,
          ui: { ...DEFAULT_SETTINGS.ui, ...(parsed.ui ?? {}) },
          tools: {
            search: { ...DEFAULT_SETTINGS.tools.search, ...(parsed.tools?.search ?? {}) },
            fetch: { ...DEFAULT_SETTINGS.tools.fetch, ...(parsed.tools?.fetch ?? {}) },
            maxRounds:
              Number.isFinite(parsed.tools?.maxRounds) && parsed.tools.maxRounds >= 0
                ? parsed.tools.maxRounds
                : DEFAULT_SETTINGS.tools.maxRounds,
          },
        }
      }
    } catch (err) {
      if (err.code !== 'ENOENT') log('readSettings failed', err.message)
    }
    const settings = structuredClone(DEFAULT_SETTINGS)
    await this.writeSettings(settings)
    return settings
  }

  async writeSettings(settings) {
    if (existsSync(this.settingsPath)) {
      try {
        await fs.copyFile(this.settingsPath, `${this.settingsPath}.bak`)
      } catch {
        /* 备份失败不影响写入 */
      }
    }
    await writeAtomic(this.settingsPath, JSON.stringify(settings, null, 2))
    return settings
  }

  /* ---------------- session paths ---------------- */

  async findSessionDir(id) {
    assertId(id)
    const cached = this.dirCache.get(id)
    if (cached && existsSync(join(cached, 'meta.json'))) return cached

    let months = []
    try {
      const entries = await fs.readdir(this.sessionsDir, { withFileTypes: true })
      months = entries.filter((e) => e.isDirectory()).map((e) => e.name)
    } catch {
      return null
    }
    for (const month of months) {
      const candidate = join(this.sessionsDir, month, id)
      if (existsSync(join(candidate, 'meta.json'))) {
        this.dirCache.set(id, candidate)
        return candidate
      }
    }
    return null
  }

  async ensureSessionDir(id, createdAt = Date.now()) {
    const existing = await this.findSessionDir(id)
    if (existing) return existing
    const dir = join(this.sessionsDir, monthOf(createdAt), id)
    await fs.mkdir(dir, { recursive: true })
    this.dirCache.set(id, dir)
    return dir
  }

  /* ---------------- sessions ---------------- */

  async listSessions(filter = {}, sort = 'updatedAt', order = 'desc') {
    const results = []
    let months = []
    try {
      const entries = await fs.readdir(this.sessionsDir, { withFileTypes: true })
      months = entries.filter((e) => e.isDirectory()).map((e) => e.name)
    } catch {
      return []
    }

    for (const month of months) {
      let ids = []
      try {
        const entries = await fs.readdir(join(this.sessionsDir, month), { withFileTypes: true })
        ids = entries.filter((e) => e.isDirectory()).map((e) => e.name)
      } catch {
        continue
      }
      for (const id of ids) {
        if (!ID_RE.test(id)) continue
        const dir = join(this.sessionsDir, month, id)
        const metaPath = join(dir, 'meta.json')
        try {
          const meta = safeParse(await fs.readFile(metaPath, 'utf8'), null)
          if (!meta) continue
          this.dirCache.set(id, dir)
          results.push(meta)
        } catch {
          continue
        }
      }
    }

    const search = (filter.search || '').trim().toLowerCase()
    const filtered = results.filter((meta) => {
      if (filter.pinnedOnly && !meta.pinned) return false
      if (filter.modelKey && `${meta.providerId}::${meta.modelId}` !== filter.modelKey) return false
      if (filter.since && meta.updatedAt < filter.since) return false
      if (search) {
        const haystack = `${meta.title || ''}\n${meta.preview || ''}`.toLowerCase()
        if (!haystack.includes(search)) return false
      }
      return true
    })

    const field = sort === 'createdAt' ? 'createdAt' : 'updatedAt'
    filtered.sort((a, b) => {
      const delta = (a[field] || 0) - (b[field] || 0)
      return order === 'asc' ? delta : -delta
    })

    return filtered
  }

  async getMeta(id) {
    const dir = await this.findSessionDir(id)
    if (!dir) throw new Error('会话不存在')
    const meta = safeParse(await fs.readFile(join(dir, 'meta.json'), 'utf8'), null)
    if (!meta) throw new Error('会话元数据损坏')
    return meta
  }

  async createSession(input) {
    const id = assertId(input.id)
    const now = Date.now()
    const dir = await this.ensureSessionDir(id, input.createdAt || now)
    const meta = {
      id,
      title: input.title || '新会话',
      createdAt: input.createdAt || now,
      updatedAt: input.updatedAt || now,
      providerId: input.providerId || '',
      modelId: input.modelId || '',
      messageCount: 0,
      preview: '',
      pinned: false,
      sourceUrl: input.sourceUrl || '',
      sourceTitle: input.sourceTitle || '',
      rev: 1,
    }
    await writeAtomic(join(dir, 'meta.json'), JSON.stringify(meta, null, 2))
    const msgFile = join(dir, 'messages.jsonl')
    if (!existsSync(msgFile)) await fs.writeFile(msgFile, '', 'utf8')
    return meta
  }

  async updateMeta(id, patch = {}) {
    const dir = await this.findSessionDir(id)
    if (!dir) throw new Error('会话不存在')
    const metaPath = join(dir, 'meta.json')
    const meta = safeParse(await fs.readFile(metaPath, 'utf8'), null)
    if (!meta) throw new Error('会话元数据损坏')

    for (const key of ['title', 'pinned', 'providerId', 'modelId', 'sourceUrl', 'sourceTitle']) {
      if (patch[key] !== undefined) meta[key] = patch[key]
    }
    meta.rev = (meta.rev || 0) + 1
    await writeAtomic(metaPath, JSON.stringify(meta, null, 2))
    return meta
  }

  async getMessages(id, cursor = null, limit = 20) {
    const dir = await this.findSessionDir(id)
    if (!dir) throw new Error('会话不存在')
    const msgPath = join(dir, 'messages.jsonl')
    let text = ''
    try {
      text = await fs.readFile(msgPath, 'utf8')
    } catch (err) {
      if (err.code !== 'ENOENT') throw err
    }

    const messages = []
    for (const line of text.split('\n')) {
      if (!line.trim()) continue
      const parsed = safeParse(line, null)
      if (parsed && parsed.id) messages.push(parsed)
    }

    const total = messages.length
    const end = cursor === null || cursor === undefined ? total : Math.min(cursor, total)
    const start = Math.max(0, end - limit)
    const slice = messages.slice(start, end)
    return {
      messages: slice,
      nextCursor: start > 0 ? start : null,
      total,
    }
  }

  async appendMessage(id, message) {
    const dir = await this.findSessionDir(id)
    if (!dir) throw new Error('会话不存在')
    if (!message || !message.id) throw new Error('消息缺少 id')

    await fs.appendFile(join(dir, 'messages.jsonl'), JSON.stringify(message) + '\n', 'utf8')

    const metaPath = join(dir, 'meta.json')
    const meta = safeParse(await fs.readFile(metaPath, 'utf8'), null)
    if (!meta) throw new Error('会话元数据损坏')

    meta.messageCount = (meta.messageCount || 0) + 1
    meta.updatedAt = message.createdAt || Date.now()
    if (!meta.preview) {
      const firstText = (message.blocks || []).find((b) => b.type === 'text')
      if (firstText?.text) meta.preview = firstText.text.slice(0, 120)
    }
    meta.rev = (meta.rev || 0) + 1
    await writeAtomic(metaPath, JSON.stringify(meta, null, 2))
    return meta
  }

  async updateDraft(id, draft) {
    const dir = await this.findSessionDir(id)
    if (!dir) throw new Error('会话不存在')
    // 草稿不参与 rev 递增，也不会更新 updatedAt（流式内容不改变排序）
    await writeAtomic(join(dir, 'draft.json'), JSON.stringify(draft))
    return { ok: true }
  }

  async getDraft(id) {
    const dir = await this.findSessionDir(id)
    if (!dir) return null
    try {
      const text = await fs.readFile(join(dir, 'draft.json'), 'utf8')
      return safeParse(text, null)
    } catch (err) {
      if (err.code === 'ENOENT') return null
      throw err
    }
  }

  async clearDraft(id) {
    const dir = await this.findSessionDir(id)
    if (!dir) return { ok: true }
    try {
      await fs.unlink(join(dir, 'draft.json'))
    } catch (err) {
      if (err.code !== 'ENOENT') throw err
    }
    return { ok: true }
  }

  async deleteSession(id) {
    const dir = await this.findSessionDir(id)
    if (!dir) throw new Error('会话不存在')
    const target = join(this.trashDir, `${id}-${Date.now()}`)
    await fs.rename(dir, target)
    this.dirCache.delete(id)
    return { ok: true }
  }

  /* ---------------- attachments ---------------- */

  async putAttachment(hash, base64, offset = 0) {
    assertHash(hash)
    const file = join(this.attachmentsDir, hash)
    const buffer = Buffer.from(base64, 'base64')
    if (!offset) {
      await writeAtomic(file, buffer)
    } else {
      const handle = await fs.open(file, 'r+')
      try {
        await handle.write(buffer, 0, buffer.length, Number(offset))
      } finally {
        await handle.close()
      }
    }
    const stat = await fs.stat(file)
    return { hash, size: stat.size }
  }

  async getAttachment(hash, offset = 0, size = 512 * 1024) {
    assertHash(hash)
    const file = join(this.attachmentsDir, hash)
    const stat = await fs.stat(file)
    const start = Math.max(0, Math.min(Number(offset) || 0, stat.size))
    const length = Math.max(0, Math.min(Number(size) || 512 * 1024, stat.size - start))
    const handle = await fs.open(file, 'r')
    try {
      const buffer = Buffer.allocUnsafe(length)
      await handle.read(buffer, 0, length, start)
      return {
        data: buffer.toString('base64'),
        offset: start,
        size: length,
        total: stat.size,
      }
    } finally {
      await handle.close()
    }
  }

  async attachmentExists(hash) {
    assertHash(hash)
    return existsSync(join(this.attachmentsDir, hash))
  }
}
