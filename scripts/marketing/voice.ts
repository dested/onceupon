/**
 * Renders every marketing story line in the kid voice (ElevenLabs eleven_v4, with-timestamps), so the
 * capture can feed each word to the fake shell's speech results as it is spoken.
 *   bun scripts/marketing/voice.ts [theme...]
 * Needs ELEVENLABS_API_KEY in .env (keys: onceupon-f). Writes store/marketing/voice/<theme>-<n>.mp3
 * and store/marketing/voice/<theme>.json: { voice, lines: [{ text, file, dur, words: [{ w, start, end }] }] }.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import { STORIES, VOICE } from './stories'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const OUT = join(ROOT, 'store', 'marketing', 'voice')

function envValue(name: string): string {
  const raw = readFileSync(join(ROOT, '.env'), 'utf8')
  for (const line of raw.split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line.trim())
    if (m && m[1] === name) return (m[2] ?? '').replace(/^["']|["']$/g, '').trim()
  }
  return ''
}

const alignmentSchema = z.object({
  characters: z.array(z.string()),
  character_start_times_seconds: z.array(z.number()),
  character_end_times_seconds: z.array(z.number()),
})
const responseSchema = z.object({ audio_base64: z.string(), alignment: alignmentSchema.nullable() })

export interface Word {
  w: string
  start: number
  end: number
}

/** Words (split on spaces) with the first character's start and the last character's end. */
function wordsOf(a: z.infer<typeof alignmentSchema>): Word[] {
  const out: Word[] = []
  let cur: Word | null = null
  a.characters.forEach((ch, i) => {
    const s = a.character_start_times_seconds[i] ?? 0
    const e = a.character_end_times_seconds[i] ?? s
    if (/\s/.test(ch)) {
      if (cur) out.push(cur)
      cur = null
      return
    }
    if (!cur) cur = { w: ch, start: s, end: e }
    else {
      cur.w += ch
      cur.end = e
    }
  })
  if (cur) out.push(cur)
  return out
}

async function speak(key: string, text: string): Promise<{ mp3: Uint8Array; words: Word[] }> {
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${VOICE.id}/with-timestamps?output_format=mp3_44100_128`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'xi-api-key': key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, model_id: VOICE.model }),
  })
  if (!res.ok) throw new Error(`${text}: ${res.status} ${await res.text()}`)
  const body = responseSchema.parse(await res.json())
  if (!body.alignment) throw new Error(`${text}: no alignment returned`)
  return { mp3: Buffer.from(body.audio_base64, 'base64'), words: wordsOf(body.alignment) }
}

async function main(): Promise<void> {
  const key = envValue('ELEVENLABS_API_KEY')
  if (!key) throw new Error('ELEVENLABS_API_KEY missing in .env (keys new elevenlabs --project onceupon-f)')
  const only = process.argv.slice(2)
  mkdirSync(OUT, { recursive: true })
  for (const story of STORIES) {
    if (only.length > 0 && !only.includes(story.theme)) continue
    const lines: { text: string; file: string; dur: number; words: Word[] }[] = []
    for (let i = 0; i < story.lines.length; i++) {
      const text = story.lines[i] ?? ''
      const file = `${story.theme}-${i + 1}.mp3`
      const { mp3, words } = await speak(key, text)
      writeFileSync(join(OUT, file), mp3)
      const dur = words.reduce((m, w) => Math.max(m, w.end), 0)
      lines.push({ text, file, dur, words })
      console.log(`${file}  ${dur.toFixed(2)} s  ${words.length} words  "${text}"`)
    }
    writeFileSync(
      join(OUT, `${story.theme}.json`),
      JSON.stringify({ voice: VOICE, theme: story.theme, title: story.title, lines }, null, 2) + '\n'
    )
  }
}

main().catch((e: unknown) => {
  console.error(e)
  process.exit(1)
})
