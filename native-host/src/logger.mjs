import { appendFileSync, mkdirSync, renameSync, statSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'

const MAX_BYTES = 2 * 1024 * 1024

let logPath = null

export function initLogger(rootDir) {
  logPath = join(rootDir, 'logs', 'host.log')
  mkdirSync(dirname(logPath), { recursive: true })
}

export function log(...parts) {
  if (!logPath) return
  try {
    if (existsSync(logPath) && statSync(logPath).size > MAX_BYTES) {
      renameSync(logPath, logPath + '.1')
    }
    const line = `${new Date().toISOString()} ${parts
      .map((p) => (typeof p === 'string' ? p : safeJson(p)))
      .join(' ')}\n`
    appendFileSync(logPath, line, 'utf8')
  } catch {
    /* 日志失败不能影响主流程 */
  }
}

function safeJson(value) {
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}
