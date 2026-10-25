#!/usr/bin/env node
/**
 * 本地假的 OpenAI 兼容服务，用于离线联调与自动化测试。
 * 用法：node tools/mock-llm-server.mjs [port]
 */
import http from 'node:http'

const PORT = Number(process.argv[2] || 8765)

const REPLY = [
  '你好，我是 Ridley 的**测试模型**。这是一段用于验证流式渲染的回复。\n\n',
  '### 能力演示\n\n',
  '1. 支持 **Markdown**、列表与表格\n',
  '2. 支持代码高亮\n',
  '3. 支持数学公式 $E = mc^2$\n\n',
  '```js\nfunction greet(name) {\n  return `你好，${name}`\n}\nconsole.log(greet("Ridley"))\n```\n\n',
  '```mermaid\ngraph TD\n  A[用户] --> B[侧边栏]\n  B --> C[模型]\n```\n\n',
  '| 项目 | 状态 |\n| --- | --- |\n| 流式 | 正常 |\n| 历史 | 正常 |\n\n',
  '以上就是全部内容。',
]

function sse(res, payload) {
  res.write(`data: ${JSON.stringify(payload)}\n\n`)
}

const server = http.createServer((req, res) => {
  console.log(`[mock] ${req.method} ${req.url}`)
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': '*',
      'Access-Control-Allow-Methods': '*',
    })
    res.end()
    return
  }

  if (req.url?.endsWith('/models')) {
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    })
    res.end(JSON.stringify({ object: 'list', data: [{ id: 'mock-model', object: 'model' }] }))
    return
  }

  // 官方 Search API 形态
  if (req.url?.endsWith('/tools/search')) {
    let body = ''
    req.on('data', (chunk) => (body += chunk))
    req.on('end', () => {
      const parsed = (() => {
        try {
          return JSON.parse(body)
        } catch {
          return {}
        }
      })()
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      })
      res.end(
        JSON.stringify({
          results: [
            {
              rerank_score: 2.4,
              title: `DeepSeek V4 发布（${parsed.query ?? ''}）`,
              url: 'https://example.com/deepseek-v4',
              snippet: 'DeepSeek V4 正式发布，支持百万上下文。',
              summary: 'DeepSeek V4 正式发布，支持百万上下文与原生搜索能力，详见官方公告。',
              content: '',
              site_name: 'Example',
              site_icon: null,
              date: '2026-10-01T00:00:00+00:00',
              authority: 3,
            },
          ],
        }),
      )
    })
    return
  }

  // 官方 Fetch API 形态
  if (req.url?.endsWith('/tools/fetch')) {
    let body = ''
    req.on('data', (chunk) => (body += chunk))
    req.on('end', () => {
      const parsed = (() => {
        try {
          return JSON.parse(body)
        } catch {
          return {}
        }
      })()
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      })
      res.end(
        JSON.stringify({
          title: '测试页面',
          content: `# 抓取到的标题\n\n这是网页正文内容。（来源：${parsed.url ?? ''}）`,
        }),
      )
    })
    return
  }

  if (req.url?.startsWith('/page')) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    res.end(
      '<html><head><title>测试页面</title></head><body>' +
        '<h1>抓取到的标题</h1><p>这是网页正文内容。</p><script>bad()</script>' +
        '</body></html>',
    )
    return
  }

  if (req.url?.endsWith('/chat/completions')) {
    let body = ''
    req.on('data', (chunk) => (body += chunk))
    req.on('end', () => {
      let parsed = {}
      try {
        parsed = JSON.parse(body)
      } catch {
        parsed = {}
      }
      const messages = Array.isArray(parsed.messages) ? parsed.messages : []
      const toolResults = messages.filter((item) => item.role === 'tool').length
      const hasTools = Array.isArray(parsed.tools) && parsed.tools.length > 0
      const lastUser = [...messages].reverse().find((item) => item.role === 'user')
      const keepTooling = JSON.stringify(lastUser?.content ?? '').includes('KEEP_TOOLING')

      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'Access-Control-Allow-Origin': '*',
      })

      // 第一次请求，或测试模式下的持续请求：触发工具调用
      if (hasTools && (toolResults === 0 || keepTooling)) {
        const steps = [
          {
            choices: [
              {
                delta: {
                  content: '我先搜索一下，并读取相关页面。\n\n',
                },
                index: 0,
                finish_reason: null,
              },
            ],
          },
          {
            choices: [
              {
                delta: {
                  tool_calls: [
                    {
                      index: 0,
                      id: 'call_search',
                      type: 'function',
                      function: { name: 'web_search', arguments: '' },
                    },
                  ],
                },
                index: 0,
                finish_reason: null,
              },
            ],
          },
          {
            choices: [
              {
                delta: {
                  tool_calls: [
                    { index: 0, function: { arguments: '{"queries":["deepseek v4"]}' } },
                  ],
                },
                index: 0,
                finish_reason: null,
              },
            ],
          },
          {
            choices: [
              {
                delta: {
                  tool_calls: [
                    {
                      index: 1,
                      id: 'call_fetch',
                      type: 'function',
                      function: { name: 'web_fetch', arguments: '' },
                    },
                  ],
                },
                index: 0,
                finish_reason: null,
              },
            ],
          },
          {
            choices: [
              {
                delta: {
                  tool_calls: [
                    {
                      index: 1,
                      function: {
                        arguments: JSON.stringify({ url: `http://127.0.0.1:${PORT}/page` }),
                      },
                    },
                  ],
                },
                index: 0,
                finish_reason: null,
              },
            ],
          },
          { choices: [{ delta: {}, index: 0, finish_reason: 'tool_calls' }] },
        ]

        let index = 0
        const timer = setInterval(() => {
          if (index >= steps.length) {
            res.write('data: [DONE]\n\n')
            res.end()
            clearInterval(timer)
            return
          }
          sse(res, steps[index++])
        }, 40)
        res.on('close', () => clearInterval(timer))
        return
      }

      // 第二轮（或未启用工具）：返回正文
      const header =
        toolResults > 0
          ? `工具返回了 ${toolResults} 条结果。${hasTools ? '' : '（收尾）'}\n\n`
          : ''
      const steps = header ? [header, ...REPLY] : REPLY
      let index = 0
      const timer = setInterval(() => {
        if (index >= steps.length) {
          sse(res, {
            choices: [{ delta: {}, finish_reason: 'stop', index: 0 }],
            usage: { prompt_tokens: 42, completion_tokens: 128, total_tokens: 170 },
          })
          res.write('data: [DONE]\n\n')
          res.end()
          clearInterval(timer)
          return
        }
        sse(res, {
          choices: [{ delta: { content: steps[index++] }, index: 0, finish_reason: null }],
        })
      }, 120)

      res.on('close', () => clearInterval(timer))
    })
    return
  }

  res.writeHead(404, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ error: { message: 'not found' } }))
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`mock LLM server: http://127.0.0.1:${PORT}`)
})
