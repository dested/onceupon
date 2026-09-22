/**
 * Re-draw a subset of ops lines onto the visible playground canvas, deterministically and without
 * the model. This is the same execution path as draw.ts (real OpsDialect + Scene + Stage on a
 * VirtualClock, instant reveal) but fed a fixed list of lines, so toggling ops on and off shows
 * exactly which line drew what. No network, no LLM.
 *
 * Determinism: the seed must be hashString(phrase), the same seed draw.ts uses, so re-rendering the
 * full set of lines reproduces the original picture pixel for pixel. Note that stroke seeds are
 * derived from each object's running stroke count (see Stage.addShapes: `${seed}:${id}:${strokes}`),
 * so removing a shape shifts the seeds of later shapes WITHIN that same object and their crayon
 * wobble differs slightly there. Other objects are unaffected.
 */
import type { Command } from '~/engine/types'
import { Scene } from '~/engine/scene'
import { Stage } from '~/engine/stage'
import { VirtualClock } from '~/engine/clock'
import { OpsDialect } from '~/llm/ops-dsl'
import type { DrawLine } from './types'

/** Advance past this virtual time even if the picture has not settled (a bubble that never ages out). */
const SETTLE_MIN_MS = 4000
const SETTLE_CAP_MS = 15000

export function renderOps(canvas: HTMLCanvasElement, lines: string[], seed: number): DrawLine[] {
  const scene = new Scene()
  const clock = new VirtualClock()
  const stage = new Stage(canvas, { seed, clock })
  // Keep the canvas at its CSS size; only match the backing store to the element and DPR.
  stage.resize()
  stage.setInstant(true)
  stage.showCursor = false

  const applyCmd = (cmd: Command): string | null => {
    let warn: string | null = null
    for (const ev of scene.apply(cmd)) {
      if (ev.k === 'warn') warn = ev.message
      stage.handle(ev)
    }
    return warn
  }

  const dialect = new OpsDialect(scene, { moderation: true, clock })
  dialect.later = (cmds) => {
    for (const cmd of cmds) applyCmd(cmd)
  }

  const out: DrawLine[] = []
  for (const raw of lines) {
    if (raw.trim().length === 0) {
      out.push({ line: raw, ok: true, error: null })
      continue
    }
    const res = dialect.parse(raw)
    if (!res.ok) {
      out.push({ line: raw, ok: false, error: res.error })
      continue
    }
    let warn: string | null = null
    for (const cmd of res.cmds) {
      const w = applyCmd(cmd)
      if (w) warn = w
    }
    out.push({ line: raw, ok: true, error: warn })
  }

  // Settle the picture: instant reveal means the strokes land at once, but bubbles and effects age
  // out over virtual time. Step the clock until nothing is animating (or the cap).
  let t = clock.now()
  for (;;) {
    t += 100
    clock.advanceTo(t)
    stage.renderAt(t)
    if (stage.settled && t >= SETTLE_MIN_MS) break
    if (t >= SETTLE_CAP_MS) break
  }
  stage.renderAt(clock.now())

  return out
}
