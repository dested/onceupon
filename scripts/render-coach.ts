/**
 * Renders the spoken lines to mp3 with ElevenLabs Eleven v4 (Sal's rule: every voiceover is eleven_v4).
 *   bun scripts/render-coach.ts                  the four coach lines -> src/tutorial/coach/1..4.mp3
 *   bun scripts/render-coach.ts intro            the intro slides (src/tutorial/intro-copy.ts) -> src/tutorial/intro/1..N.mp3
 *   bun scripts/render-coach.ts samples <dir>    one intro line + one coach line per candidate voice -> <dir>/<name>-*.mp3
 * Needs ELEVENLABS_API_KEY in .env (keys: onceupon-f). NARRATOR below is the voice Sal picked.
 */
import { mkdirSync, readFileSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { INTRO_COPY } from '../src/tutorial/intro-copy'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/** ElevenLabs voice-library candidates for the narrator (2026-11-04). */
const CANDIDATES = {
  veda: 'IR4Yywb88oVWHqzWLjAs', // Veda Sky, animated narrator for kids (US, female)
  emma: 'oClOrzqamOXmtcB8iqTj', // Emma, bright kids educator (US, female)
  nathaniel: 'h9CKu0pq1LSjIPhJEGCv', // Nathaniel C, bedtime storyteller (British, male)
} as const
type Candidate = keyof typeof CANDIDATES
const CANDIDATE_NAMES: readonly Candidate[] = ['veda', 'emma', 'nathaniel']

/** The narrator for the shipped mp3s; set from Sal's pick. */
const NARRATOR: Candidate = 'veda'

const COACH_LINES: readonly string[] = [
  "Tell your story out loud, like you're telling a friend.",
  'Look! The crayon is drawing your words. Watch your story come to life.',
  'When the crayon stops, tell what happens next.',
  'All done? Just say: The End!',
]

function envValue(name: string): string {
  const raw = readFileSync(join(ROOT, '.env'), 'utf8')
  for (const line of raw.split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line.trim())
    if (m && m[1] === name) return (m[2] ?? '').replace(/^["']|["']$/g, '').trim()
  }
  return ''
}

async function speak(key: string, voiceId: string, text: string, path: string): Promise<void> {
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`, {
    method: 'POST',
    headers: { 'xi-api-key': key, 'Content-Type': 'application/json', accept: 'audio/mpeg' },
    body: JSON.stringify({ text, model_id: 'eleven_v4' }),
  })
  if (!res.ok) throw new Error(`${path}: ${res.status} ${await res.text()}`)
  const bytes = new Uint8Array(await res.arrayBuffer())
  await writeFile(path, bytes)
  console.log(`wrote ${path} (${(bytes.length / 1024).toFixed(1)} KB)`)
}

async function main(): Promise<void> {
  const key = envValue('ELEVENLABS_API_KEY')
  if (!key) throw new Error('ELEVENLABS_API_KEY missing in .env (keys new elevenlabs --project onceupon-f)')
  const mode = process.argv[2] ?? 'coach'
  if (mode === 'samples') {
    const dir = process.argv[3]
    if (!dir) throw new Error('samples needs an output dir')
    mkdirSync(dir, { recursive: true })
    const intro = INTRO_COPY[0]?.voice ?? ''
    for (const name of CANDIDATE_NAMES) {
      await speak(key, CANDIDATES[name], intro, join(dir, `${name}-intro.mp3`))
      await speak(key, CANDIDATES[name], COACH_LINES[3] ?? '', join(dir, `${name}-coach.mp3`))
    }
    return
  }
  const intro = mode === 'intro'
  const lines = intro ? INTRO_COPY.map((c) => c.voice) : COACH_LINES
  const outDir = join(ROOT, 'src', 'tutorial', intro ? 'intro' : 'coach')
  mkdirSync(outDir, { recursive: true })
  for (let i = 0; i < lines.length; i++) {
    await speak(key, CANDIDATES[NARRATOR], lines[i] ?? '', join(outDir, `${i + 1}.mp3`))
  }
}

await main()
