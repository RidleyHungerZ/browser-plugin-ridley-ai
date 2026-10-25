#!/usr/bin/env node
/**
 * 用无头 Chrome 加载扩展并截图 side panel，用于本地快速自查。
 * 用法：node tools/verify-ui.mjs [截图路径]
 */
import { chromium } from 'playwright-core'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')
const dist = join(root, 'dist')
const key = JSON.parse(readFileSync(join(root, '.ridley-key.json'), 'utf8'))
const out = process.argv[2] ? resolve(process.argv[2]) : join(root, 'verify-main.png')

const candidates = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
]
const executablePath = candidates.find((path) => existsSync(path))
if (!executablePath) {
  console.error('未找到 Chrome / Edge')
  process.exit(1)
}

const profile = join(tmpdir(), `ridley-verify-${Date.now()}`)

const context = await chromium.launchPersistentContext(profile, {
  executablePath,
  headless: true,
  viewport: { width: 420, height: 860 },
  args: [
    `--disable-extensions-except=${dist}`,
    `--load-extension=${dist}`,
    '--no-first-run',
    '--no-default-browser-check',
  ],
})

context.on('page', (page) => {
  page.on('console', (msg) => console.log('[console]', msg.type(), msg.text()))
  page.on('pageerror', (err) => console.log('[pageerror]', err.message))
})

const page = await context.newPage()
page.on('console', (msg) => console.log('[console]', msg.type(), msg.text()))
page.on('pageerror', (err) => console.log('[pageerror]', err.message))

await page.goto(`chrome-extension://${key.extensionId}/sidepanel.html`)
await page.waitForTimeout(2500)
await page.screenshot({ path: out })
console.log('title:', await page.title())
console.log('url:', page.url())
console.log('text:', (await page.locator('body').innerText()).slice(0, 600))
console.log('screenshot:', out)

await context.close()
try {
  rmSync(profile, { recursive: true, force: true })
} catch {
  /* ignore */
}
