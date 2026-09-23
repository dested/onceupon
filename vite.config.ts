import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { viteSingleFile } from 'vite-plugin-singlefile'
import { labPlugin } from './scripts/lab-plugin'

const root = fileURLToPath(new URL('./', import.meta.url)).replace(/\\/g, '/')
/** Only these are watched. Vite full-reloads the page on ANY other changed root file (a .md edit, lab/ data), which kills a running lab campaign. */
const WATCHED = ['src/', 'public/', 'scripts/', 'index.html', 'lab.html', '.env', '.env.local']
const notSource = (p: string): boolean => {
  const rel = p.replace(/\\/g, '/').replace(root, '')
  if (rel === '' || rel.startsWith('node_modules')) return false
  return !WATCHED.some((w) => rel === w.replace(/\/$/, '') || rel.startsWith(w))
}

const main = fileURLToPath(new URL('./index.html', import.meta.url))
const lab = fileURLToPath(new URL('./lab.html', import.meta.url))

// `--mode hosted` builds the studio as one inlined file (the website serves it at /app/, the iPad app
// bundles it). Everything else is the bring-your-own-key dev app, with the drawing lab as a second entry.
export default defineConfig(({ mode }) => {
  const hosted = mode === 'hosted'
  const input: Record<string, string> = hosted ? { main } : { main, lab }
  return {
    base: hosted ? './' : '/',
    // Hosted builds must never inline the BYO keys from .env.local: only the two hosted switches are exposed.
    envPrefix: hosted ? ['VITE_HOSTED', 'VITE_API_ORIGIN'] : 'VITE_',
    resolve: { alias: { '~': fileURLToPath(new URL('./src', import.meta.url)) } },
    plugins: [
      tailwindcss(),
      viteReact(),
      labPlugin(),
      ...(hosted ? [viteSingleFile({ removeViteModuleLoader: true })] : []),
    ],
    server: {
      port: 7710,
      strictPort: true,
      watch: { ignored: [notSource] },
    },
    build: {
      rollupOptions: {
        input,
      },
    },
  }
})
