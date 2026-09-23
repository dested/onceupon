/**
 * Renders the four tutorial coach lines to mp3 with OpenAI TTS. Run once:
 *   bun scripts/render-coach.ts
 * Writes src/tutorial/coach/1.mp3 … 4.mp3. Needs VITE_OPENAI_API_KEY in .env.local.
 */
import { readFileSync, mkdirSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

function envValue(name: string): string {
  const raw = readFileSync(join(ROOT, '.env.local'), 'utf8')
  for (const line of raw.split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line.trim())
    if (m && m[1] === name) return (m[2] ?? '').replace(/^["']|["']$/g, '').trim()
  }
  return ''
}

const LINES: readonly string[] = [
  "Tell your story out loud, like you're telling a friend.",
  'Look! The crayon is drawing your words. Watch your story come to life.',
  'When the crayon stops, tell what happens next.',
  'All done? Just say: The End!',
]

const INSTRUCTIONS =
  'Warm, gentle, unhurried, with a smile; you are talking to a five-year-old.'

async function main(): Promise<void> {
  const key = envValue('VITE_OPENAI_API_KEY')
  if (!key) throw new Error('VITE_OPENAI_API_KEY missing in .env.local')
  const outDir = join(ROOT, 'src', 'tutorial', 'coach')
  mkdirSync(outDir, { recursive: true })
  for (let i = 0; i < LINES.length; i++) {
    const input = LINES[i]
    const res = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4o-mini-tts',
        voice: 'coral',
        input,
        instructions: INSTRUCTIONS,
        response_format: 'mp3',
      }),
    })
    if (!res.ok) throw new Error(`line ${i + 1}: ${res.status} ${await res.text()}`)
    const bytes = new Uint8Array(await res.arrayBuffer())
    const path = join(outDir, `${i + 1}.mp3`)
    await writeFile(path, bytes)
    console.log(`wrote ${path} (${(bytes.length / 1024).toFixed(1)} KB)`)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
