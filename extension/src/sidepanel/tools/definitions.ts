import type { ToolsSettings } from '@/shared/types'
import type { WireTool } from '../api/protocols/types'

export const SEARCH_TOOL: WireTool = {
  type: 'function',
  function: {
    name: 'web_search',
    description:
      'Search the public web for current information. Use it for recent events, news, prices, releases, documentation, or any fact you are not confident about. Returns a source list with title, URL, snippet and date. Always cite the URLs you used as markdown links in your answer.',
    parameters: {
      type: 'object',
      properties: {
        queries: {
          type: 'array',
          items: { type: 'string' },
          minItems: 1,
          maxItems: 4,
          description: 'One to four independent search queries.',
        },
      },
      required: ['queries'],
      additionalProperties: false,
    },
  },
}

export const FETCH_TOOL: WireTool = {
  type: 'function',
  function: {
    name: 'web_fetch',
    description:
      'Fetch a single web page and return its readable content as Markdown. Use it to read a page found via web_search in full, or when the user provides a URL. Long pages are truncated.',
    parameters: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'Absolute http(s) URL to fetch.',
        },
      },
      required: ['url'],
      additionalProperties: false,
    },
  },
}

export function buildToolDefinitions(settings: ToolsSettings): WireTool[] {
  const tools: WireTool[] = []
  if (settings.search.enabled) tools.push(SEARCH_TOOL)
  if (settings.fetch.enabled) tools.push(FETCH_TOOL)
  return tools
}

export function toolDisplayName(name: string): string {
  if (name === 'web_search') return '网页搜索'
  if (name === 'web_fetch') return '抓取网页'
  return name
}
