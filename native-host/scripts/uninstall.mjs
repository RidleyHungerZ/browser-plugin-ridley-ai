#!/usr/bin/env node
/** 卸载 Native Messaging host：删除注册表项与安装目录（不删除聊天数据）。 */
import { existsSync, rmSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'

const registryKeys = [
  'HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\com.ridley.ai',
  'HKCU\\Software\\Microsoft\\Edge\\NativeMessagingHosts\\com.ridley.ai',
]

for (const key of registryKeys) {
  const result = spawnSync('reg', ['delete', key, '/f'], { encoding: 'utf8' })
  if (result.status === 0) console.log('已删除:', key)
  else console.log('未找到，跳过:', key)
}

const installDir = join(process.env.LOCALAPPDATA || '', 'RidleyAI')
if (installDir && existsSync(installDir)) {
  rmSync(installDir, { recursive: true, force: true })
  console.log('已删除安装目录:', installDir)
}

console.log('\n聊天记录仍保留在 C:\\Users\\%USERNAME%\\.ridley-ai，如需清除请手动删除。')
console.log('请重启浏览器。')
