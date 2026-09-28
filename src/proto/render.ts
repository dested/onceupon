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

export async function renderBench(file: BenchFile, _opts: RenderOptions = {}): Promise<RenderedBeat[]> {
  const canvas = document.createElement('canvas')
  const size = { w: 1280, h: 800 }
  canvas.width = size.w
  canvas.height = size.h
  const clock = new VirtualClock()
  const scene = new Scene()
  const stage = new Stage(canvas, { seed: hashString(file.storyId), clock, size })
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
