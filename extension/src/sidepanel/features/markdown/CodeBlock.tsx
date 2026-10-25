import { useEffect, useMemo, useRef, useState } from 'react'
import { createHighlighterCore, type HighlighterCore } from 'shiki/core'
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript'
import { Icon } from '../../ui/Icon'
import { toast } from '../../ui/Toast'
import styles from './CodeBlock.module.css'

type LangLoader = () => Promise<unknown>

const LANG_LOADERS: Record<string, LangLoader> = {
  javascript: () => import('shiki/langs/javascript.mjs'),
  typescript: () => import('shiki/langs/typescript.mjs'),
  jsx: () => import('shiki/langs/jsx.mjs'),
  tsx: () => import('shiki/langs/tsx.mjs'),
  json: () => import('shiki/langs/json.mjs'),
  python: () => import('shiki/langs/python.mjs'),
  bash: () => import('shiki/langs/bash.mjs'),
  shell: () => import('shiki/langs/shellscript.mjs'),
  html: () => import('shiki/langs/html.mjs'),
  css: () => import('shiki/langs/css.mjs'),
  sql: () => import('shiki/langs/sql.mjs'),
  go: () => import('shiki/langs/go.mjs'),
  java: () => import('shiki/langs/java.mjs'),
  rust: () => import('shiki/langs/rust.mjs'),
  yaml: () => import('shiki/langs/yaml.mjs'),
  markdown: () => import('shiki/langs/markdown.mjs'),
  diff: () => import('shiki/langs/diff.mjs'),
  xml: () => import('shiki/langs/xml.mjs'),
  c: () => import('shiki/langs/c.mjs'),
  cpp: () => import('shiki/langs/cpp.mjs'),
  csharp: () => import('shiki/langs/csharp.mjs'),
  php: () => import('shiki/langs/php.mjs'),
  ruby: () => import('shiki/langs/ruby.mjs'),
  kotlin: () => import('shiki/langs/kotlin.mjs'),
  swift: () => import('shiki/langs/swift.mjs'),
  lua: () => import('shiki/langs/lua.mjs'),
  ini: () => import('shiki/langs/ini.mjs'),
}

const ALIASES: Record<string, string> = {
  js: 'javascript',
  ts: 'typescript',
  py: 'python',
  sh: 'bash',
  zsh: 'bash',
  console: 'bash',
  yml: 'yaml',
  md: 'markdown',
  htm: 'html',
  'c++': 'cpp',
  cs: 'csharp',
  rb: 'ruby',
  kt: 'kotlin',
  toml: 'ini',
  properties: 'ini',
  dockerfile: 'docker',
  text: 'text',
  plaintext: 'text',
}

const LONG_LANG_LABEL: Record<string, string> = {
  javascript: 'JavaScript',
  typescript: 'TypeScript',
  python: 'Python',
  csharp: 'C#',
  cpp: 'C++',
  markdown: 'Markdown',
}

const loaded = new Set<string>()
const htmlCache = new Map<string, string>()

let corePromise: Promise<HighlighterCore> | null = null

function getCore(): Promise<HighlighterCore> {
  if (!corePromise) {
    corePromise = createHighlighterCore({
      themes: [import('shiki/themes/github-light.mjs'), import('shiki/themes/github-dark.mjs')],
      langs: [],
      engine: createJavaScriptRegexEngine(),
    })
  }
  return corePromise
}

function currentThemeName(): 'github-light' | 'github-dark' {
  return document.documentElement.dataset.theme === 'dark' ? 'github-dark' : 'github-light'
}

async function highlight(code: string, lang: string, theme: string): Promise<string | null> {
  const normalized = ALIASES[lang] ?? lang
  const loader = LANG_LOADERS[normalized]
  if (!loader) return null

  const key = `${theme}:${normalized}:${code.length}:${code.slice(0, 64)}:${code.slice(-32)}`
  const cached = htmlCache.get(key)
  if (cached) return cached

  const core = await getCore()
  if (!loaded.has(normalized)) {
    try {
      await core.loadLanguage(loader as never)
      loaded.add(normalized)
    } catch {
      return null
    }
  }
  try {
    const html = core.codeToHtml(code, { lang: normalized, theme })
    if (htmlCache.size > 120) htmlCache.clear()
    htmlCache.set(key, html)
    return html
  } catch {
    return null
  }
}

interface CodeBlockProps {
  code: string
  lang?: string
  streaming?: boolean
}

export function CodeBlock({ code, lang = 'text', streaming = false }: CodeBlockProps) {
  const [html, setHtml] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [themeName, setThemeName] = useState(currentThemeName)
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const observer = new MutationObserver(() => setThemeName(currentThemeName()))
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    })
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (streaming) {
      setHtml(null)
      return
    }
    let cancelled = false
    highlight(code, lang, themeName).then((result) => {
      if (!cancelled) setHtml(result)
    })
    return () => {
      cancelled = true
    }
  }, [code, lang, themeName, streaming])

  const label = useMemo(() => LONG_LANG_LABEL[lang] ?? (lang === 'text' ? '文本' : lang), [lang])

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      if (copyTimer.current) clearTimeout(copyTimer.current)
      copyTimer.current = setTimeout(() => setCopied(false), 1500)
    } catch {
      toast('复制失败', 'error')
    }
  }

  return (
    <div className={styles.block}>
      <div className={styles.banner}>
        <span className={styles.lang}>{label}</span>
        <button className={styles.copy} onClick={onCopy} type="button" aria-label="复制代码">
          <Icon name={copied ? 'check' : 'copy'} size={13} />
          <span>{copied ? '已复制' : '复制'}</span>
        </button>
      </div>
      {html ? (
        <div
          className={styles.highlighted}
          // Shiki 输出的是受控的 span 树
          dangerouslySetInnerHTML={{ __html: html }}
        />
      ) : (
        <pre className={styles.plain}>
          <code>{code}</code>
        </pre>
      )}
    </div>
  )
}
