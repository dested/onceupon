/**
 * Authors the bundled first-launch tutorial story with the real ops dialect and Sonnet 5, then writes
 * it as a StoryRecord JSON the Tutorial replays. Run once:
 *   bun scripts/author-tutorial.ts
 * Needs VITE_ANTHROPIC_API_KEY in .env.local. Output: src/tutorial/tutorial-record.json.
 */
import Anthropic from '@anthropic-ai/sdk'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Some engine modules read `window` defensively; give them one before importing the dialect.
if (!Reflect.has(globalThis, 'window')) Reflect.set(globalThis, 'window', globalThis)

const { Scene } = await import('../src/engine/scene')
const { makeDialect } = await import('../src/llm/dialect')

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

function envValue(name: string): string {
  const raw = readFileSync(join(ROOT, '.env.local'), 'utf8')
  for (const line of raw.split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line.trim())
    if (m && m[1] === name) return (m[2] ?? '').replace(/^["']|["']$/g, '').trim()
  }
  return ''
}

const BEATS: readonly string[] = [
  'Once upon a time there was a little green dragon who lived in a castle on a hill',
  'One day the dragon flew up into the sky and found a rainbow',
  'The dragon slid down the rainbow and landed in a big pile of sparkly stars',
]

type StoryEvent =
  | { k: 'words'; t: number; text: string }
  | { k: 'cmd'; t: number; line: string }
  | { k: 'end'; t: number }

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
    if (event.type === 'content_block_delta' && event.delta.type === 'text_delta')
      out += event.delta.text
  }
  return out
}

async function main(): Promise<void> {
  const apiKey = envValue('VITE_ANTHROPIC_API_KEY')
  if (!apiKey) throw new Error('VITE_ANTHROPIC_API_KEY missing in .env.local')
  const client = new Anthropic({ apiKey })

  const scene = new Scene()
  const dialect = makeDialect('ops', scene, { moderation: true })

  const events: StoryEvent[] = []
  const storyChunks: string[] = []
  let cmdCount = 0

  for (let k = 0; k < BEATS.length; k++) {
    const newWords = BEATS[k] ?? ''
    const wordsT = k * 7000
    events.push({ k: 'words', t: wordsT, text: newWords })

    const blocks = dialect.buildUser({ storyChunks: [...storyChunks], newWords })
    const text = await streamText(client, dialect.system, blocks, dialect.maxTokens)
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)

    let i = 0
    for (const line of lines) {
      const res = dialect.parse(line)
      if (!res.ok) {
        console.warn(`beat ${k + 1}: skipped unparsable line: ${line} (${res.error})`)
        continue
      }
      for (const cmd of res.cmds) scene.apply(cmd)
      events.push({ k: 'cmd', t: wordsT + 900 + 130 * i, line })
      i++
      cmdCount++
    }
    storyChunks.push(newWords)
    console.log(`beat ${k + 1}: ${i} ops lines kept`)
  }

  const lastCmd = events.reduce((m, e) => (e.k === 'cmd' ? Math.max(m, e.t) : m), 0)
  events.push({ k: 'words', t: lastCmd + 2000, text: 'The End' })
  events.push({ k: 'end', t: lastCmd + 2100 })

  const record = {
    id: 'tutorial',
    title: 'The little green dragon',
    createdAt: 1758585600000,
    updatedAt: 1758585600000,
    seed: 424242,
    cover: null,
    dialect: 'ops',
    events,
  }

  const wordsCount = events.filter((e) => e.k === 'words').length
  if (wordsCount < 3 || cmdCount < 20)
    console.warn(`WARNING: ${wordsCount} words events, ${cmdCount} cmd lines (want >=3 and >=20)`)

  const out = join(ROOT, 'src', 'tutorial', 'tutorial-record.json')
  writeFileSync(out, JSON.stringify(record, null, 2) + '\n')
  console.log(`wrote ${out}: ${wordsCount} words events, ${cmdCount} cmd lines`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
