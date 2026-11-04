#!/usr/bin/env bun
// Builds the hosted single-file studio for the Expo app's offline copy and copies it to
// apps/mobile/assets/studio.html. The API origin is always BRAND.origin, whatever local env files say
// (`.env.hosted.local` points dev builds at localhost; process env beats every .env file in Vite), and
// the copy is refused if the output still holds a localhost or 127.0.0.1 URL.
// Run from apps/mobile (`bun run sync-studio`) or the repo root (`bun scripts/sync-studio.ts`).
// `--no-build` skips the build and only checks + copies an existing dist-hosted/index.html.
// Exit codes: 0 copied, 1 build failed or the output is unsafe to ship, 64 bad usage.
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { BRAND } from '../packages/shared/src/brand'

const args = process.argv.slice(2)
const unknown = args.filter((a) => a !== '--no-build')
if (unknown.length > 0) {
  console.error(`sync-studio: unknown argument ${unknown.join(' ')} (only --no-build)`)
  process.exit(64)
}
const build = !args.includes('--no-build')

const repoRoot = resolve(import.meta.dir, '..')
const source = resolve(repoRoot, 'dist-hosted/index.html')
const dest = resolve(repoRoot, 'apps/mobile/assets/studio.html')

if (build) {
  console.log(`sync-studio: building dist-hosted with VITE_API_ORIGIN=${BRAND.origin}`)
  const run = Bun.spawnSync(['bun', 'run', 'build:hosted'], {
    cwd: repoRoot,
    env: { ...process.env, VITE_HOSTED: '1', VITE_API_ORIGIN: BRAND.origin },
    stdout: 'inherit',
    stderr: 'inherit',
  })
  if (run.exitCode !== 0) {
    console.error(`sync-studio: build:hosted failed (exit ${run.exitCode})`)
    process.exit(1)
  }
}

if (!existsSync(source)) {
  console.error(`sync-studio: ${source} not found. Run without --no-build to build it.`)
  process.exit(1)
}

const html = readFileSync(source, 'utf8')
// A URL pointing at this machine (`http://localhost:7720`, `//127.0.0.1/…`). Bare hostname
// comparisons are left alone: a bundled library checks `hostname === "localhost"` to allow plain http.
const LOCAL_URL = /(?:https?:)?\/\/(?:localhost|127\.0\.0\.1)(?![\w.-])/g
const leaks = [...html.matchAll(LOCAL_URL)]
if (leaks.length > 0) {
  for (const leak of leaks.slice(0, 5)) {
    const at = leak.index
    console.error(`sync-studio: ${source} contains "${leak[0]}": …${html.slice(Math.max(0, at - 60), at + 40)}…`)
  }
  console.error('sync-studio: not copied; the offline studio could never reach the API.')
  process.exit(1)
}
if (!html.includes(BRAND.origin)) {
  console.error(`sync-studio: ${source} never mentions ${BRAND.origin}; was VITE_API_ORIGIN applied? Not copied.`)
  process.exit(1)
}

mkdirSync(dirname(dest), { recursive: true })
copyFileSync(source, dest)

const kb = (statSync(dest).size / 1024).toFixed(1)
console.log(`sync-studio: copied studio.html (${kb} KB, API ${BRAND.origin}) -> ${dest}`)
