#!/usr/bin/env node
/**
 * 把 Native Messaging host 打包成单文件 exe（Node SEA），
 * 安装脚本检测到 native-host/build/ridley-host.exe 后会优先使用它。
 *
 * 用法：node native-host/scripts/build-sea.mjs
 */
import { build } from 'esbuild'
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const projectRoot = resolve(__dirname, '..', '..')
const outDir = join(projectRoot, 'native-host', 'build')
mkdirSync(outDir, { recursive: true })

const bundlePath = join(outDir, 'host.cjs')
const configPath = join(outDir, 'sea-config.json')
const blobPath = join(outDir, 'sea-prep.blob')
const exePath = join(outDir, 'ridley-host.exe')

console.log('1/4 打包 host 代码…')
await build({
  entryPoints: [join(projectRoot, 'native-host', 'src', 'host.mjs')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  outfile: bundlePath,
  logLevel: 'warning',
})

console.log('2/4 生成 SEA blob…')
writeFileSync(
  configPath,
  JSON.stringify(
    {
      main: bundlePath,
      output: blobPath,
      disableExperimentalSEAWarning: true,
    },
    null,
    2,
  ),
)
execFileSync(process.execPath, ['--experimental-sea-config', configPath], { stdio: 'inherit' })

console.log('3/4 复制 node 可执行文件…')
copyFileSync(process.execPath, exePath)

console.log('4/4 注入 SEA blob…')
const postjectCli = join(projectRoot, 'node_modules', 'postject', 'dist', 'cli.js')
if (!existsSync(postjectCli)) {
  console.error('找不到 postject，请先 pnpm install')
  process.exit(1)
}
execFileSync(
  process.execPath,
  [
    postjectCli,
    exePath,
    'NODE_SEA_BLOB',
    blobPath,
    '--sentinel-fuse',
    'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
  ],
  { stdio: 'inherit' },
)

console.log(`\n完成：${exePath} (${(statSync(exePath).size / 1024 / 1024).toFixed(1)} MB)`)
console.log('接下来运行 pnpm host:install，安装脚本会自动改用这个 exe。')
