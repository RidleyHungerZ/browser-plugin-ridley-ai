import { useEffect, useId, useRef, useState } from 'react'
import { CodeBlock } from './CodeBlock'
import styles from './MermaidBlock.module.css'

interface MermaidApi {
  initialize(config: Record<string, unknown>): void
  render(id: string, text: string): Promise<{ svg: string }>
}

let mermaidPromise: Promise<MermaidApi> | null = null
let renderChain: Promise<unknown> = Promise.resolve()

function loadMermaid(): Promise<MermaidApi> {
  if (!mermaidPromise) {
    mermaidPromise = import('mermaid').then((mod) => {
      const api = (mod as unknown as { default?: MermaidApi }).default ?? (mod as unknown as MermaidApi)
      return api
    })
  }
  return mermaidPromise
}

function enqueueRender<T>(task: () => Promise<T>): Promise<T> {
  const next = renderChain.then(task, task)
  renderChain = next.then(
    () => undefined,
    () => undefined,
  )
  return next
}

function currentTheme(): 'dark' | 'light' {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'
}

export function MermaidBlock({ code, streaming }: { code: string; streaming?: boolean }) {
  const [svg, setSvg] = useState('')
  const [error, setError] = useState('')
  const [theme, setTheme] = useState<'dark' | 'light'>(currentTheme)
  const reactId = useId().replace(/[^a-zA-Z0-9]/g, '')
  const idRef = useRef(`mermaid-${reactId}`)

  useEffect(() => {
    const observer = new MutationObserver(() => setTheme(currentTheme()))
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    })
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (streaming) return
    let cancelled = false
    setError('')

    void enqueueRender(async () => {
      try {
        const mermaid = await loadMermaid()
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: 'strict',
          theme: theme === 'dark' ? 'dark' : 'default',
          fontFamily: 'inherit',
        })
        const rendered = await mermaid.render(idRef.current, code)
        if (!cancelled) {
          setSvg(rendered.svg)
          setError('')
        }
      } catch (err) {
        if (!cancelled) {
          setSvg('')
          setError(err instanceof Error ? err.message : String(err))
        }
      }
    })

    return () => {
      cancelled = true
    }
  }, [code, theme, streaming])

  // 流式期间代码还不完整，先按代码块显示
  if (streaming) return <CodeBlock code={code} lang="mermaid" streaming />

  if (error) {
    return (
      <div className={styles.errorBox}>
        <div className={styles.errorText}>Mermaid 渲染失败：{error}</div>
        <pre className={styles.fallback}>{code}</pre>
      </div>
    )
  }

  if (!svg) return <div className={styles.loading}>正在渲染图表…</div>

  return <div className={styles.diagram} dangerouslySetInnerHTML={{ __html: svg }} />
}
