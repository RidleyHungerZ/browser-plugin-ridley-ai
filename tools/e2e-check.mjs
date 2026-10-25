#!/usr/bin/env node
/**
 * 端到端自检：临时数据目录 + 本地 mock 模型服务 + 无头 Chrome。
 * 覆盖：加载 → 发送 → 流式渲染 → 历史抽屉 → 设置弹窗 → 多供应商同名模型分组。
 * 不会碰真实的 ~/.ridley-ai（通过 RIDLEY_AI_HOME 隔离）。
 */
import { chromium } from 'playwright-core'
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')
const dist = join(root, 'dist')
const key = JSON.parse(readFileSync(join(root, '.ridley-key.json'), 'utf8'))
const stamp = Date.now()
const tempHome = join(tmpdir(), `ridley-e2e-home-${stamp}`)
const profile = join(tmpdir(), `ridley-e2e-profile-${stamp}`)
const PORT = 18765

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

const settings = {
  version: 1,
  providers: [
    {
      id: 'mock-a',
      name: 'Mock A',
      protocol: 'openai-completions',
      baseUrl: `http://127.0.0.1:${PORT}`,
      apiKey: 'test-key',
      autoV1: true,
      temperature: 0.7,
      models: [
        {
          id: 'mock-model',
          label: 'Mock Model',
          contextWindow: 32768,
          maxOutput: 2048,
          tools: true,
          includeUsage: true,
        },
      ],
    },
    {
      id: 'mock-b',
      name: 'Mock B',
      protocol: 'openai-completions',
      baseUrl: `http://127.0.0.1:${PORT}`,
      apiKey: 'test-key',
      autoV1: true,
      temperature: 0.7,
      models: [
        {
          id: 'mock-model',
          label: 'Mock Model',
          contextWindow: 32768,
          maxOutput: 2048,
          tools: true,
          includeUsage: true,
        },
      ],
    },
  ],
  activeModelKey: 'mock-a::mock-model',
  recentModels: [],
  ui: {
    theme: 'light',
    fontSize: 14,
    enterToSend: true,
    selectionBehavior: 'insert',
    showReasoning: true,
  },
  tools: {
    search: {
      enabled: true,
      baseUrl: `http://127.0.0.1:${PORT}/v1/tools/search`,
      apiKey: 'test-key',
      model: 'mock-search',
      maxResults: 10,
      maxUses: 3,
    },
    fetch: {
      enabled: true,
      mode: 'remote',
      baseUrl: `http://127.0.0.1:${PORT}/v1/tools/fetch`,
      apiKey: '',
      maxChars: 20000,
      allowPrivateHosts: false,
    },
    maxRounds: 2,
  },
}

mkdirSync(tempHome, { recursive: true })
writeFileSync(join(tempHome, 'settings.json'), JSON.stringify(settings, null, 2), 'utf8')

const server = spawn(process.execPath, [join(__dirname, 'mock-llm-server.mjs'), String(PORT)], {
  stdio: ['ignore', 'inherit', 'inherit'],
})
const wait = (ms) => new Promise((resolveWait) => setTimeout(resolveWait, ms))
await wait(600)

let failed = false
const check = (label, ok, extra = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${extra ? ` — ${extra}` : ''}`)
  if (!ok) failed = true
}

let context
let page
let errors = []
try {
  context = await chromium.launchPersistentContext(profile, {
    executablePath,
    headless: true,
    viewport: { width: 430, height: 880 },
    env: { ...process.env, RIDLEY_AI_HOME: tempHome },
    args: [
      `--disable-extensions-except=${dist}`,
      `--load-extension=${dist}`,
      '--no-first-run',
      '--no-default-browser-check',
    ],
  })

  page = await context.newPage()
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`))
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`console: ${msg.text()}`)
  })
  page.on('requestfailed', (request) => {
    const reason = request.failure()?.errorText ?? ''
    // 主动中止（停止生成 / probe 取消）属于正常路径
    if (reason.includes('ERR_ABORTED')) return
    errors.push(`requestfailed: ${request.url()} ${reason}`)
  })

  await page.goto(`chrome-extension://${key.extensionId}/sidepanel.html`)
  await page.waitForTimeout(2000)
  const bodyText = await page.locator('body').innerText()
  check('扩展加载并读到本地设置', bodyText.includes('Mock A'), bodyText.split('\n').slice(0, 3).join(' / '))

  // 多供应商同名模型：下拉中应为两个独立选项
  await page.locator('button[aria-label="选择模型"]').click()
  await page.waitForTimeout(300)
  const optionCount = await page.locator('[role="option"]').count()
  const optionText = await page.locator('[role="option"]').allInnerTexts()
  check(
    '同名模型按供应商分开显示',
    optionCount === 2 && optionText.every((text) => text.includes('Mock Model')),
    `${optionCount} 项：${optionText.join(' | ')}`,
  )
  await page.screenshot({ path: join(root, 'verify-model-picker.png') })
  await page.keyboard.press('Escape')

  // 发送并等待流式完成
  const fetchProbe = await page.evaluate(async (port) => {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/v1/models`)
      return { ok: response.ok, status: response.status }
    } catch (err) {
      return { error: String(err) }
    }
  }, PORT)
  console.log('fetch probe:', fetchProbe)

  const streamProbe = await page.evaluate(async (port) => {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
        body: JSON.stringify({
          model: 'mock-model',
          stream: true,
          messages: [{ role: 'user', content: 'probe' }],
        }),
      })
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let text = ''
      for (let i = 0; i < 4; i++) {
        const { done, value } = await reader.read()
        if (done) break
        text += decoder.decode(value)
      }
      reader.cancel().catch(() => {})
      return { status: response.status, text: text.slice(0, 200) }
    } catch (err) {
      return { error: String(err) }
    }
  }, PORT)
  console.log('stream probe:', streamProbe)

  await page.locator('textarea').fill('你好，做一次能力演示')
  await page.locator('textarea').press('Enter')
  await page.waitForFunction(() => document.body.innerText.includes('以上就是全部内容'), null, {
    timeout: 25000,
  })
  await page.waitForTimeout(800)
  const after = await page.locator('body').innerText()
  check('流式回复渲染完成', after.includes('测试模型'))
  check('代码块已渲染', (await page.locator('pre').count()) > 0)
  check('表格已渲染', (await page.locator('table').count()) > 0)
  check('工具调用卡片渲染', after.includes('网页搜索') && after.includes('抓取网页'))
  check('工具结果已回填', after.includes('工具返回了 2 条结果'))
  check('生成状态已清除', !after.includes('正在生成') && !after.includes('正在执行'))
  await page.waitForTimeout(1800)
  const mermaidSvg = await page.locator('[class*="diagram"] svg').count()
  const mermaidError = after.includes('Mermaid 渲染失败')
  check('Mermaid 图表已渲染', mermaidSvg > 0 && !mermaidError, `svg=${mermaidSvg} error=${mermaidError}`)
  await page.screenshot({ path: join(root, 'verify-chat.png') })

  // 悬停复制按钮 + 复制 Markdown 原文
  const assistantRows = page.locator('[class*="assistantRow"]')
  const lastAssistant = assistantRows.last()
  await lastAssistant.hover()
  await page.waitForTimeout(200)
  const copyButton = lastAssistant.locator('button[aria-label="复制内容"]').last()
  const copyOpacity = await copyButton.evaluate((el) => getComputedStyle(el).opacity)
  check('助手消息悬停显示复制按钮', copyOpacity === '1')

  try {
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
  } catch {
    /* 某些环境不支持，忽略 */
  }
  await copyButton.click()
  await page.waitForTimeout(300)
  const clipboard = await page.evaluate(() => navigator.clipboard.readText().catch(() => ''))
  check(
    '复制的是 Markdown 原文',
    clipboard.includes('### 能力演示') && clipboard.includes('```js'),
    clipboard.slice(0, 60).replace(/\n/g, ' '),
  )

  // 输入框换行：Shift+Enter
  const textarea = page.locator('textarea')
  await textarea.fill('第一行')
  await textarea.press('Shift+Enter')
  await textarea.type('第二行')
  const multiline = await textarea.inputValue()
  check('Shift+Enter 可换行且不发送', multiline.includes('\n') && multiline.includes('第二行'), JSON.stringify(multiline))
  await textarea.fill('')

  // 工具轮次上限：达到后应回填错误并让模型收尾，而不是直接中断
  await page.locator('textarea').fill('KEEP_TOOLING 验证工具上限')
  await page.locator('textarea').press('Enter')
  await page.waitForFunction(
    () => {
      const text = document.body.innerText
      return text.includes('（收尾）') && !text.includes('正在生成') && !text.includes('正在执行')
    },
    null,
    { timeout: 45000 },
  )
  const limitText = await page.locator('body').innerText()
  check('达到工具上限后模型仍给出最终回复', limitText.includes('（收尾）'))
  check('会话回到空闲状态', !limitText.includes('正在生成') && !limitText.includes('正在执行'))
  await page.screenshot({ path: join(root, 'verify-tool-limit.png') })

  // 历史抽屉
  await page.locator('button[aria-label="历史会话"]').click()
  await page.waitForTimeout(800)
  const historyText = await page.locator('body').innerText()
  check('历史会话已记录', historyText.includes('你好，做一次能力演示'))
  check('显示创建与活跃时间', historyText.includes('创建') && (historyText.includes('刚刚') || historyText.includes('活跃')))
  await page.screenshot({ path: join(root, 'verify-history.png') })

  // 删除确认行不应挤压换行
  await page.locator('button[aria-label="删除"]').first().click()
  await page.waitForTimeout(300)
  const confirmVisible = await page
    .getByRole('button', { name: '确认删除', exact: true })
    .isVisible()
  check('删除确认按钮完整可见', confirmVisible)
  await page.screenshot({ path: join(root, 'verify-delete-confirm.png') })
  await page.getByRole('button', { name: '取消', exact: true }).click()
  await page.waitForTimeout(300)

  await page.keyboard.press('Escape')

  // 设置弹窗
  await page.locator('button[aria-label="设置"]').click()
  await page.waitForTimeout(500)
  const settingsText = await page.locator('body').innerText()
  check('设置中列出两个渠道', settingsText.includes('Mock A') && settingsText.includes('Mock B'))
  await page.screenshot({ path: join(root, 'verify-settings.png') })

  await page.getByRole('button', { name: '工具', exact: true }).click()
  await page.waitForTimeout(400)
  const toolsText = await page.locator('body').innerText()
  check(
    '工具设置包含搜索与抓取配置',
    toolsText.includes('网页搜索') &&
    toolsText.includes('网页抓取') &&
    toolsText.includes('Search API 地址') &&
    toolsText.includes('Fetch API 地址'),
  )
  await page.screenshot({ path: join(root, 'verify-tools-settings.png') })

  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)

  // 停止生成
  await page.locator('textarea').fill('再演示一次，然后我会中断')
  await page.locator('textarea').press('Enter')
  const stopButton = page.locator('button[aria-label="停止生成"]')
  await stopButton.waitFor({ state: 'visible', timeout: 5000 })
  await stopButton.click()
  await page.waitForTimeout(1200)
  const stopped = await page.locator('body').innerText()
  check(
    '停止后回到空闲状态',
    !stopped.includes('正在生成') && !stopped.includes('正在执行'),
  )
  await page.screenshot({ path: join(root, 'verify-stopped.png') })

  // 右键带入选中文本（直接注入 storage.session，等价于 background 的写入）
  await page.evaluate(() =>
    chrome.storage.session.set({
      pendingAsk: {
        nonce: `e2e-${Date.now()}`,
        kind: 'ask',
        text: '这是一段被选中的网页文字，用来验证引用卡片。',
        url: 'https://example.com/article',
        title: '示例文章',
        at: Date.now(),
      },
    }),
  )
  await page.waitForTimeout(800)
  const injected = await page.locator('body').innerText()
  check(
    '选中文本进入输入框',
    injected.includes('引用选中内容') && injected.includes('这是一段被选中的网页文字'),
  )
  await page.screenshot({ path: join(root, 'verify-quote.png') })

  // 浏览器本次启动后的第一次「呼叫」应进入空白会话
  await page.evaluate(() =>
    chrome.storage.session.set({
      pendingAsk: {
        nonce: `call-${Date.now()}`,
        kind: 'call',
        text: '',
        url: '',
        title: '',
        at: Date.now(),
      },
    }),
  )
  await page.waitForTimeout(900)
  const afterCall = await page.locator('body').innerText()
  check(
    '首次呼叫进入空白会话',
    afterCall.includes('尚未开始') && !afterCall.includes('引用选中内容'),
    afterCall.split('\n').slice(0, 4).join(' / '),
  )

  // 暗色主题渲染
  await page.evaluate(() => {
    document.documentElement.dataset.theme = 'dark'
  })
  await page.waitForTimeout(400)
  await page.screenshot({ path: join(root, 'verify-dark.png') })

  check('无页面运行时错误', errors.length === 0, errors.slice(0, 3).join(' | '))

  // 数据落盘检查
  const sessionsDir = join(tempHome, 'sessions')
  check('会话已写入临时数据目录', existsSync(sessionsDir))
} catch (err) {
  failed = true
  console.error('运行失败：', err)
  if (page) {
    try {
      console.log('页面文本：', (await page.locator('body').innerText()).slice(0, 1200))
      await page.screenshot({ path: join(root, 'verify-failure.png') })
    } catch {
      /* ignore */
    }
  }
  console.log('页面错误：', errors.slice(0, 8))
} finally {
  if (context) await context.close().catch(() => {})
  server.kill()
  await wait(300)
  try {
    rmSync(profile, { recursive: true, force: true })
    rmSync(tempHome, { recursive: true, force: true })
  } catch {
    /* ignore */
  }
  console.log(failed ? '\n自检失败' : '\n自检全部通过')
  process.exit(failed ? 1 : 0)
}
