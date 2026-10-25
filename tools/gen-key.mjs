#!/usr/bin/env node
/**
 * 生成固定的扩展公钥 / 扩展 ID，并写出带 key 字段的 manifest。
 *
 * 扩展 ID = sha256(DER 公钥) 前 16 字节，每个 nibble 映射到 'a'..'p'。
 * Chrome 与 Edge 都尊重 manifest.key，因此重载/换目录都不会改变 ID，
 * Native Messaging host 的 allowed_origins 才能稳定匹配。
 *
 * 用法：node tools/gen-key.mjs
 * 重复执行是幂等的：已存在 .ridley-key.json 时直接复用。
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { createHash, generateKeyPairSync } from 'node:crypto'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')
const keyPath = join(root, '.ridley-key.json')
const manifestPath = join(root, 'extension', 'public', 'manifest.json')

function publicKeyToId(derBuffer) {
  const hash = createHash('sha256').update(derBuffer).digest('hex').slice(0, 32)
  return [...hash].map((nibble) => String.fromCharCode(97 + parseInt(nibble, 16))).join('')
}

let keyData
if (existsSync(keyPath)) {
  keyData = JSON.parse(readFileSync(keyPath, 'utf8'))
} else {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const der = publicKey.export({ type: 'spki', format: 'der' })
  keyData = {
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }),
    publicKeyDer: der.toString('base64'),
    extensionId: publicKeyToId(der),
    createdAt: new Date().toISOString(),
  }
  writeFileSync(keyPath, JSON.stringify(keyData, null, 2), 'utf8')
  console.log('已生成新的密钥对：', keyPath)
}

const manifest = {
  manifest_version: 3,
  name: 'Ridley-AI',
  version: '0.1.0',
  description: '个人用 AI 侧边栏助手：选中文字右键询问，记录保存在 ~/.ridley-ai',
  minimum_chrome_version: '116',
  key: keyData.publicKeyDer,
  permissions: [
    'sidePanel',
    'contextMenus',
    'storage',
    'nativeMessaging',
    'scripting',
    'activeTab',
    'tabs',
  ],
  host_permissions: ['<all_urls>'],
  background: { service_worker: 'sw.js', type: 'module' },
  side_panel: { default_path: 'sidepanel.html' },
  action: {
    default_title: 'Ridley-AI',
    default_icon: { 16: 'icons/icon16.png', 32: 'icons/icon32.png' },
  },
  icons: {
    16: 'icons/icon16.png',
    32: 'icons/icon32.png',
    48: 'icons/icon48.png',
    128: 'icons/icon128.png',
  },
}

mkdirSync(dirname(manifestPath), { recursive: true })
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8')

console.log('扩展 ID:', keyData.extensionId)
console.log('manifest:', manifestPath)
