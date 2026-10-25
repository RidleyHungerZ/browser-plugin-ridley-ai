import { useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import styles from './Toast.module.css'

type ToastKind = 'info' | 'success' | 'error'
interface ToastItem {
  id: number
  text: string
  kind: ToastKind
}

let items: ToastItem[] = []
let seq = 1
const listeners = new Set<() => void>()

function emit() {
  for (const listener of listeners) listener()
}

export function toast(text: string, kind: ToastKind = 'info', duration = 3200): void {
  const id = seq++
  items = [...items, { id, text, kind }]
  emit()
  setTimeout(() => {
    items = items.filter((item) => item.id !== id)
    emit()
  }, duration)
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function ToastHost() {
  const list = useSyncExternalStore(
    subscribe,
    () => items,
    () => items,
  )
  if (list.length === 0) return null
  return createPortal(
    <div className={styles.host} role="status" aria-live="polite">
      {list.map((item) => (
        <div key={item.id} className={`${styles.toast} ${styles[item.kind]}`}>
          {item.text}
        </div>
      ))}
    </div>,
    document.body,
  )
}
