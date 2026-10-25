// 首帧前确定主题，避免亮/暗切换闪烁。
// 主题偏好的真源在 ~/.ridley-ai/settings.json，这里读的是它的本地镜像。
try {
  var pref = localStorage.getItem('ridley.theme') || 'system'
  var dark =
    pref === 'dark' ||
    (pref === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
  document.documentElement.dataset.theme = dark ? 'dark' : 'light'
} catch (e) {
  document.documentElement.dataset.theme = 'light'
}
