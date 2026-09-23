/**
 * Authors the first-launch intro slides: each slide's demo beats go through the real ops dialect and
 * Sonnet 5 on a fresh page, and the drawn lines are saved as a StoryRecord the intro replays. Run:
 *   bun scripts/author-intro.ts            (all slides)
 *   bun scripts/author-intro.ts 3          (re-roll slide 3 only, keeping the others)
 * Needs VITE_ANTHROPIC_API_KEY in .env.local. Output: src/tutorial/intro-slides.json.
 * Slide copy and voice lines live in src/tutorial/intro.ts; only the demo beats live here.
 */
import Anthropic from '@anthropic-ai/sdk'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Some engine modules read `window` defensively; give them one before importing the dialect.
if (!Reflect.has(globalThis, 'window')) Reflect.set(globalThis, 'window', globalThis)

const { Scene } = await import('../src/engine/scene')
const { makeDialect } = await import('../src/llm/dialect')

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'src', 'tutorial', 'intro-slides.json')

function envValue(name: string): string {
  const raw = readFileSync(join(ROOT, '.env.local'), 'utf8')
  for (const line of raw.split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line.trim())
    if (m && m[1] === name) return (m[2] ?? '').replace(/^["']|["']$/g, '').trim()
  }
  return ''
}

interface SlideDemo {
  beats: readonly string[]
  /** Close the demo with the "The End" finale. */
  end: boolean
}

const DEMOS: readonly SlideDemo[] = [
  { beats: ['Once upon a time a little purple dragon with big green wings flew over a castle'], end: false },
  { beats: ['A happy orange cat flew a big red rocket all the way up to the moon'], end: false },
  {
    beats: ['A little red car drove down the road', 'No wait, the car is blue and it can fly over the trees'],
    end: false,
  },
  { beats: ['The bunny and the bear had a picnic under the stars'], end: true },
  { beats: ['A pirate ship with a big red sail sailed across the sea under a smiling sun'], end: false },
]

type StoryEvent =
  | { k: 'words'; t: number; text: string }
  | { k: 'cmd'; t: number; line: string }
  | { k: 'end'; t: number }

interface SlideRecord {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  seed: number
  cover: null
  dialect: 'ops'
  events: StoryEvent[]
}

async function streamText(
  client: Anthropic,
  system: string,
  user: { text: string; cache?: boolean }[],
  maxTokens: number
): Promise<string> {
  const stream = client.messages.stream({
    model: 'claude-sonnet-5',
    max_tokens: maxTokens,
    system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
    messages: [
      {
        role: 'user',
        content: user.map((b) =>
          b.cache
            ? { type: 'text' as const, text: b.text, cache_control: { type: 'ephemeral' as const } }
            : { type: 'text' as const, text: b.text }
        ),
      },
    ],
    thinking: { type: 'disabled' },
  })
  let out = ''
  for await (const event of stream) {
    if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') out += event.delta.text
  }
  return out
}

// Lines land a little faster than a live call so each slide finishes drawing while its voice line plays.
const FIRST_CMD_MS = 500
const CMD_GAP_MS = 90
const BEAT_GAP_MS = 1400

async function authorSlide(client: Anthropic, n: number, demo: SlideDemo): Promise<SlideRecord> {
  const scene = new Scene()
  const dialect = makeDialect('ops', scene, { moderation: true })
  const events: StoryEvent[] = []
  const storyChunks: string[] = []
  let t = 0
  for (const words of demo.beats) {
    events.push({ k: 'words', t, text: words })
    const blocks = dialect.buildUser({ storyChunks: [...storyChunks], newWords: words })
    const text = await streamText(client, dialect.system, blocks, dialect.maxTokens)
    let i = 0
    let last = t
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim()
      if (!line) continue
      const res = dialect.parse(line)
      if (!res.ok) {
        console.warn(`slide ${n}: skipped unparsable line: ${line} (${res.error})`)
        continue
      }
      for (const cmd of res.cmds) scene.apply(cmd)
      last = t + FIRST_CMD_MS + CMD_GAP_MS * i
      events.push({ k: 'cmd', t: last, line })
      i++
    }
    console.log(`slide ${n}: "${words}" -> ${i} lines`)
    storyChunks.push(words)
    t = last + BEAT_GAP_MS
  }
  if (demo.end) {
    events.push({ k: 'words', t, text: 'The End' })
    events.push({ k: 'end', t: t + 100 })
  }
  return {
    id: `intro-${n}`,
    title: demo.beats[0] ?? '',
    createdAt: 1758585600000,
    updatedAt: 1758585600000,
    seed: 5150 + n * 97,
    cover: null,
    dialect: 'ops',
    events,
  }
}

async function main(): Promise<void> {
  const apiKey = envValue('VITE_ANTHROPIC_API_KEY')
  if (!apiKey) throw new Error('VITE_ANTHROPIC_API_KEY missing in .env.local')
  const client = new Anthropic({ apiKey })

  const only = process.argv[2] ? Number(process.argv[2]) : null
  const existing: unknown = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : null
  const prev: unknown[] = Array.isArray(existing) ? existing : []

  const out: unknown[] = []
  for (let k = 0; k < DEMOS.length; k++) {
    const n = k + 1
    const demo = DEMOS[k]
    if (!demo) continue
    if (only !== null && only !== n && prev[k] !== undefined) {
      out.push(prev[k])
      continue
    }
    out.push(await authorSlide(client, n, demo))
  }
  writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n')
  console.log(`wrote ${OUT}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
