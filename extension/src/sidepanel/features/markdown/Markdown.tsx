import { memo } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import 'katex/dist/katex.min.css'
import { CodeBlock } from './CodeBlock'
import { MermaidBlock } from './MermaidBlock'
import styles from './Markdown.module.css'

interface MarkdownProps {
  text: string
  streaming?: boolean
}

export const Markdown = memo(function Markdown({ text, streaming = false }: MarkdownProps) {
  return (
    <div className={styles.md}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[[rehypeKatex, { throwOnError: false, strict: false }]]}
        components={{
          pre: ({ children }) => <>{children}</>,
          code: ({ className, children }) => {
            const match = /language-([\w+#.-]+)/.exec(className ?? '')
            const raw = String(children ?? '')
            const lang = match?.[1]?.toLowerCase()
            if (lang === 'mermaid') {
              return <MermaidBlock code={raw.replace(/\n$/, '')} streaming={streaming} />
            }
            if (match) {
              return (
                <CodeBlock code={raw.replace(/\n$/, '')} lang={match[1]} streaming={streaming} />
              )
            }
            if (raw.includes('\n')) {
              return <CodeBlock code={raw.replace(/\n$/, '')} lang="text" streaming={streaming} />
            }
            return <code className={styles.inlineCode}>{children}</code>
          },
          a: ({ href, children }) => {
            const safe = href && /^https?:\/\//i.test(href) ? href : null
            if (!safe) return <span>{children}</span>
            return (
              <a href={safe} target="_blank" rel="noopener noreferrer">
                {children}
              </a>
            )
          },
          img: ({ src, alt }) =>
            typeof src === 'string' && /^https?:\/\//i.test(src) ? (
              <img src={src} alt={alt ?? ''} referrerPolicy="no-referrer" loading="lazy" />
            ) : null,
          table: ({ children }) => (
            <div className={styles.tableWrap}>
              <table>{children}</table>
            </div>
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  )
})
