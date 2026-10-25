import { useEffect } from 'react'
import { ChatView } from './features/chat/ChatView'
import { Composer } from './features/chat/Composer'
import { Header } from './features/chat/Header'
import { HistoryDrawer } from './features/history/HistoryDrawer'
import { SettingsModal } from './features/settings/SettingsModal'
import { bootstrap, watchSystemTheme, watchPendingAsk } from './state/chat'
import { useAppStore } from './state/store'
import { Icon } from './ui/Icon'
import { ToastHost } from './ui/Toast'
import styles from './App.module.css'

export default function App() {
  const ready = useAppStore((state) => state.ready)
  const settings = useAppStore((state) => state.settings)
  const settingsError = useAppStore((state) => state.settingsError)

  useEffect(() => {
    void bootstrap()
  }, [])

  useEffect(() => watchSystemTheme(), [])

  useEffect(() => {
    const dispose = watchPendingAsk()
    return dispose
  }, [])

  useEffect(() => {
    const size = settings?.ui.fontSize ?? 14
    document.documentElement.style.setProperty('--rds-font-size', `${size}px`)
  }, [settings?.ui.fontSize])

  return (
    <div className={styles.app}>
      <Header />

      {settingsError ? (
        <div className={styles.errorBanner}>
          <Icon name="alert" size={14} />
          <div className={styles.errorBody}>
            <strong>本地服务未连接</strong>
            <span>{settingsError}</span>
            <code>pnpm host:install</code>
          </div>
        </div>
      ) : null}

      {!ready ? (
        <div className={styles.loading}>
          <span className={styles.spinner} />
          正在加载…
        </div>
      ) : (
        <>
          <ChatView />
          <Composer />
        </>
      )}

      <HistoryDrawer />
      <SettingsModal />
      <ToastHost />
    </div>
  )
}
