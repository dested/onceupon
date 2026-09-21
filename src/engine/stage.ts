import { GROUND_Y, WORLD_H, WORLD_W, type AnimKind, type Shape, type Vec } from './types'
import { CrayonBrush, type LayerXform } from './brush'
import { FxSystem } from './fx'
import { makePaper } from './paper'
import { hashString, mulberry32, noise1 } from './rng'
import { shapeBounds, shapeToStrokes, pointAt, unionBounds, type Bounds, type Stroke } from './geometry'
import { BG_ID, type SceneEvent } from './scene'
import { darken } from './colors'
import type { CrayonAudio } from './audio'

interface Tween {
  from: number
  to: number
  t0: number
  dur: number
}

interface ObjView {
  id: string
  x: number
  y: number
  tx: Tween | null
  ty: Tween | null
  scale: number
  ts: Tween | null
  flipped: boolean
  anim: AnimKind
  animT0: number
  breathPhase: number
  moving: boolean
  layer: HTMLCanvasElement | null
  lctx: CanvasRenderingContext2D | null
  xform: LayerXform
  layerBounds: Bounds | null
  /** Unpadded union of the object's shapes in local coords. */
  contentBounds: Bounds | null
  strokes: Stroke[]
  seeds: number[]
  /** How many strokes each shape produced, in shape order. */
  shapeStrokes: number[]
  /** index of the first stroke not fully revealed */
  head: number
  /** arc length revealed within strokes[head] (or chars drawn for text) */
  progress: number
  textChars: number
  dying: { t0: number; dur: number } | null
  alpha: number
  z: number
}

interface Bubble {
  id: string
  text: string
  t0: number
  ttl: number
  seed: number
}

interface QueueItem {
  id: string
  stroke: number
}

export interface StageStats {
  pendingStrokes: number
  pendingLength: number
  revealSpeed: number
  drawing: boolean
}

/** Views sort by z; a layer is worth this many insertions. */
const LAYER_STRIDE = 100000
const OUTLINE_SPEED = 70
const FILL_SPEED = 110
const MAX_SPEED = 1600
const CATCHUP_SECONDS = 2.2
const REST: Vec = { x: 152, y: 94 }

function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2
}

function tweenValue(tw: Tween | null, fallback: number, now: number): number {
  if (!tw) return fallback
  if (tw.dur <= 0) return tw.to
  const t = Math.max(0, Math.min(1, (now - tw.t0) / (tw.dur * 1000)))
  return tw.from + (tw.to - tw.from) * easeInOut(t)
}

/** Renders a Scene onto a canvas: progressive crayon reveal, living idle motion, tweens, effects, cursor. */
export class Stage {
  private canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  private brush = new CrayonBrush()
  private fx: FxSystem
  private paper: HTMLCanvasElement | null = null
  private views = new Map<string, ObjView>()
  private queue: QueueItem[] = []
  private bubbles: Bubble[] = []
  private raf = 0
  private last = 0
  private S = 8
  private offX = 0
  private offY = 0
  private zCounter = 0
  private cursor: Vec = { ...REST }
  private cursorColor = '#e63b2e'
  private cursorAngle = 0
  private pageTurn: { img: HTMLCanvasElement; t0: number } | null = null
  private seed: number
  private instant = false
  private drawingNow = false
  private audio: CrayonAudio | null
  stats: StageStats = { pendingStrokes: 0, pendingLength: 0, revealSpeed: 0, drawing: false }
  onPageSnapshot: ((dataUrl: string, pageIndex: number) => void) | null = null
  onIdle: (() => void) | null = null
  private wasBusy = false

  constructor(canvas: HTMLCanvasElement, opts: { seed: number; audio?: CrayonAudio | null }) {
    this.canvas = canvas
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('2d context unavailable')
    this.ctx = ctx
    this.seed = opts.seed
    this.fx = new FxSystem(opts.seed)
    this.audio = opts.audio ?? null
    this.resize()
  }

  /** Reveal everything immediately (used by replay scrubbing). */
  setInstant(on: boolean): void {
    this.instant = on
  }

  get busy(): boolean {
    return this.queue.length > 0
  }

  resize(): void {
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    const w = Math.max(1, Math.floor(this.canvas.clientWidth * dpr))
    const h = Math.max(1, Math.floor(this.canvas.clientHeight * dpr))
    if (this.canvas.width === w && this.canvas.height === h && this.paper) return
    this.canvas.width = w
    this.canvas.height = h
    this.paper = makePaper(w, h)
    this.S = Math.min(w / WORLD_W, h / WORLD_H)
    this.offX = (w - WORLD_W * this.S) / 2
    this.offY = (h - WORLD_H * this.S) / 2
    for (const v of this.views.values()) this.rebuildLayer(v)
  }

  start(): void {
    if (this.raf) return
    this.last = performance.now()
    const loop = (now: number): void => {
      this.frame(now)
      this.raf = requestAnimationFrame(loop)
    }
    this.raf = requestAnimationFrame(loop)
  }

  stop(): void {
    if (this.raf) cancelAnimationFrame(this.raf)
    this.raf = 0
  }

  private worldXform(): LayerXform {
    return { s: this.S, ox: -this.offX / this.S, oy: -this.offY / this.S }
  }

  view(id: string): ObjView | undefined {
    return this.views.get(id)
  }

  private newView(id: string, x: number, y: number): ObjView {
    const v: ObjView = {
      id,
      x,
      y,
      tx: null,
      ty: null,
      scale: 1,
      ts: null,
      flipped: false,
      anim: 'none',
      animT0: performance.now(),
      breathPhase: (hashString(id) % 1000) / 1000,
      moving: false,
      layer: null,
      lctx: null,
      xform: { s: this.S, ox: 0, oy: 0 },
      layerBounds: null,
      contentBounds: null,
      strokes: [],
      seeds: [],
      shapeStrokes: [],
      head: 0,
      progress: 0,
      textChars: 0,
      dying: null,
      alpha: 1,
      z: this.zCounter++,
    }
    this.views.set(id, v)
    return v
  }

  handle(ev: SceneEvent): void {
    const now = performance.now()
    switch (ev.k) {
      case 'objectCreated': {
        const v = this.newView(ev.obj.id, ev.obj.x, ev.obj.y)
        v.z += ev.obj.layer * LAYER_STRIDE
        break
      }
      case 'layer': {
        const v = this.view(ev.id)
        if (v) v.z = ev.z * LAYER_STRIDE + this.zCounter++
        break
      }
      case 'shapesReset': {
        const v = this.view(ev.id)
        if (!v) return
        const keep = Math.min(ev.keep, v.shapeStrokes.length)
        let keepStrokes = 0
        for (let i = 0; i < keep; i++) keepStrokes += v.shapeStrokes[i] ?? 0
        this.queue = this.queue.filter((q) => q.id !== ev.id || q.stroke < keepStrokes)
        v.strokes = v.strokes.slice(0, keepStrokes)
        v.seeds = v.seeds.slice(0, keepStrokes)
        v.shapeStrokes = v.shapeStrokes.slice(0, keep)
        if (v.head >= keepStrokes) {
          v.head = keepStrokes
          v.progress = 0
          v.textChars = 0
        }
        v.layer = null
        v.lctx = null
        v.layerBounds = null
        v.contentBounds = null
        for (const s of ev.shapes.slice(0, keep)) v.contentBounds = unionBounds(v.contentBounds, shapeBounds(s))
        this.rebuildLayer(v)
        this.addShapes(v, ev.shapes.slice(keep), {})
        break
      }
      case 'shapesAdded': {
        const v = this.view(ev.id) ?? this.newView(ev.id, 0, 0)
        this.addShapes(v, ev.shapes, {})
        break
      }
      case 'move': {
        const v = this.view(ev.id)
        if (!v) return
        const cx = tweenValue(v.tx, v.x, now)
        const cy = tweenValue(v.ty, v.y, now)
        if (Math.abs(ev.x - cx) > 0.5) v.flipped = ev.x < cx
        v.tx = { from: cx, to: ev.x, t0: now, dur: ev.secs }
        v.ty = { from: cy, to: ev.y, t0: now, dur: ev.secs }
        v.x = ev.x
        v.y = ev.y
        v.moving = ev.secs > 0
        break
      }
      case 'scale': {
        const v = this.view(ev.id)
        if (!v) return
        v.ts = { from: tweenValue(v.ts, v.scale, now), to: ev.factor, t0: now, dur: ev.secs }
        v.scale = ev.factor
        break
      }
      case 'flip': {
        const v = this.view(ev.id)
        if (v) v.flipped = !v.flipped
        break
      }
      case 'remove': {
        const v = this.view(ev.id)
        if (!v) return
        const b = this.worldBounds(v, now)
        if (b) {
          const ix = (b.maxX - b.minX) * 0.08
          const iy = (b.maxY - b.minY) * 0.08
          this.fx.scribble(b.minX + ix, b.minY + iy, b.maxX - ix, b.maxY - iy, now)
        }
        v.dying = { t0: now, dur: 0.7 }
        this.queue = this.queue.filter((q) => q.id !== ev.id)
        break
      }
      case 'anim': {
        const v = this.view(ev.id)
        if (!v) return
        v.anim = ev.kind
        v.animT0 = now
        break
      }
      case 'fx':
        this.fx.spawn(ev.kind, ev.x, ev.y, ev.size, now)
        break
      case 'say':
        this.bubbles = this.bubbles.filter((b) => b.id !== ev.id)
        this.bubbles.push({ id: ev.id, text: ev.text, t0: now, ttl: 3500 + ev.text.length * 60, seed: hashString(ev.text) })
        break
      case 'bg': {
        const old = this.view(BG_ID)
        if (old) {
          this.views.delete(BG_ID)
          this.queue = this.queue.filter((q) => q.id !== BG_ID)
        }
        const v = this.newView(BG_ID, 0, 0)
        v.z = -1e9
        const shapes: Shape[] = [{ k: 'rect', x: -2, y: -2, w: WORLD_W + 4, h: GROUND_Y + 2, color: ev.sky, fill: true }]
        if (ev.ground) shapes.push({ k: 'rect', x: -2, y: GROUND_Y, w: WORLD_W + 4, h: WORLD_H - GROUND_Y + 2, color: ev.ground, fill: true })
        this.addShapes(v, shapes, { speedMul: 9, wobbleAmp: 0.6, background: true })
        break
      }
      case 'page': {
        const snap = document.createElement('canvas')
        snap.width = this.canvas.width
        snap.height = this.canvas.height
        snap.getContext('2d')?.drawImage(this.canvas, 0, 0)
        if (this.onPageSnapshot) this.onPageSnapshot(this.thumbnail(), ev.page.index - 1)
        this.pageTurn = { img: snap, t0: now }
        this.views.clear()
        this.queue = []
        this.bubbles = []
        this.audio?.pageFlip()
        break
      }
      case 'warn':
        break
    }
  }

  private addShapes(v: ObjView, shapes: Shape[], opts: { speedMul?: number; wobbleAmp?: number; background?: boolean }): void {
    for (const s of shapes) v.contentBounds = unionBounds(v.contentBounds, shapeBounds(s))
    if (v.contentBounds) this.ensureLayer(v, v.contentBounds)
    for (const s of shapes) {
      const seed = hashString(`${this.seed}:${v.id}:${v.strokes.length}`)
      const rng = mulberry32(seed)
      const strokes = shapeToStrokes(s, rng, { speedMul: opts.speedMul ?? 1, wobbleAmp: opts.wobbleAmp ?? 0.35 })
      if (opts.background) for (const st of strokes) st.alpha *= 0.75
      for (const st of strokes) {
        const idx = v.strokes.length
        v.strokes.push(st)
        v.seeds.push(seed + idx)
        this.queue.push({ id: v.id, stroke: idx })
      }
      v.shapeStrokes.push(strokes.length)
    }
  }

  private ensureLayer(v: ObjView, bounds: Bounds): void {
    const pad = 3
    const want: Bounds = { minX: bounds.minX - pad, minY: bounds.minY - pad, maxX: bounds.maxX + pad, maxY: bounds.maxY + pad }
    const cur = v.layerBounds
    if (v.layer && cur && want.minX >= cur.minX && want.minY >= cur.minY && want.maxX <= cur.maxX && want.maxY <= cur.maxY) return
    const nb = cur ? unionBounds(cur, want) : want
    const maxUnits = 4096 / this.S
    const w = Math.min(maxUnits, nb.maxX - nb.minX)
    const h = Math.min(maxUnits, nb.maxY - nb.minY)
    const layer = document.createElement('canvas')
    layer.width = Math.max(1, Math.ceil(w * this.S))
    layer.height = Math.max(1, Math.ceil(h * this.S))
    const lctx = layer.getContext('2d')
    if (!lctx) return
    if (v.layer && cur) lctx.drawImage(v.layer, (cur.minX - nb.minX) * this.S, (cur.minY - nb.minY) * this.S)
    v.layer = layer
    v.lctx = lctx
    v.layerBounds = nb
    v.xform = { s: this.S, ox: nb.minX, oy: nb.minY }
  }

  /** Re-rasterize a layer from scratch at the current scale, up to what has been revealed. */
  private rebuildLayer(v: ObjView): void {
    if (!v.contentBounds) return
    v.layer = null
    v.layerBounds = null
    this.ensureLayer(v, v.contentBounds)
    if (!v.lctx) return
    for (let i = 0; i < v.strokes.length; i++) {
      const st = v.strokes[i]
      if (!st) continue
      if (i < v.head) this.paint(v, st, i, 0, st.length, st.text ? st.text.text.length : 0, 0)
      else if (i === v.head) this.paint(v, st, i, 0, v.progress, v.textChars, 0)
    }
  }

  private paint(v: ObjView, st: Stroke, idx: number, s0: number, s1: number, charsTo: number, charsFrom: number): void {
    if (!v.lctx) return
    if (st.kind === 'text') {
      if (charsTo > charsFrom) this.brush.stampTextRange(v.lctx, st, charsFrom, charsTo, v.xform)
      return
    }
    this.brush.stampRange(v.lctx, st, s0, s1, v.xform, v.seeds[idx] ?? 0)
  }

  private pendingLength(): number {
    let total = 0
    for (const q of this.queue) {
      const v = this.views.get(q.id)
      const st = v?.strokes[q.stroke]
      if (!v || !st) continue
      const done = q.stroke === v.head ? v.progress : 0
      total += (st.length - done) / st.speedMul
    }
    return total
  }

  private advanceReveal(dt: number, now: number): Vec | null {
    if (this.queue.length === 0) return null
    const pending = this.pendingLength()
    const base = OUTLINE_SPEED
    const speed = this.instant ? Infinity : Math.min(MAX_SPEED, Math.max(base, pending / CATCHUP_SECONDS))
    this.stats.revealSpeed = speed
    let budget = this.instant ? Infinity : speed * dt
    let head: Vec | null = null
    while (budget > 0 && this.queue.length > 0) {
      const q = this.queue[0]
      if (!q) break
      const v = this.views.get(q.id)
      const st = v?.strokes[q.stroke]
      if (!v || !st || v.dying) {
        this.queue.shift()
        continue
      }
      if (v.head !== q.stroke) {
        v.head = q.stroke
        v.progress = 0
        v.textChars = 0
      }
      const kindMul = st.kind === 'fill' ? FILL_SPEED / OUTLINE_SPEED : 1
      const mul = st.speedMul * kindMul
      const remaining = st.length - v.progress
      const step = Math.min(remaining, budget * mul)
      const from = v.progress
      v.progress += step
      budget -= step / mul
      if (st.kind === 'text' && st.text) {
        const chars = Math.ceil((v.progress / Math.max(1e-6, st.length)) * st.text.text.length)
        this.paint(v, st, q.stroke, from, v.progress, chars, v.textChars)
        v.textChars = chars
      } else {
        this.paint(v, st, q.stroke, from, v.progress, 0, 0)
      }
      this.cursorColor = st.color
      const p = pointAt(st, v.progress)
      if (p) head = this.toWorld(v, p, now)
      if (v.progress >= st.length - 1e-6) {
        this.queue.shift()
        v.head = q.stroke + 1
        v.progress = 0
        v.textChars = 0
      }
    }
    return head
  }

  private objectTransform(v: ObjView, now: number): { x: number; y: number; sx: number; sy: number; rot: number } {
    const t = (now - v.animT0) / 1000
    const bt = now / 1000 + v.breathPhase * 10
    let dx = 0
    let dy = 0
    let rot = Math.sin(bt * 0.9) * 0.012
    let breath = 1 + Math.sin(bt * 1.3) * 0.012
    switch (v.anim) {
      case 'bob':
        dy = Math.sin(t * 2.6) * 1.6
        break
      case 'bounce':
        dy = -Math.abs(Math.sin(t * 4.2)) * 6
        break
      case 'shake':
        dx = noise1(t * 30, 3) * 1.4
        dy = noise1(t * 30, 4) * 0.6
        break
      case 'spin':
        rot = t * 3.2
        break
      case 'wobble':
        rot = Math.sin(t * 5) * 0.14
        break
      case 'fly':
        dy = Math.sin(t * 2) * 3
        rot = Math.sin(t * 2 + 1) * 0.06
        break
      case 'walk':
        if (v.moving) {
          dy = -Math.abs(Math.sin(t * 8)) * 1.6
          rot = Math.sin(t * 8) * 0.05
        }
        break
      case 'none':
        break
    }
    if (v.moving && v.anim !== 'walk' && v.anim !== 'fly' && v.anim !== 'spin') {
      dy += -Math.abs(Math.sin(t * 7)) * 1.2
      rot += Math.sin(t * 7) * 0.03
    }
    const x = tweenValue(v.tx, v.x, now) + dx
    const y = tweenValue(v.ty, v.y, now) + dy
    const sc = tweenValue(v.ts, v.scale, now) * breath
    if (v.tx && now - v.tx.t0 > v.tx.dur * 1000) v.moving = false
    return { x, y, sx: sc * (v.flipped ? -1 : 1), sy: sc, rot }
  }

  private toWorld(v: ObjView, local: Vec, now: number): Vec {
    const t = this.objectTransform(v, now)
    const cos = Math.cos(t.rot)
    const sin = Math.sin(t.rot)
    const lx = local.x * t.sx
    const ly = local.y * t.sy
    return { x: t.x + lx * cos - ly * sin, y: t.y + lx * sin + ly * cos }
  }

  worldBounds(v: ObjView, now: number): Bounds | null {
    if (!v.contentBounds) return null
    const b = v.contentBounds
    const corners = [
      { x: b.minX, y: b.minY },
      { x: b.maxX, y: b.minY },
      { x: b.maxX, y: b.maxY },
      { x: b.minX, y: b.maxY },
    ].map((c) => this.toWorld(v, c, now))
    let out: Bounds | null = null
    for (const c of corners) out = unionBounds(out, { minX: c.x, minY: c.y, maxX: c.x, maxY: c.y })
    return out
  }

  /** Bounds in world space using position and scale only (no rotation), for UI that must not swing. */
  private uprightBounds(v: ObjView, now: number): Bounds | null {
    if (!v.contentBounds) return null
    const t = this.objectTransform(v, now)
    const b = v.contentBounds
    if (v.anim === 'spin') {
      // A spinning thing sweeps a circle around its anchor; that circle is the only stable shape.
      const r =
        Math.max(Math.hypot(b.minX, b.minY), Math.hypot(b.maxX, b.minY), Math.hypot(b.minX, b.maxY), Math.hypot(b.maxX, b.maxY)) *
        Math.abs(t.sy)
      return { minX: t.x - r, minY: t.y - r, maxX: t.x + r, maxY: t.y + r }
    }
    const x1 = t.x + b.minX * t.sx
    const x2 = t.x + b.maxX * t.sx
    const y1 = t.y + b.minY * t.sy
    const y2 = t.y + b.maxY * t.sy
    return { minX: Math.min(x1, x2), minY: Math.min(y1, y2), maxX: Math.max(x1, x2), maxY: Math.max(y1, y2) }
  }

  private frame(now: number): void {
    const dt = Math.min(0.1, (now - this.last) / 1000)
    this.last = now
    const ctx = this.ctx
    const W = this.canvas.width
    const H = this.canvas.height

    const head = this.advanceReveal(dt, now)
    this.drawingNow = head !== null
    this.stats.pendingStrokes = this.queue.length
    this.stats.pendingLength = this.pendingLength()
    this.stats.drawing = this.drawingNow
    this.audio?.setIntensity(this.drawingNow ? Math.min(1, 0.35 + this.stats.revealSpeed / 600) : 0)
    if (this.wasBusy && !this.drawingNow && this.onIdle) this.onIdle()
    this.wasBusy = this.drawingNow

    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.globalAlpha = 1
    if (this.paper) ctx.drawImage(this.paper, 0, 0)
    else ctx.clearRect(0, 0, W, H)

    // objects, background first then by z
    const views = [...this.views.values()].sort((a, b) => a.z - b.z)
    for (const v of views) {
      if (!v.layer) continue
      if (v.dying) {
        const t = (now - v.dying.t0) / (v.dying.dur * 1000)
        if (t >= 1) {
          this.views.delete(v.id)
          continue
        }
        v.alpha = 1 - Math.max(0, (t - 0.4) / 0.6)
      }
      const t = this.objectTransform(v, now)
      ctx.save()
      ctx.globalAlpha = v.alpha
      ctx.translate(this.offX + t.x * this.S, this.offY + t.y * this.S)
      ctx.rotate(t.rot)
      ctx.scale(t.sx, t.sy)
      ctx.drawImage(v.layer, v.xform.ox * this.S, v.xform.oy * this.S)
      ctx.restore()
    }

    const wx = this.worldXform()
    this.drawBubbles(now, wx)
    this.fx.draw(ctx, this.brush, wx, now)

    // page turn: previous page slides off to the left
    if (this.pageTurn) {
      const t = (now - this.pageTurn.t0) / 650
      if (t >= 1) this.pageTurn = null
      else {
        const e = easeInOut(t)
        ctx.save()
        ctx.translate(-e * W * 1.1, 0)
        ctx.rotate(-e * 0.06)
        ctx.drawImage(this.pageTurn.img, 0, 0)
        ctx.restore()
      }
    }

    this.drawCursor(head, dt, now)
  }

  private drawBubbles(now: number, wx: LayerXform): void {
    const ctx = this.ctx
    const alive: Bubble[] = []
    for (const b of this.bubbles) {
      const age = now - b.t0
      if (age > b.ttl) continue
      alive.push(b)
      const v = this.views.get(b.id)
      if (!v) continue
      // Hold the bubble until its character is fully drawn, so it never speaks before it exists.
      if (v.head < v.strokes.length) {
        b.t0 = now
        continue
      }
      const wb = this.uprightBounds(v, now)
      if (!wb) continue
      const fade = age < 200 ? age / 200 : age > b.ttl - 300 ? (b.ttl - age) / 300 : 1
      const pop = age < 200 ? 0.6 + 0.4 * (age / 200) : 1
      const fontPx = 5.5 * this.S
      ctx.save()
      ctx.font = `${fontPx}px "Patrick Hand", cursive`
      const tw = ctx.measureText(b.text).width / this.S
      const bw = Math.min(90, tw + 8)
      const bh = 12
      const rx = bw / 2
      const ry = bh / 2
      // Where the tail points: top-center of the character, ignoring wobble so it does not swing.
      // A spinning thing has no top, so point at its pivot instead.
      const tf = this.objectTransform(v, now)
      const head: Vec = v.anim === 'spin' ? { x: tf.x, y: tf.y } : { x: (wb.minX + wb.maxX) / 2, y: wb.minY }
      // Prefer above the head; if that runs off the top, sit beside the head instead.
      let bx = head.x
      let by = wb.minY - ry - 5
      if (by < ry + 2) {
        by = Math.max(ry + 2, head.y + 2)
        const roomRight = WORLD_W - wb.maxX
        const roomLeft = wb.minX
        if (roomRight >= roomLeft) {
          bx = wb.maxX + rx + 4
          head.x = wb.maxX - 1
        } else {
          bx = wb.minX - rx - 4
          head.x = wb.minX + 1
        }
        if (v.anim === 'spin') {
          by = Math.max(ry + 2, Math.min(WORLD_H - ry - 2, tf.y))
          head.x = tf.x
          head.y = tf.y
        } else head.y = wb.minY + 4
      }
      bx = Math.max(rx + 2, Math.min(WORLD_W - rx - 2, bx))
      // Tail: base on the ellipse edge facing the head, apex at the head, never inside the bubble.
      const dx = head.x - bx
      const dy = head.y - by
      const dist = Math.hypot(dx, dy) || 1
      const ux = dx / dist
      const uy = dy / dist
      const edgeT = 1 / Math.sqrt((ux * ux) / (rx * rx) + (uy * uy) / (ry * ry))
      const reach = Math.max(edgeT + 1.5, Math.min(dist, edgeT + 9))
      const apex: Vec = { x: bx + ux * reach, y: by + uy * reach }
      const baseCx = bx + ux * (edgeT - 1)
      const baseCy = by + uy * (edgeT - 1)
      const px = -uy * 2.2
      const py = ux * 2.2
      const base1: Vec = { x: baseCx + px, y: baseCy + py }
      const base2: Vec = { x: baseCx - px, y: baseCy - py }

      const sx = (x: number): number => this.offX + x * this.S
      const sy = (y: number): number => this.offY + y * this.S
      ctx.globalAlpha = fade
      ctx.translate(sx(bx), sy(by))
      ctx.scale(pop, pop)
      ctx.translate(-sx(bx), -sy(by))
      ctx.fillStyle = 'rgba(253,252,248,0.94)'
      ctx.beginPath()
      ctx.ellipse(sx(bx), sy(by), rx * this.S, ry * this.S, 0, 0, Math.PI * 2)
      ctx.fill()
      ctx.beginPath()
      ctx.moveTo(sx(base1.x), sy(base1.y))
      ctx.lineTo(sx(apex.x), sy(apex.y))
      ctx.lineTo(sx(base2.x), sy(base2.y))
      ctx.closePath()
      ctx.fill()
      const ring: Vec[] = []
      for (let i = 0; i <= 40; i++) {
        const a = (i / 40) * Math.PI * 2
        ring.push({ x: bx + Math.cos(a) * rx, y: by + Math.sin(a) * ry })
      }
      this.brush.strokeWorld(ctx, ring, '#2b2626', 0.8, 0.85 * fade, wx, b.seed)
      this.brush.strokeWorld(ctx, [base1, apex, base2], '#2b2626', 0.8, 0.85 * fade, wx, b.seed + 1)
      ctx.fillStyle = '#2b2626'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.globalAlpha = fade
      ctx.fillText(b.text, sx(bx), sy(by))
      ctx.restore()
    }
    this.bubbles = alive
  }

  private drawCursor(head: Vec | null, dt: number, now: number): void {
    const target = head ?? { x: REST.x + Math.sin(now / 900) * 1.2, y: REST.y + Math.cos(now / 700) * 0.8 }
    const k = head ? 1 : 1 - Math.exp(-dt * 4)
    this.cursor.x += (target.x - this.cursor.x) * k
    this.cursor.y += (target.y - this.cursor.y) * k
    const wantAngle = head ? -0.75 + noise1(now / 120, 9) * 0.05 : -0.9
    this.cursorAngle += (wantAngle - this.cursorAngle) * (1 - Math.exp(-dt * 8))
    const ctx = this.ctx
    const S = this.S
    ctx.save()
    ctx.translate(this.offX + this.cursor.x * S, this.offY + this.cursor.y * S)
    ctx.rotate(this.cursorAngle)
    const w = 2.4 * S
    const len = 16 * S
    ctx.globalAlpha = 0.18
    ctx.fillStyle = '#000'
    ctx.beginPath()
    ctx.ellipse(0.6 * S, 0.8 * S, 1.6 * S, 0.7 * S, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.globalAlpha = 1
    // tip
    ctx.fillStyle = darken(this.cursorColor, 0.12)
    ctx.beginPath()
    ctx.moveTo(0, 0)
    ctx.lineTo(w / 2, -2.6 * S)
    ctx.lineTo(-w / 2, -2.6 * S)
    ctx.closePath()
    ctx.fill()
    // body
    ctx.fillStyle = this.cursorColor
    ctx.fillRect(-w / 2, -2.6 * S - len, w, len)
    // wrapper
    ctx.fillStyle = 'rgba(255,255,255,0.55)'
    ctx.fillRect(-w / 2, -2.6 * S - len * 0.82, w, len * 0.62)
    ctx.fillStyle = this.cursorColor
    ctx.fillRect(-w / 2 + 0.3 * S, -2.6 * S - len * 0.72, w - 0.6 * S, len * 0.42)
    ctx.strokeStyle = 'rgba(40,30,30,0.5)'
    ctx.lineWidth = Math.max(1, 0.18 * S)
    ctx.strokeRect(-w / 2, -2.6 * S - len, w, len)
    ctx.restore()
  }

  thumbnail(): string {
    const c = document.createElement('canvas')
    c.width = 320
    c.height = 200
    const cx = c.getContext('2d')
    if (!cx) return ''
    const sx = this.offX
    const sy = this.offY
    cx.drawImage(this.canvas, sx, sy, WORLD_W * this.S, WORLD_H * this.S, 0, 0, 320, 200)
    return c.toDataURL('image/jpeg', 0.7)
  }

  /** Reset everything (new story). */
  clear(): void {
    this.views.clear()
    this.queue = []
    this.bubbles = []
    this.pageTurn = null
    this.fx.clear()
    this.zCounter = 0
  }

  /**
   * Finish everything pending right now: reveal every queued stroke, snap tweens to their targets,
   * drop dying objects, effects, bubbles and the page-turn slide. Used after a replay scrub.
   */
  settle(): void {
    const now = performance.now()
    const was = this.instant
    this.instant = true
    while (this.queue.length > 0) this.advanceReveal(1, now)
    this.instant = was
    for (const v of [...this.views.values()]) {
      if (v.dying) {
        this.views.delete(v.id)
        continue
      }
      v.tx = null
      v.ty = null
      v.ts = null
      v.moving = false
    }
    this.pageTurn = null
    this.bubbles = []
    this.fx.clear()
  }
}
