import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { labPlugin } from './scripts/lab-plugin'

const root = fileURLToPath(new URL('./', import.meta.url)).replace(/\\/g, '/')
/** Only these are watched. Vite full-reloads the page on ANY other changed root file (a .md edit, lab/ data), which kills a running lab campaign. */
const WATCHED = ['src/', 'public/', 'scripts/', 'index.html', 'lab.html', '.env', '.env.local']
const notSource = (p: string): boolean => {
  const rel = p.replace(/\\/g, '/').replace(root, '')
  if (rel === '' || rel.startsWith('node_modules')) return false
  return !WATCHED.some((w) => rel === w.replace(/\/$/, '') || rel.startsWith(w))
}

export default defineConfig({
  resolve: { alias: { '~': fileURLToPath(new URL('./src', import.meta.url)) } },
  plugins: [tailwindcss(), viteReact(), labPlugin()],
  server: {
    port: 7710,
    strictPort: true,
    watch: { ignored: [notSource] },
  },
  build: {
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        lab: fileURLToPath(new URL('./lab.html', import.meta.url)),
      },
    },
  },
})
