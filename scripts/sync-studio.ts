#!/usr/bin/env bun
// Copies the hosted single-file studio build into the Expo app so it can serve an offline copy.
// Run after `bun run build:hosted`. Invoked from apps/mobile via `bun run sync-studio`.
import { copyFileSync, existsSync, mkdirSync, statSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const repoRoot = resolve(import.meta.dir, '..')
const source = resolve(repoRoot, 'dist-hosted/index.html')
const dest = resolve(repoRoot, 'apps/mobile/assets/studio.html')

if (!existsSync(source)) {
  console.error(
    `sync-studio: ${source} not found.\n` +
      'Build the hosted studio first: `bun run build:hosted` (VITE_HOSTED=1 single-file build).'
  )
  process.exit(1)
}

mkdirSync(dirname(dest), { recursive: true })
copyFileSync(source, dest)

const kb = (statSync(dest).size / 1024).toFixed(1)
console.log(`sync-studio: copied studio.html (${kb} KB) -> apps/mobile/assets/studio.html`)
