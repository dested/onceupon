/**
 * Bench a drawing dialect on the API: every story beat is one streamed call sent exactly the way the
 * Director sends it (cached system prompt, earlier beats as cached story chunks, the page described
 * back by the dialect), each line parsed and applied to a Scene as it lands.
 *
 *   bun scripts/proto-bench.ts <dialect> [set=quick|full|tail|id,id|@stories.json] [run=<name>] [model=claude-sonnet-5-5]
 *     [conc=4] [thinking=fast|between|adaptive-low|disabled] [system=@prompt.txt]
 *
 * thinking=fast (default) is fastThinking(model), what the relay sends. set=@file reads a BenchStory[] JSON.
 * system=@file replaces the dialect's system prompt (A/B a prompt edit against a saved older prompt).
 * Writes lab/proto/<run>/<dialect>/<story>.json (BenchFile), results.jsonl (one row per beat, with stop
 * reason and skip) and prints a summary. Render the
 * pictures with scripts/proto-render.mjs, compare with scripts/proto-sheet.ts.
 * Key: VITE_ANTHROPIC_API_KEY from .env.local (Bun loads it).
 */
import Anthropic from '@anthropic-ai/sdk'
import { promises as fs } from 'node:fs'
import * as path from 'node:path'
import { Scene } from '~/engine/scene'
import type { Command } from '~/engine/types'
import { VirtualClock } from '~/engine/clock'
import { estimateCost } from '~/llm/models'
import { fastThinking } from '~/llm/anthropic-thinking'
import { protoFactory } from '~/proto/registry'
import { benchSet, type BenchStory } from '~/proto/stories'
import { z } from 'zod'
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
/**
 * fast = fastThinking(model) (the relay's setting); between = thinking between_tools (Sonnet 5.5's
 * lowest); adaptive-low = adaptive + effort low; disabled = thinking off.
 */
const thinkingMode = args['thinking'] ?? 'fast'
const thinkingParams = (): ReturnType<typeof fastThinking> => {
  if (thinkingMode === 'adaptive-low') {
    return { thinking: { type: 'adaptive', display: 'omitted' }, output_config: { effort: 'low' } }
  }
  if (thinkingMode === 'between') return { thinking: { type: 'between_tools' } }
  if (thinkingMode === 'disabled') return { thinking: { type: 'disabled' } }
  if (thinkingMode === 'fast') return fastThinking(model)
  throw new Error(`unknown thinking=${thinkingMode} (fast|between|adaptive-low|disabled)`)
}
const storyFileSchema = z.array(z.object({ id: z.string(), beats: z.array(z.string()).min(1) }))
const setArg = args['set'] ?? 'quick'
const stories: BenchStory[] = setArg.startsWith('@')
  ? storyFileSchema.parse(JSON.parse(await fs.readFile(setArg.slice(1), 'utf8')))
  : benchSet(setArg)
const systemArg = args['system']
const systemOverride = systemArg?.startsWith('@') ? await fs.readFile(systemArg.slice(1), 'utf8') : null
const key = process.env['VITE_ANTHROPIC_API_KEY']
if (!key) throw new Error('VITE_ANTHROPIC_API_KEY missing (.env.local)')
const client = new Anthropic({ apiKey: key })
const outDir = path.join('lab', 'proto', run, dialectId)
await fs.mkdir(outDir, { recursive: true })
const resultsPath = path.join(outDir, 'results.jsonl')
await fs.writeFile(resultsPath, '')

const INK = new Set(['shapesAdded', 'shapesReset', 'bg', 'fx'])

async function benchStory(story: BenchStory): Promise<BenchFile> {
  const scene = new Scene()
  // Virtual time (Bun has no window timers): delayed commands (a pose ending) fire between beats,
  // as they would while the child keeps talking.
  const clock = new VirtualClock()
  const dialect = protoFactory(dialectId)(scene, { moderation: true, clock })
  const apply = (cmd: Command): boolean => {
    let ink = false
    for (const ev of scene.apply(cmd)) if (INK.has(ev.k)) ink = true
    return ink
  }
  dialect.later = (cmds) => cmds.forEach(apply)
  const system = systemOverride ?? dialect.system
  let systemTokens: number | null = null
  try {
    const c = await client.messages.countTokens({ model, system, messages: [{ role: 'user', content: 'x' }] })
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
    let stopReason: string | null = null
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
        system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
        messages: [
          {
            role: 'user',
            content: user.map((b) =>
              b.cache ? { type: 'text' as const, text: b.text, cache_control: { type: 'ephemeral' as const } } : { type: 'text' as const, text: b.text }
            ),
          },
        ],
        ...thinkingParams(),
      })
      let buf = ''
      for await (const ev of stream) {
        if (ev.type === 'message_start') {
          usage.input = ev.message.usage.input_tokens
          usage.cacheRead = ev.message.usage.cache_read_input_tokens ?? 0
          usage.cacheWrite = ev.message.usage.cache_creation_input_tokens ?? 0
        } else if (ev.type === 'message_delta') {
          usage.output = ev.usage.output_tokens
          stopReason = ev.delta.stop_reason ?? stopReason
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
    clock.advanceTo(clock.now() + 20000)
    const costUsd = estimateCost(model, usage)
    const row = {
      story: story.id,
      beat: beats.length + 1,
      model,
      thinking: thinkingMode,
      words,
      firstTokenMs,
      firstInkMs,
      doneMs,
      input: usage.input,
      cacheRead: usage.cacheRead,
      cacheWrite: usage.cacheWrite,
      output: usage.output,
      costUsd,
      parseErrors: parseErrors.length,
      skipped,
      stopReason,
      error,
    }
    await fs.appendFile(resultsPath, JSON.stringify(row) + '\n')
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
      costUsd,
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
