/**
 * Bench a drawing dialect on the API: every story beat is one streamed call sent exactly the way the
 * Director sends it (cached system prompt, earlier beats as cached story chunks, the page described
 * back by the dialect), each line parsed and applied to a Scene as it lands.
 *
 *   bun scripts/proto-bench.ts <dialect> [set=quick|full|id,id] [run=<name>] [model=claude-sonnet-5-5] [conc=4]
 *
 * Writes lab/proto/<run>/<dialect>/<story>.json (BenchFile) and prints a summary. Render the
 * pictures with scripts/proto-render.mjs, compare with scripts/proto-sheet.ts.
 * Key: VITE_ANTHROPIC_API_KEY from .env.local (Bun loads it).
 */
import Anthropic from '@anthropic-ai/sdk'
import { promises as fs } from 'node:fs'
import * as path from 'node:path'
import { Scene } from '~/engine/scene'
import type { Command } from '~/engine/types'
import { realClock } from '~/engine/clock'
import { estimateCost } from '~/llm/models'
import { protoFactory } from '~/proto/registry'
import { benchSet, type BenchStory } from '~/proto/stories'
import type { BenchBeat, BenchFile } from '~/proto/bench-types'

const args = Object.fromEntries(
  process.argv.slice(3).map((a) => {
    const i = a.indexOf('=')
    return i < 0 ? [a, 'true'] : [a.slice(0, i), a.slice(i + 1)]
  })
)
const dialectId = process.argv[2]
if (!dialectId) {
  console.error('usage: bun scripts/proto-bench.ts <dialect> [set=quick] [run=name] [model=claude-sonnet-5-5] [conc=4]')
  process.exit(2)
}
const model = args['model'] ?? 'claude-sonnet-5-5'
const run = args['run'] ?? `${new Date().toISOString().slice(0, 10)}-${dialectId}`
const conc = Number(args['conc'] ?? 4)
const stories = benchSet(args['set'] ?? 'quick')
const key = process.env['VITE_ANTHROPIC_API_KEY']
if (!key) throw new Error('VITE_ANTHROPIC_API_KEY missing (.env.local)')
const client = new Anthropic({ apiKey: key })
const outDir = path.join('lab', 'proto', run, dialectId)
await fs.mkdir(outDir, { recursive: true })

const INK = new Set(['shapesAdded', 'shapesReset', 'bg', 'fx'])

async function benchStory(story: BenchStory): Promise<BenchFile> {
  const scene = new Scene()
  const dialect = protoFactory(dialectId)(scene, { moderation: true, clock: realClock })
  const apply = (cmd: Command): boolean => {
    let ink = false
    for (const ev of scene.apply(cmd)) if (INK.has(ev.k)) ink = true
    return ink
  }
  dialect.later = (cmds) => cmds.forEach(apply)
  let systemTokens: number | null = null
  try {
    const c = await client.messages.countTokens({ model, system: dialect.system, messages: [{ role: 'user', content: 'x' }] })
    systemTokens = c.input_tokens
  } catch {
    systemTokens = null
  }

  const beats: BenchBeat[] = []
  const chunks: string[] = []
  for (const words of story.beats) {
    const user = dialect.buildUser({ storyChunks: [...chunks], newWords: words })
    chunks.push(words)
    const lines: string[] = []
    const parseErrors: string[] = []
    let firstTokenMs: number | null = null
    let firstInkMs: number | null = null
    let usage = { input: 0, cacheRead: 0, cacheWrite: 0, output: 0, costUsd: null as number | null }
    let error: string | null = null
    let skipped = false
    const t0 = performance.now()
    const handle = (line: string): void => {
      if (!line.trim()) return
      lines.push(line)
      if (skipped) return
      if (dialect.isSkip(line)) {
        skipped = true
        return
      }
      const res = dialect.parse(line)
      if (!res.ok) {
        parseErrors.push(`${line}  -> ${res.error}`)
        return
      }
      let ink = false
      for (const cmd of res.cmds) if (apply(cmd)) ink = true
      if (ink && firstInkMs === null) firstInkMs = performance.now() - t0
    }
    try {
      const stream = client.messages.stream({
        model,
        max_tokens: dialect.maxTokens,
        system: [{ type: 'text', text: dialect.system, cache_control: { type: 'ephemeral' } }],
        messages: [
          {
            role: 'user',
            content: user.map((b) =>
              b.cache ? { type: 'text' as const, text: b.text, cache_control: { type: 'ephemeral' as const } } : { type: 'text' as const, text: b.text }
            ),
          },
        ],
        thinking: { type: 'between_tools' },
      })
      let buf = ''
      for await (const ev of stream) {
        if (ev.type === 'message_start') {
          usage.input = ev.message.usage.input_tokens
          usage.cacheRead = ev.message.usage.cache_read_input_tokens ?? 0
          usage.cacheWrite = ev.message.usage.cache_creation_input_tokens ?? 0
        } else if (ev.type === 'message_delta') {
          usage.output = ev.usage.output_tokens
        } else if (ev.type === 'content_block_delta' && ev.delta.type === 'text_delta') {
          if (firstTokenMs === null) firstTokenMs = performance.now() - t0
          buf += ev.delta.text
          let nl = buf.indexOf('\n')
          while (nl >= 0) {
            handle(buf.slice(0, nl))
            buf = buf.slice(nl + 1)
            nl = buf.indexOf('\n')
          }
        }
      }
      handle(buf)
    } catch (e: unknown) {
      error = e instanceof Error ? e.message : String(e)
    }
    const doneMs = performance.now() - t0
    beats.push({
      words,
      lines,
      firstTokenMs,
      firstInkMs,
      doneMs,
      input: usage.input,
      cacheRead: usage.cacheRead,
      cacheWrite: usage.cacheWrite,
      output: usage.output,
      costUsd: estimateCost(model, usage),
      parseErrors,
      error,
    })
  }
  const file: BenchFile = { storyId: story.id, dialect: dialectId, model, systemTokens, beats }
  await fs.writeFile(path.join(outDir, `${story.id}.json`), JSON.stringify(file, null, 1))
  return file
}

// Warm the prompt cache with one call first so every measured call reads it (as in a live session).
const [first, ...rest] = stories
const files: BenchFile[] = []
if (first) files.push(await benchStory(first))
const queue = [...rest]
await Promise.all(
  Array.from({ length: Math.max(1, conc) }, async () => {
    for (let s = queue.shift(); s; s = queue.shift()) files.push(await benchStory(s))
  })
)

const beats = files.flatMap((f) => f.beats)
const ok = beats.filter((b) => !b.error)
const mean = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN)
const med = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b)
  return s.length ? (s[Math.floor(s.length / 2)] ?? NaN) : NaN
}
const nums = (k: 'firstTokenMs' | 'firstInkMs' | 'doneMs' | 'output'): number[] =>
  ok.map((b) => b[k]).filter((v): v is number => typeof v === 'number')
const summary = {
  run,
  dialect: dialectId,
  model,
  systemTokens: files[0]?.systemTokens ?? null,
  calls: beats.length,
  errors: beats.length - ok.length,
  parseErrors: beats.reduce((a, b) => a + b.parseErrors.length, 0),
  medFirstTokenMs: Math.round(med(nums('firstTokenMs'))),
  medFirstInkMs: Math.round(med(nums('firstInkMs'))),
  medDoneMs: Math.round(med(nums('doneMs'))),
  meanOutput: Math.round(mean(nums('output'))),
  meanCostUsd: Number(mean(ok.map((b) => b.costUsd ?? 0)).toFixed(5)),
}
await fs.writeFile(path.join(outDir, '_summary.json'), JSON.stringify(summary, null, 1))
console.log(JSON.stringify(summary))
for (const b of beats) if (b.error) console.log('ERROR', b.words.slice(0, 40), b.error)
for (const f of files) for (const b of f.beats) for (const p of b.parseErrors) console.log('PARSE', f.storyId, p)
