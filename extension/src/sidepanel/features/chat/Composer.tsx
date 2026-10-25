import { useEffect, useRef, useState } from 'react'
import { addAttachments, send, stop } from '../../state/chat'
import { useAppStore } from '../../state/store'
import { Icon } from '../../ui/Icon'
import { formatBytes, formatDomain } from '../../utils/format'
import { ContextMeter } from './ContextMeter'
import { ModelPicker } from './ModelPicker'
import styles from './Composer.module.css'

export function Composer() {
  const draftText = useAppStore((state) => state.draftText)
  const quote = useAppStore((state) => state.quote)
  const attachments = useAppStore((state) => state.attachments)
  const status = useAppStore((state) => state.status)
  const settings = useAppStore((state) => state.settings)
  const setDraftText = useAppStore((state) => state.setDraftText)
  const setQuote = useAppStore((state) => state.setQuote)
  const removeAttachment = useAppStore((state) => state.removeAttachment)

  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const composingRef = useRef(false)
  const [quoteOpen, setQuoteOpen] = useState(false)

  const busy = status !== 'idle'
  const enterToSend = settings?.ui.enterToSend ?? true
  const canSend = Boolean(draftText.trim() || quote || attachments.length > 0)

  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = '0px'
    const maxHeight = Math.round(window.innerHeight * 0.4)
    el.style.height = `${Math.min(el.scrollHeight, maxHeight)}px`
  }, [draftText])

  useEffect(() => {
    const focus = () => textareaRef.current?.focus()
    window.addEventListener('ridley:focus-composer', focus)
    return () => window.removeEventListener('ridley:focus-composer', focus)
  }, [])

  useEffect(() => {
    setQuoteOpen(false)
  }, [quote?.text])

  const submit = () => {
    if (busy || !canSend) return
    void send()
  }

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Escape') {
      if (busy) {
        event.preventDefault()
        stop()
      }
      return
    }
    if (event.key !== 'Enter') return
    const composing =
      composingRef.current ||
      event.nativeEvent.isComposing ||
      (event.nativeEvent as KeyboardEvent).keyCode === 229
    if (composing) return

    const wantsSend = enterToSend ? !event.shiftKey : event.ctrlKey || event.metaKey
    if (wantsSend) {
      event.preventDefault()
      submit()
    }
  }

  return (
    <div className={styles.root}>
      {quote ? (
        <div className={styles.quoteCard}>
          <div className={styles.quoteHead}>
            <span className={styles.quoteLabel}>引用选中内容</span>
            <span className={styles.quoteMeta}>{quote.text.length} 字</span>
            <button
              type="button"
              className={styles.quoteToggle}
              onClick={() => setQuoteOpen((value) => !value)}
            >
              {quoteOpen ? '收起' : '展开'}
            </button>
            <button
              type="button"
              className={styles.quoteRemove}
              onClick={() => setQuote(null)}
              aria-label="移除引用"
            >
              <Icon name="close" size={12} />
            </button>
          </div>
          <div className={quoteOpen ? styles.quoteBodyOpen : styles.quoteBody}>{quote.text}</div>
          {quote.url ? (
            <div className={styles.quoteSource}>
              {formatDomain(quote.url)}
              {quote.title ? ` · ${quote.title}` : ''}
            </div>
          ) : null}
        </div>
      ) : null}

      {attachments.length > 0 ? (
        <div className={styles.rail}>
          {attachments.map((attachment) => (
            <div key={attachment.id} className={styles.chip} title={attachment.name}>
              {attachment.kind === 'image' && attachment.dataUrl ? (
                <img className={styles.chipImage} src={attachment.dataUrl} alt={attachment.name} />
              ) : (
                <span className={styles.chipIcon}>
                  <Icon name={attachment.kind === 'image' ? 'image' : 'file'} size={14} />
                </span>
              )}
              <span className={styles.chipMeta}>
                <span className={styles.chipName}>{attachment.name}</span>
                <span className={styles.chipSize}>
                  {attachment.uploading ? '上传中…' : formatBytes(attachment.size)}
                </span>
              </span>
              <button
                type="button"
                className={styles.chipRemove}
                onClick={() => removeAttachment(attachment.id)}
                aria-label="移除附件"
              >
                <Icon name="close" size={11} />
              </button>
            </div>
          ))}
        </div>
      ) : null}

      <div className={styles.card}>
        <textarea
          ref={textareaRef}
          className={styles.input}
          value={draftText}
          onChange={(event) => setDraftText(event.target.value)}
          onKeyDown={onKeyDown}
          onCompositionStart={() => {
            composingRef.current = true
          }}
          onCompositionEnd={() => {
            composingRef.current = false
          }}
          onPaste={(event) => {
            const files = event.clipboardData?.files
            if (files && files.length > 0) {
              event.preventDefault()
              void addAttachments(files)
            }
          }}
          placeholder={quote ? '补充你的问题（可留空直接发送）…' : '问问 Ridley-AI…'}
          rows={1}
          spellCheck={false}
          aria-label="输入消息"
        />

        <div className={styles.toolbar}>
          <div className={styles.left}>
            <button
              type="button"
              className={styles.iconBtn}
              onClick={() => fileRef.current?.click()}
              title="添加附件（图片或文本文件）"
              aria-label="添加附件"
            >
              <Icon name="plus" size={17} />
            </button>
            <input
              ref={fileRef}
              type="file"
              multiple
              hidden
              onChange={(event) => {
                if (event.target.files?.length) void addAttachments(event.target.files)
                event.target.value = ''
              }}
            />
            <ModelPicker />
          </div>

          <div className={styles.right}>
            <ContextMeter />
            {busy ? (
              <button
                type="button"
                className={`${styles.send} ${styles.stop}`}
                onClick={stop}
                title="停止生成（Esc）"
                aria-label="停止生成"
              >
                <Icon name="stop" size={14} />
              </button>
            ) : (
              <button
                type="button"
                className={styles.send}
                onClick={submit}
                disabled={!canSend}
                title="发送（Enter）"
                aria-label="发送"
              >
                <Icon name="send" size={15} />
              </button>
            )}
          </div>
        </div>
      </div>

      <div className={styles.hint}>
        {enterToSend ? 'Enter 发送 · Shift+Enter 换行' : 'Ctrl+Enter 发送 · Enter 换行'}
        {busy ? ' · Esc 停止' : ''}
      </div>
    </div>
  )
}
