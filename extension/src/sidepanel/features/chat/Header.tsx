import { startNewSession } from '../../state/chat'
import { useAppStore } from '../../state/store'
import { Icon } from '../../ui/Icon'
import styles from './Header.module.css'

export function Header() {
  const activeMeta = useAppStore((state) => state.activeMeta)
  const activeSessionId = useAppStore((state) => state.activeSessionId)
  const status = useAppStore((state) => state.status)
  const streaming = useAppStore((state) => state.streaming)
  const patch = useAppStore((state) => state.patch)

  const busy = status !== 'idle'
  const busyHere = busy && streaming?.sessionId === activeSessionId
  const busyElsewhere = busy && !busyHere

  const title = activeMeta?.title || 'Ridley-AI'

  return (
    <header className={styles.header}>
      <div className={styles.center}>
        <div className={styles.title} title={title}>
          {title}
        </div>
        {busyHere ? (
          <div className={styles.busy}>
            <span className={styles.pulse} />
            生成中
          </div>
        ) : busyElsewhere ? (
          <div className={styles.busy}>
            <span className={styles.pulse} />
            后台生成中
          </div>
        ) : activeSessionId ? null : (
          <div className={styles.subtle}>尚未开始</div>
        )}
      </div>

      <button
        type="button"
        className={styles.iconBtn}
        onClick={() => startNewSession({ force: true })}
        title="新建会话"
        aria-label="新建会话"
      >
        <Icon name="plus" size={17} />
      </button>
      <button
        type="button"
        className={styles.iconBtn}
        onClick={() => patch({ historyOpen: true })}
        title="历史会话"
        aria-label="历史会话"
      >
        <Icon name="history" size={17} />
      </button>
      <button
        type="button"
        className={styles.iconBtn}
        onClick={() => patch({ settingsOpen: true })}
        title="设置"
        aria-label="设置"
      >
        <Icon name="settings" size={17} />
      </button>
    </header>
  )
}
