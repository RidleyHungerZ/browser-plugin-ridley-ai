#!/usr/bin/env node
/**
 * 安装 Native Messaging host：
 *   1. 把 host 复制到 %LOCALAPPDATA%\RidleyAI\native（纯 ASCII 路径）
 *   2. 生成 host manifest，allowed_origins 使用固定扩展 ID
 *   3. 写入 Chrome / Edge 的 HKCU 注册表项
 *
 * 用法：node native-host/scripts/install.mjs
 * 安装后必须**完全退出并重启浏览器**。
 */
import {
  existsSync,
  mkdirSync,
  copyFileSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  rmSync,
} from 'node:fs'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const projectRoot = resolve(__dirname, '..', '..')
const keyPath = join(projectRoot, '.ridley-key.json')
const hostSrcDir = join(projectRoot, 'native-host', 'src')
const builtExe = join(projectRoot, 'native-host', 'build', 'ridley-host.exe')

if (!existsSync(keyPath)) {
  console.error('找不到 .ridley-key.json，请先运行：node tools/gen-key.mjs')
  process.exit(1)
}

const { extensionId } = JSON.parse(readFileSync(keyPath, 'utf8'))
const localAppData = process.env.LOCALAPPDATA
if (!localAppData) {
  console.error('缺少 LOCALAPPDATA 环境变量')
  process.exit(1)
}

const installDir = join(localAppData, 'RidleyAI', 'native')
mkdirSync(installDir, { recursive: true })

// 1. 复制 host 文件
for (const file of ['host.mjs', 'protocol.mjs', 'rpc.mjs', 'store.mjs', 'logger.mjs']) {
  copyFileSync(join(hostSrcDir, file), join(installDir, file))
}

let hostPath
let currentExeName = null
try {
  if (existsSync(builtExe)) {
    // 用内容哈希命名：浏览器正在运行时不需覆盖被占用的旧文件
    const hash = createHash('sha256').update(readFileSync(builtExe)).digest('hex').slice(0, 8)
    currentExeName = `ridley-host-${hash}.exe`
    hostPath = join(installDir, currentExeName)
    if (!existsSync(hostPath)) copyFileSync(builtExe, hostPath)
    console.log('使用打包好的 exe:', hostPath)
  } else {
    hostPath = join(installDir, 'host.bat')
    const bat = [
      '@echo off',
      'setlocal',
      `"${process.execPath}" "%~dp0host.mjs" %*`,
      'exit /b %ERRORLEVEL%',
      '',
    ].join('\r\n')
    writeFileSync(hostPath, bat, 'ascii')
    console.log('使用 node 启动脚本:', hostPath)
    console.log('  node:', process.execPath)
  }
} catch (err) {
  console.error('复制宿主程序失败：')
  console.error(String(err))
  process.exit(1)
}

// 清理旧版本的 exe（被占用时跳过，下次安装再清）
if (currentExeName) {
  try {
    for (const file of readdirSync(installDir)) {
      const isHostExe = file === 'ridley-host.exe' || /^ridley-host-[0-9a-f]{8}\.exe$/.test(file)
      if (!isHostExe || file === currentExeName) continue
      try {
        rmSync(join(installDir, file), { force: true })
      } catch {
        /* 仍被运行中的浏览器占用 */
      }
    }
  } catch {
    /* ignore */
  }
}

// 2. host manifest
const manifestPath = join(installDir, 'com.ridley.ai.json')
const manifest = {
  name: 'com.ridley.ai',
  description: 'Ridley-AI local session store',
  path: hostPath,
  type: 'stdio',
  allowed_origins: [`chrome-extension://${extensionId}/`],
}
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8')

// 3. 注册表（HKCU，无需管理员）
const registryKeys = [
  'HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\com.ridley.ai',
  'HKCU\\Software\\Microsoft\\Edge\\NativeMessagingHosts\\com.ridley.ai',
]
for (const key of registryKeys) {
  const result = spawnSync('reg', ['add', key, '/ve', '/t', 'REG_SZ', '/d', manifestPath, '/f'], {
    encoding: 'utf8',
  })
  if (result.status !== 0) {
    console.error(`写注册表失败：${key}`)
    console.error(result.stderr || result.stdout)
    process.exit(1)
  }
  console.log('已注册:', key)
}

console.log('\n安装完成')
console.log('  扩展 ID :', extensionId)
console.log('  安装目录:', installDir)
console.log('  数据目录:', join(process.env.USERPROFILE || '', '.ridley-ai'))
console.log('\n请完全退出 Chrome / Edge（包括托盘进程）后重新打开，扩展才能连上本地服务。')
