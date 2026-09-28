/**
 * Render a benched story (every beat's streamed lines) through a prototype dialect and the real
 * Stage, snapshotting the settled page after each beat. Same execution path as the lab's renderOps:
 * VirtualClock, instant reveal, no cursor, seed hashString(storyId), so a re-render is identical.
 */
import type { Command } from '~/engine/types'
import { Scene } from '~/engine/scene'
import { Stage } from '~/engine/stage'
import { VirtualClock } from '~/engine/clock'
import { hashString } from '~/engine/rng'
import { protoFactory } from './registry'
import type { BenchFile } from './bench-types'

const SETTLE_MIN_MS = 4000
const SETTLE_CAP_MS = 15000

export interface RenderedBeat {
  image: Blob
  parseErrors: string[]
  warnings: string[]
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('canvas.toBlob returned null'))), 'image/jpeg', 0.88)
  })
}

export interface RenderOptions {
  /** Stage look ('classic' today; the pop prototype adds more). Passed through to the Stage. */
  style?: string
}

export async function renderBench(file: BenchFile, opts: RenderOptions = {}): Promise<RenderedBeat[]> {
  const canvas = document.createElement('canvas')
  const size = { w: 1280, h: 800 }
  canvas.width = size.w
  canvas.height = size.h
  const clock = new VirtualClock()
  const scene = new Scene()
  const stage = new Stage(canvas, {
    seed: hashString(file.storyId),
    clock,
    size,
    style: opts.style === 'pop' ? 'pop' : 'classic',
  })
  stage.setInstant(true)
  stage.showCursor = false

  const dialect = protoFactory(file.dialect)(scene, { moderation: true, clock })
  let warnings: string[] = []
  const applyCmd = (cmd: Command): void => {
    for (const ev of scene.apply(cmd)) {
      if (ev.k === 'warn') warnings.push(ev.message)
      stage.handle(ev)
    }
  }
  dialect.later = (cmds) => cmds.forEach(applyCmd)

  const out: RenderedBeat[] = []
  for (const beat of file.beats) {
    const parseErrors: string[] = []
    warnings = []
    for (const raw of beat.lines) {
      if (!raw.trim()) continue
      if (dialect.isSkip(raw)) break
      const res = dialect.parse(raw)
      if (!res.ok) {
        parseErrors.push(`${raw}  -> ${res.error}`)
        continue
      }
      res.cmds.forEach(applyCmd)
    }
    const start = clock.now()
    let t = start
    for (;;) {
      t += 100
      clock.advanceTo(t)
      stage.renderAt(t)
      if (stage.settled && t >= start + SETTLE_MIN_MS) break
      if (t >= start + SETTLE_CAP_MS) break
    }
    stage.renderAt(clock.now())
    out.push({ image: await canvasToBlob(canvas), parseErrors, warnings })
  }
  return out
}

export interface LiveResult {
  /** Mid-reveal snapshots, every `snapEveryMs` from the first line. */
  snaps: Blob[]
  frames: number
  /** Time spent inside Stage.renderAt per frame, ms. */
  renderP50: number
  renderP95: number
  renderMax: number
}

/**
 * Play a benched story in real time (real clock, progressive reveal, cursor on): feed each beat's
 * lines at once, wait for the page to go idle, then the next beat. Times every frame's render and
 * snapshots the canvas on a fixed cadence so the reveal order can be inspected.
 */
export async function playLive(
  file: BenchFile,
  opts: RenderOptions & { snapEveryMs?: number; maxMs?: number } = {}
): Promise<LiveResult> {
  const canvas = document.createElement('canvas')
  const size = { w: 1280, h: 800 }
  canvas.width = size.w
  canvas.height = size.h
  const scene = new Scene()
  const stage = new Stage(canvas, {
    seed: hashString(file.storyId),
    size,
    style: opts.style === 'pop' ? 'pop' : 'classic',
  })
  const dialect = protoFactory(file.dialect)(scene, { moderation: true })
  const applyCmd = (cmd: Command): void => {
    for (const ev of scene.apply(cmd)) stage.handle(ev)
  }
  dialect.later = (cmds) => cmds.forEach(applyCmd)
  const times: number[] = []
  const snaps: Blob[] = []
  const snapEvery = opts.snapEveryMs ?? 500
  const maxMs = opts.maxMs ?? 30000
  const t0 = performance.now()
  let nextSnap = t0 + snapEvery
  let beat = 0
  let idleSince: number | null = null
  const feed = (i: number): void => {
    for (const raw of file.beats[i]?.lines ?? []) {
      if (!raw.trim() || dialect.isSkip(raw)) continue
      const res = dialect.parse(raw)
      if (res.ok) res.cmds.forEach(applyCmd)
    }
  }
  feed(0)
  await new Promise<void>((resolve) => {
    const tick = (): void => {
      const now = performance.now()
      stage.renderAt(now)
      times.push(performance.now() - now)
      if (now >= nextSnap) {
        nextSnap += snapEvery
        canvas.toBlob((b) => {
          if (b) snaps.push(b)
        }, 'image/jpeg', 0.8)
      }
      if (stage.settled) idleSince ??= now
      else idleSince = null
      if (idleSince !== null && now - idleSince > 800) {
        beat++
        idleSince = null
        if (beat >= file.beats.length) {
          resolve()
          return
        }
        feed(beat)
      }
      if (now - t0 > maxMs) {
        resolve()
        return
      }
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })
  await new Promise((r) => setTimeout(r, 200))
  const sorted = [...times].sort((x, y) => x - y)
  const q = (p: number): number => Number((sorted[Math.floor(sorted.length * p)] ?? 0).toFixed(2))
  return { snaps, frames: times.length, renderP50: q(0.5), renderP95: q(0.95), renderMax: q(0.999) }
}
