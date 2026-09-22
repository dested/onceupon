/**
 * Draw one phrase: stream ops from the drawing model, execute each line as it lands (exactly as the
 * live Director does), settle the picture, and snapshot a 1280x800 JPEG. Batch mode runs on a
 * VirtualClock with instant reveal so the same phrase always renders the same pixels; live mode
 * draws onto a visible canvas in real time for the playground.
 */
import type { Command } from '~/engine/types'
import { Scene } from '~/engine/scene'
import { Stage } from '~/engine/stage'
import { VirtualClock } from '~/engine/clock'
import { hashString } from '~/engine/rng'
import { OpsDialect } from '~/llm/ops-dsl'
import { makeProvider } from '~/llm/providers'
import { estimateCost, type Usage } from '~/llm/models'
import { appStore } from '~/story/store'
import type { DrawLine } from './types'

const NO_KEY =
  'no Anthropic key: set VITE_ANTHROPIC_API_KEY in .env.local or paste it in the app Settings'

const SNAP_W = 1280
const SNAP_H = 800

export interface DrawOptions {
  phrase: string
  /** The prompt version text; dialect.system is ignored. */
  system: string
  /** e.g. 'claude-sonnet-5'. */
  model: string
  mode: 'batch' | 'live'
  /** live: required (visible). batch: a detached 1280x800 canvas is created. */
  canvas?: HTMLCanvasElement
  onLine?: (l: DrawLine) => void
  onText?: (delta: string) => void
  signal?: AbortSignal
}

export interface DrawOutcome {
  ops: string
  lines: DrawLine[]
  parseErrors: number
  firstTokenMs: number | null
  doneMs: number | null
  usage: Usage | null
  costUsd: number | null
  error: string | null
  /** 1280x800 image/jpeg 0.88 of the settled picture. */
  image: Blob
  /** live mode: the caller stops the stage when done with it. */
  stage: Stage
  scene: Scene
}

const delay = (ms: number): Promise<void> => new Promise((r) => window.setTimeout(r, ms))

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('canvas.toBlob returned null'))),
      type,
      quality
    )
  })
}

/** Snapshot a canvas into a fresh 1280x800 JPEG blob. */
async function snapshot(canvas: HTMLCanvasElement): Promise<Blob> {
  const out = document.createElement('canvas')
  out.width = SNAP_W
  out.height = SNAP_H
  const ctx = out.getContext('2d')
  if (!ctx) throw new Error('2d context unavailable for snapshot')
  ctx.drawImage(canvas, 0, 0, SNAP_W, SNAP_H)
  return canvasToBlob(out, 'image/jpeg', 0.88)
}

export async function drawPhrase(o: DrawOptions): Promise<DrawOutcome> {
  const keys = appStore.get().settings.keys
  const provider = makeProvider('anthropic', o.model, keys)
  if (!provider) throw new Error(NO_KEY)

  let canvas: HTMLCanvasElement
  if (o.mode === 'live') {
    if (!o.canvas) throw new Error('live draw needs a visible canvas')
    canvas = o.canvas
  } else {
    canvas = document.createElement('canvas')
    canvas.width = SNAP_W
    canvas.height = SNAP_H
  }

  const scene = new Scene()
  const clock = o.mode === 'batch' ? new VirtualClock() : null
  const stage =
    clock !== null
      ? new Stage(canvas, { seed: hashString(o.phrase), clock, size: { w: SNAP_W, h: SNAP_H } })
      : new Stage(canvas, { seed: hashString(o.phrase) })

  if (o.mode === 'batch') {
    stage.setInstant(true)
    // The judge must never see the crayon cursor.
    stage.showCursor = false
  } else {
    stage.start()
    stage.resize()
  }

  const applyCmd = (cmd: Command): string | null => {
    let warn: string | null = null
    for (const ev of scene.apply(cmd)) {
      if (ev.k === 'warn') warn = ev.message
      stage.handle(ev)
    }
    return warn
  }

  const dialect = new OpsDialect(
    scene,
    clock !== null ? { moderation: true, clock } : { moderation: true }
  )
  dialect.later = (cmds) => {
    for (const cmd of cmds) applyCmd(cmd)
  }

  const lines: DrawLine[] = []
  const record = (l: DrawLine): void => {
    lines.push(l)
    o.onLine?.(l)
  }

  const executeLine = (raw: string): void => {
    const res = dialect.parse(raw)
    if (!res.ok) {
      record({ line: raw, ok: false, error: res.error })
      return
    }
    let warn: string | null = null
    for (const cmd of res.cmds) {
      const w = applyCmd(cmd)
      if (w) warn = w
    }
    record({ line: raw, ok: true, error: warn })
  }

  const user = dialect.buildUser({ storyChunks: [], newWords: o.phrase })
  const signal = o.signal ?? new AbortController().signal

  let raw = ''
  let firstTokenMs: number | null = null
  let doneMs: number | null = null
  let usage: Usage | null = null
  let costUsd: number | null = null
  let error: string | null = null
  let skipped = false

  const t0 = performance.now()
  try {
    let buf = ''
    for await (const chunk of provider.stream({
      system: o.system,
      user,
      maxTokens: dialect.maxTokens,
      signal,
    })) {
      if (chunk.k === 'usage') {
        usage = chunk.usage
        costUsd = estimateCost(o.model, chunk.usage)
        continue
      }
      const deltaText = chunk.text
      if (firstTokenMs === null) firstTokenMs = performance.now() - t0
      raw += deltaText
      o.onText?.(deltaText)
      buf += deltaText
      let nl = buf.indexOf('\n')
      while (nl >= 0) {
        const line = buf.slice(0, nl)
        buf = buf.slice(nl + 1)
        nl = buf.indexOf('\n')
        if (line.trim()) {
          if (dialect.isSkip(line)) {
            record({ line: 'skip', ok: true, error: null })
            skipped = true
            break
          }
          executeLine(line)
        }
      }
      if (skipped) break
    }
    if (!skipped && buf.trim()) {
      if (dialect.isSkip(buf)) record({ line: 'skip', ok: true, error: null })
      else executeLine(buf)
    }
  } catch (e: unknown) {
    error = e instanceof Error ? e.message : String(e)
  } finally {
    doneMs = performance.now() - t0
  }

  // Settle: drive the picture to rest, then snapshot.
  if (clock !== null) {
    const streamEnd = clock.now()
    let t = streamEnd
    for (;;) {
      t += 100
      clock.advanceTo(t)
      stage.renderAt(t)
      if (stage.settled && t >= streamEnd + 4000) break
      if (t >= streamEnd + 20000) break
    }
  } else {
    let consecutive = 0
    const start = performance.now()
    while (performance.now() - start < 12000) {
      await delay(100)
      if (stage.settled) {
        consecutive++
        if (consecutive >= 3) break
      } else {
        consecutive = 0
      }
    }
  }

  // Hide the crayon cursor and draw one more frame so the snapshot is only the picture.
  stage.showCursor = false
  if (clock !== null) stage.renderAt(clock.now())
  else {
    stage.renderAt(performance.now())
    await delay(50)
  }
  const image = await snapshot(canvas)
  const parseErrors = lines.filter((l) => !l.ok).length

  return {
    ops: raw,
    lines,
    parseErrors,
    firstTokenMs,
    doneMs,
    usage,
    costUsd,
    error,
    image,
    stage,
    scene,
  }
}
