import { memo, useEffect, useRef, useState } from 'react'
import type { ContentBlock, StoredMessage } from '@/shared/types'
import { useAppStore } from '../../state/store'
import { Icon } from '../../ui/Icon'
import { formatCount, formatTime } from '../../utils/format'
import { Markdown } from '../markdown/Markdown'
import { AttachmentImage } from './Attachments'
import styles from './MessageItem.module.css'

type TextBlock = Extract<ContentBlock, { type: 'text' }>
type ImageBlock = Extract<ContentBlock, { type: 'image' }>
type FileBlock = Extract<ContentBlock, { type: 'file' }>

export function ReasoningBlock({ text, streaming }: { text: string; streaming?: boolean }) {
  const [open, setOpen] = useState(Boolean(streaming))
  const touched = useRef(false)

  useEffect(() => {
    if (streaming) setOpen(true)
    else if (!touched.current) setOpen(false)
  }, [streaming])

  return (
    <div className={styles.reasoning}>
      <button
        type="button"
        className={styles.reasoningHeader}
        onClick={() => {
          touched.current = true
          setOpen((value) => !value)
        }}
        aria-expanded={open}
      >
        <Icon name="brain" size={14} />
        <span className={styles.reasoningTitle}>{streaming ? '思考中…' : '思考过程'}</span>
        <span className={styles.reasoningMeta}>{formatCount(text.length)} 字</span>
        <Icon name={open ? 'chevron-down' : 'chevron-right'} size={14} />
      </button>
      {open ? <div className={styles.reasoningBody}>{text}</div> : null}
    </div>
  )
}

function UserMessage({ message }: { message: StoredMessage }) {
  const texts = message.blocks.filter(
    (block): block is TextBlock => block.type === 'text' && block.text.length > 0,
  )
  const images = message.blocks.filter(
    (block): block is ImageBlock => block.type === 'image',
  )
  const files = message.blocks.filter((block): block is FileBlock => block.type === 'file')

  return (
    <div className={styles.userRow}>
      <div className={styles.userStack}>
        {images.length > 0 ? (
          <div className={styles.imageGrid}>
            {images.slice(0, 4).map((image) => (
              <AttachmentImage
                key={image.hash}
                hash={image.hash}
                mime={image.mime}
                name={image.name}
              />
            ))}
          </div>
        ) : null}

        {texts.length > 0 ? (
          <div className={styles.bubble}>
            {texts.map((block, index) =>
              block.quote ? (
                <blockquote key={index} className={styles.quote}>
                  <span className={styles.quoteLabel}>引用</span>
                  {block.text}
                </blockquote>
              ) : (
                <p key={index} className={styles.userText}>
                  {block.text}
                </p>
              ),
            )}
          </div>
        ) : null}

        {files.length > 0 ? (
          <div className={styles.fileList}>
            {files.map((file) => (
              <span key={`${file.name}-${file.text.length}`} className={styles.fileChip}>
                <Icon name="file" size={13} />
                <span className={styles.fileName}>{file.name}</span>
              </span>
            ))}
          </div>
        ) : null}

        <div className={styles.userMeta}>
          {texts.length > 0 ? <CopyButton text={messageText(message)} /> : null}
          <time className={styles.userTime}>{formatTime(message.createdAt)}</time>
        </div>
      </div>
    </div>
  )
}

type ToolCallBlock = Extract<ContentBlock, { type: 'tool-call' }>
type ToolResultValue = { content: string; isError?: boolean }

function messageText(message: StoredMessage): string {
  return message.blocks
    .filter((block): block is TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('\n\n')
    .trim()
}

function CopyButton({ text, label = '复制' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current)
  }, [])

  const onCopy = async (event: React.MouseEvent) => {
    event.stopPropagation()
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => setCopied(false), 1500)
    } catch {
      /* 剪贴板不可用时保持原状 */
    }
  }

  return (
    <button
      type="button"
      className={styles.copyBtn}
      onClick={onCopy}
      title="复制 Markdown 原文"
      aria-label="复制内容"
    >
      <Icon name={copied ? 'check' : 'copy'} size={12} />
      <span>{copied ? '已复制' : label}</span>
    </button>
  )
}

function parseExecArgs(raw: string): Record<string, unknown> {
  try {
    return JSON.parse(raw) as Record<string, unknown>
  } catch {
    return {}
  }
}

function ToolCallCard({ call, result }: { call: ToolCallBlock; result?: ToolResultValue }) {
  const [open, setOpen] = useState(false)
  const args = parseExecArgs(call.arguments)
  const status = !result ? 'running' : result.isError ? 'error' : 'done'

  let title = call.name
  if (call.name === 'web_search') {
    const queries = Array.isArray(args.queries) ? args.queries.map((item) => String(item)) : []
    title = queries.length > 0 ? `网页搜索 · ${queries.join('、')}` : '网页搜索'
  } else if (call.name === 'web_fetch') {
    const url = typeof args.url === 'string' ? args.url : ''
    let host = url
    try {
      host = new URL(url).hostname
    } catch {
      /* 保留原串 */
    }
    title = host ? `抓取网页 · ${host}` : '抓取网页'
  }

  return (
    <div className={styles.toolCard}>
      <button
        type="button"
        className={styles.toolHead}
        onClick={() => result && setOpen((value) => !value)}
        disabled={!result}
        aria-expanded={open}
      >
        <span className={styles.toolIcon}>
          <Icon name={call.name === 'web_search' ? 'search' : 'external'} size={13} />
        </span>
        <span className={styles.toolTitle} title={title}>
          {title}
        </span>
        <span className={`${styles.toolStatus} ${styles[status]}`}>
          {status === 'running' ? '执行中…' : status === 'error' ? '失败' : '完成'}
        </span>
        {result ? (
          <Icon name={open ? 'chevron-down' : 'chevron-right'} size={13} className={styles.toolCaret} />
        ) : null}
      </button>
      {open && result ? <pre className={styles.toolBody}>{result.content}</pre> : null}
    </div>
  )
}

function AssistantMessage({
  message,
  streaming,
  toolResults,
}: {
  message: StoredMessage
  streaming?: boolean
  toolResults?: Map<string, ToolResultValue>
}) {
  const showReasoning = useAppStore((state) => state.settings?.ui.showReasoning ?? true)
  const reasoning = message.blocks.find((block) => block.type === 'reasoning')
  const copyText = messageText(message)

  return (
    <div className={styles.assistantRow}>
      {showReasoning && reasoning && reasoning.type === 'reasoning' ? (
        <ReasoningBlock text={reasoning.text} streaming={streaming} />
      ) : null}

      {message.blocks.map((block, index) => {
        if (block.type === 'text') {
          if (!block.text) return null
          return <Markdown key={`text-${index}`} text={block.text} streaming={streaming} />
        }
        if (block.type === 'tool-call') {
          return (
            <ToolCallCard
              key={block.id}
              call={block}
              result={toolResults?.get(block.id)}
            />
          )
        }
        return null
      })}

      {message.error ? (
        <div className={styles.errorLine}>
          <Icon name="alert" size={13} />
          <span>{message.error}</span>
        </div>
      ) : null}

      {message.interrupted && !message.error ? (
        <div className={styles.stoppedLine}>
          <Icon name="stop" size={11} />
          <span>已中断</span>
        </div>
      ) : null}

      {message.usage ? (
        <div className={styles.usageLine}>
          输入 {formatCount(message.usage.input)} · 输出 {formatCount(message.usage.output)} tokens
        </div>
      ) : null}

      {copyText ? (
        <div className={styles.messageActions}>
          <CopyButton text={copyText} />
        </div>
      ) : null}
    </div>
  )
}

export const MessageItem = memo(function MessageItem(props: {
  message: StoredMessage
  streaming?: boolean
  toolResults?: Map<string, ToolResultValue>
}) {
  if (props.message.role === 'user') return <UserMessage message={props.message} />
  if (props.message.role === 'tool') return null
  return (
    <AssistantMessage
      message={props.message}
      streaming={props.streaming}
      toolResults={props.toolResults}
    />
  )
})

export function StreamingMessage({
  text,
  reasoning,
  status,
  trimmed,
  tool,
  onStop,
}: {
  text: string
  reasoning: string
  status: 'connecting' | 'thinking' | 'streaming' | 'tool'
  trimmed?: number
  tool?: string
  onStop: () => void
}) {
  const showReasoning = useAppStore((state) => state.settings?.ui.showReasoning ?? true)
  const label =
    status === 'tool'
      ? `正在执行${tool ?? '工具'}…`
      : status === 'connecting'
        ? '正在连接…'
        : status === 'thinking'
          ? '思考中…'
          : '正在生成…'

  return (
    <div className={styles.assistantRow}>
      {trimmed && trimmed > 0 ? (
        <div className={styles.trimNotice}>
          <Icon name="alert" size={12} />
          已省略 {trimmed} 条较早的消息以适配上下文窗口
        </div>
      ) : null}
      {showReasoning && reasoning ? <ReasoningBlock text={reasoning} streaming /> : null}
      {text ? <Markdown text={text} streaming /> : null}
      <div className={styles.streamStatus}>
        <span className={styles.shimmer}>{label}</span>
        <button type="button" className={styles.stopInline} onClick={onStop}>
          <Icon name="stop" size={10} />
          停止
        </button>
      </div>
    </div>
  )
}
