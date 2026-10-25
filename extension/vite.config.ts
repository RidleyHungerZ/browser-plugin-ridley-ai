import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'

const fromHere = (p: string) => fileURLToPath(new URL(p, import.meta.url))

export default defineConfig({
  root: fromHere('./'),
  base: './',
  plugins: [react()],
  resolve: {
    alias: { '@': fromHere('./src') },
  },
  build: {
    outDir: fromHere('../dist'),
    emptyOutDir: true,
    target: 'chrome116',
    sourcemap: false,
    rollupOptions: {
      input: {
        sidepanel: fromHere('./sidepanel.html'),
        background: fromHere('./src/background/index.ts'),
      },
      output: {
        entryFileNames: (chunk) =>
          chunk.name === 'background' ? 'sw.js' : 'assets/[name]-[hash].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
})
