import { useEffect, useMemo, useRef, useState } from 'react'
import { useAppStore } from '../../state/store'
import { loadMoreMessages, resolveActiveModel, stop } from '../../state/chat'
import { Icon } from '../../ui/Icon'
import { MessageItem, StreamingMessage } from './MessageItem'
import styles from './ChatView.module.css'

export function ChatView() {
  const messages = useAppStore((state) => state.messages)
  const status = useAppStore((state) => state.status)
  const streaming = useAppStore((state) => state.streaming)
  const activeSessionId = useAppStore((state) => state.activeSessionId)
  const hasMore = useAppStore((state) => state.hasMore)
  const messagesLoading = useAppStore((state) => state.messagesLoading)
  const messagesError = useAppStore((state) => state.messagesError)
  const settings = useAppStore((state) => state.settings)

  const scrollRef = useRef<HTMLDivElement>(null)
  const stickRef = useRef(true)
  const [atBottom, setAtBottom] = useState(true)

  const showStreaming = Boolean(
    streaming && status !== 'idle' && streaming.sessionId === activeSessionId,
  )

  const toolResults = useMemo(() => {
    const map = new Map<string, { content: string; isError?: boolean }>()
    for (const message of messages) {
      for (const block of message.blocks) {
        if (block.type === 'tool-result') {
          map.set(block.id, { content: block.content, isError: block.isError })
        }
      }
    }
    return map
  }, [messages])

  const scrollToBottom = (smooth = false) => {
    const el = scrollRef.current
    if (!el) return
    stickRef.current = true
    setAtBottom(true)
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' })
  }

  useEffect(() => {
    if (stickRef.current) scrollToBottom(false)
  }, [messages.length, streaming?.text.length, streaming?.reasoning.length, activeSessionId])

  useEffect(() => {
    stickRef.current = true
    setAtBottom(true)
  }, [activeSessionId])

  const onScroll = () => {
    const el = scrollRef.current
    if (!el) return
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight
    const nearBottom = distance < 80
    stickRef.current = nearBottom
    setAtBottom(nearBottom)

    if (el.scrollTop < 48 && hasMore && !messagesLoading) {
      const previousHeight = el.scrollHeight
      const previousTop = el.scrollTop
      void loadMoreMessages().then(() => {
        requestAnimationFrame(() => {
          const node = scrollRef.current
          if (node) node.scrollTop = node.scrollHeight - previousHeight + previousTop
        })
      })
    }
  }

  const model = settings ? resolveActiveModel(settings) : null
  const modelLabel = model?.model?.label || model?.modelId || ''
  const providerLabel = model?.provider?.name ?? ''

  return (
    <div className={styles.wrap}>
      <div className={styles.scroll} ref={scrollRef} onScroll={onScroll}>
        <div className={styles.inner}>
          {hasMore ? (
            <div className={styles.loadMore}>{messagesLoading ? '正在加载更早的消息…' : ''}</div>
          ) : null}

          {messagesError ? (
            <div className={styles.error}>
              <Icon name="alert" size={14} />
              {messagesError}
            </div>
          ) : null}

          {messages.length === 0 && !showStreaming ? (
            <div className={styles.empty}>
              <div className={styles.emptyIcon}>
                <Icon name="sparkles" size={22} />
              </div>
              <h2 className={styles.emptyTitle}>Ridley-AI</h2>
              <p className={styles.emptyText}>
                在网页上选中文字后右键「询问 Ridley-AI」，
                <br />
                或在下方直接输入问题。
              </p>
              {modelLabel ? (
                <div className={styles.emptyModel}>
                  <span className={styles.dot} />
                  {providerLabel} · {modelLabel}
                </div>
              ) : (
                <div className={styles.emptyWarn}>尚未配置模型，请打开设置</div>
              )}
            </div>
          ) : null}

          {messages.map((message) =>
            message.role === 'tool' ? null : (
              <MessageItem key={message.id} message={message} toolResults={toolResults} />
            ),
          )}

          {showStreaming && streaming ? (
            <StreamingMessage
              text={streaming.text}
              reasoning={streaming.reasoning}
              trimmed={streaming.trimmed}
              tool={streaming.tool}
              status={
                status === 'connecting'
                  ? 'connecting'
                  : status === 'thinking'
                    ? 'thinking'
                    : status === 'tool'
                      ? 'tool'
                      : 'streaming'
              }
              onStop={stop}
            />
          ) : null}
        </div>
      </div>

      {!atBottom ? (
        <button
          type="button"
          className={styles.jump}
          onClick={() => scrollToBottom(true)}
          aria-label="回到底部"
        >
          {status !== 'idle' ? (
            <>
              <span className={styles.jumpPulse} />
              生成中 · 回到底部
            </>
          ) : (
            <Icon name="arrow-down" size={15} />
          )}
        </button>
      ) : null}
    </div>
  )
}
