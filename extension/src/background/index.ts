import { nativeRpc, nativeStatus } from './native'
import { PENDING_ASK_KEY, type PendingAsk } from '@/shared/types'

const MENU_ASK = 'ridley-ask'
const MENU_CALL = 'ridley-call'

/** 重复注册只会产生 duplicate id 错误，吞掉即可；这样 Service Worker 重启不会让菜单消失。 */
function ensureMenus(): void {
  chrome.contextMenus.create(
    { id: MENU_ASK, title: '询问 Ridley-AI', contexts: ['selection'] },
    () => void chrome.runtime.lastError,
  )
  chrome.contextMenus.create(
    {
      id: MENU_CALL,
      title: '呼叫 Ridley-AI',
      // 故意不含 editable：否则输入框内选中文字时会与「询问」同时出现
      contexts: ['page', 'link', 'image', 'video', 'audio', 'frame'],
    },
    () => void chrome.runtime.lastError,
  )
}

function configurePanel(): void {
  chrome.sidePanel.setOptions({ path: 'sidepanel.html', enabled: true }).catch(() => {})
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {})
}

ensureMenus()
configurePanel()

chrome.runtime.onInstalled.addListener(() => {
  ensureMenus()
  configurePanel()
})

chrome.runtime.onStartup.addListener(() => {
  ensureMenus()
  configurePanel()
})

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== MENU_ASK && info.menuItemId !== MENU_CALL) return
  if (!tab || tab.id === undefined || tab.windowId === undefined) return

  // 手势约束：sidePanel.open() 必须是这一行之前没有任何 await 的同步调用。
  void chrome.sidePanel.open({ windowId: tab.windowId }).catch(() => {})

  const kind = info.menuItemId === MENU_ASK ? 'ask' : 'call'
  const nonce = crypto.randomUUID()
  const placeholder: PendingAsk = {
    nonce,
    kind,
    text: info.selectionText ?? '',
    url: tab.url ?? '',
    title: tab.title ?? '',
    at: Date.now(),
  }
  void chrome.storage.session.set({ [PENDING_ASK_KEY]: placeholder })

  if (kind !== 'ask') return

  // selectionText 在 Chromium 中会被截断；注入页面取全量（含 textarea 选区与 iframe）。
  void chrome.scripting
    .executeScript({
      target: { tabId: tab.id, frameIds: [info.frameId ?? 0] },
      func: () => {
        const el = document.activeElement as
          | (HTMLTextAreaElement & HTMLInputElement)
          | null
        if (el && (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT')) {
          return el.value.slice(el.selectionStart ?? 0, el.selectionEnd ?? 0)
        }
        return window.getSelection()?.toString() ?? ''
      },
    })
    .then(([result]) => {
      const text = (result?.result as string | undefined) || placeholder.text
      if (!text) return
      const updated: PendingAsk = { ...placeholder, text, at: Date.now() }
      void chrome.storage.session.set({ [PENDING_ASK_KEY]: updated })
    })
    .catch(() => {
      /* PDF / 沙箱 iframe 等注入失败，退回 selectionText */
    })
})

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || typeof message !== 'object') return
  const msg = message as { type?: string; method?: string; params?: unknown }

  if (msg.type === 'native-rpc' && typeof msg.method === 'string') {
    nativeRpc(msg.method, msg.params).then(
      (result) => sendResponse({ ok: true, result }),
      (error: Error) =>
        sendResponse({ ok: false, error: { message: error?.message ?? String(error) } }),
    )
    return true
  }

  if (msg.type === 'native-status') {
    sendResponse(nativeStatus())
    return false
  }
})
