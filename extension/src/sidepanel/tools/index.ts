import type { AppSettings } from '@/shared/types'
import type { ToolCall } from '../api/protocols/types'
import { formatFetchOutcome, runWebFetch } from './fetch'
import { formatSearchOutcome, runWebSearch } from './search'

export interface ToolResultValue {
  content: string
  isError: boolean
}

const MAX_QUERIES = 4

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export async function executeToolCall(
  call: ToolCall,
  settings: AppSettings,
  signal?: AbortSignal,
): Promise<ToolResultValue> {
  let args: Record<string, unknown>
  try {
    args = call.arguments?.trim() ? JSON.parse(call.arguments) : {}
  } catch {
    return { content: `工具参数不是合法 JSON：${call.arguments.slice(0, 200)}`, isError: true }
  }

  try {
    if (call.name === 'web_search') {
      if (!settings.tools.search.enabled) {
        return { content: '网页搜索当前未启用', isError: true }
      }
      const raw = Array.isArray(args.queries) ? args.queries : []
      const queries = [...new Set(raw.map((item) => String(item ?? '').trim()).filter(Boolean))]
      if (queries.length === 0) {
        return { content: 'queries 不能为空', isError: true }
      }
      if (queries.length > MAX_QUERIES) {
        return { content: `一次最多查询 ${MAX_QUERIES} 个关键词`, isError: true }
      }
      const outcome = await runWebSearch(queries, settings.tools.search, signal)
      const limited = outcome.sources.length >= Math.max(1, settings.tools.search.maxResults || 8)
      return { content: formatSearchOutcome(outcome, limited), isError: false }
    }

    if (call.name === 'web_fetch') {
      if (!settings.tools.fetch.enabled) {
        return { content: '网页抓取当前未启用', isError: true }
      }
      const url = typeof args.url === 'string' ? args.url.trim() : ''
      if (!url) return { content: 'url 不能为空', isError: true }
      const outcome = await runWebFetch(
        url,
        settings.tools.fetch,
        signal,
        settings.tools.search.apiKey,
      )
      return { content: formatFetchOutcome(outcome), isError: false }
    }

    return { content: `未知工具：${call.name}`, isError: true }
  } catch (err) {
    if (signal?.aborted) {
      return { content: '工具执行已取消', isError: true }
    }
    return { content: `工具执行失败：${errorText(err)}`, isError: true }
  }
}
