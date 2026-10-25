#!/usr/bin/env node
/**
 * 从内联 SVG 生成扩展图标（16/32/48/128）。
 * 用法：node tools/gen-icons.mjs
 */
import { mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const __dirname = dirname(fileURLToPath(import.meta.url))
const outDir = resolve(__dirname, '..', 'extension', 'public', 'icons')
mkdirSync(outDir, { recursive: true })

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#5b8df2"/>
      <stop offset="1" stop-color="#3b6ad4"/>
    </linearGradient>
  </defs>
  <rect width="128" height="128" rx="30" fill="url(#g)"/>
  <path d="M34 38h60a14 14 0 0 1 14 14v30a14 14 0 0 1-14 14H66l-17 15v-15H34a14 14 0 0 1-14-14V52a14 14 0 0 1 14-14z" fill="#ffffff"/>
  <circle cx="47" cy="67" r="5.5" fill="#4176E6"/>
  <circle cx="64" cy="67" r="5.5" fill="#4176E6"/>
  <circle cx="81" cy="67" r="5.5" fill="#4176E6"/>
</svg>`

for (const size of [16, 32, 48, 128]) {
  await sharp(Buffer.from(svg))
    .resize(size, size)
    .png()
    .toFile(join(outDir, `icon${size}.png`))
  console.log(`icon${size}.png`)
}
