import { useEffect, useState } from 'react'
import { attachmentApi } from '../../storage/bridge'
import styles from './MessageItem.module.css'

export function AttachmentImage({
  hash,
  mime,
  name,
}: {
  hash: string
  mime: string
  name?: string
}) {
  const [url, setUrl] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    let objectUrl: string | null = null
    attachmentApi
      .getBlob(hash, mime)
      .then((blob) => {
        if (cancelled) return
        objectUrl = URL.createObjectURL(blob)
        setUrl(objectUrl)
      })
      .catch(() => !cancelled && setFailed(true))
    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [hash, mime])

  if (failed) {
    return <div className={styles.imageFallback}>图片已丢失</div>
  }
  if (!url) {
    return <div className={styles.imagePlaceholder} aria-label="正在加载图片" />
  }
  return <img className={styles.image} src={url} alt={name ?? '图片'} loading="lazy" />
}
