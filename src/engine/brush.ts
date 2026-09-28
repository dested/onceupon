import type { Vec } from './types'
import { hexToRgb } from './colors'
import { noise1 } from './rng'
import { pointAt, type Stroke } from './geometry'

/** Paper color the pop knockout paints (paper.ts base). */
const KNOCK = '#fbf6ea'

/** A seeded speckle tile: punched out of pop washes so the paper tooth shows through. */
function makeTooth(): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = 128
  c.height = 128
  const ctx = c.getContext('2d')
  if (!ctx) return c
  const img = ctx.createImageData(128, 128)
  let h = 1013904223
  for (let i = 0; i < img.data.length; i += 4) {
    h ^= h << 13
    h ^= h >>> 17
    h ^= h << 5
    const v = (h >>> 0) % 1000
    img.data[i + 3] = v < 90 ? 150 : v < 190 ? 60 : 0
  }
  ctx.putImageData(img, 0, 0)
  return c
}

export interface LayerXform {
  /** pixels per world unit */
  s: number
  /** world-local coords of the layer's top-left */
  ox: number
  oy: number
}

const VARIANTS = 6

function makeDab(color: string, sizePx: number, seed: number, hard = false): HTMLCanvasElement {
  const d = Math.max(2, Math.ceil(sizePx))
  const c = document.createElement('canvas')
  c.width = d
  c.height = d
  const ctx = c.getContext('2d')
  if (!ctx) return c
  const img = ctx.createImageData(d, d)
  const { r, g, b } = hexToRgb(color)
  const half = d / 2
  let h = seed * 2654435761
  const rand = (): number => {
    h ^= h << 13
    h ^= h >>> 17
    h ^= h << 5
    return ((h >>> 0) % 10000) / 10000
  }
  for (let y = 0; y < d; y++) {
    for (let x = 0; x < d; x++) {
      const dx = (x + 0.5 - half) / half
      const dy = (y + 0.5 - half) / half
      const dist = Math.sqrt(dx * dx + dy * dy)
      // Hard dabs (pop outlines) keep a firmer wax edge and denser grain.
      const edge = hard
        ? dist >= 1 ? 0 : dist < 0.84 ? 1 : 1 - (dist - 0.84) / 0.16
        : dist >= 1 ? 0 : dist < 0.7 ? 1 : 1 - (dist - 0.7) / 0.3
      const grain = hard ? 0.6 + 0.4 * rand() : 0.45 + 0.55 * rand()
      const hole = rand() < (hard ? 0.09 : 0.14) ? 0 : 1
      const a = edge * grain * hole
      const i = (y * d + x) * 4
      img.data[i] = r
      img.data[i + 1] = g
      img.data[i + 2] = b
      img.data[i + 3] = Math.round(a * 255)
    }
  }
  ctx.putImageData(img, 0, 0)
  return c
}

/** Stamps textured wax dabs along strokes. One instance per Stage; sprites cached by color and size. */
export class CrayonBrush {
  private sprites = new Map<string, HTMLCanvasElement[]>()
  private tooth: HTMLCanvasElement | null = null

  private getSprites(color: string, sizePx: number, hard = false): HTMLCanvasElement[] {
    const q = Math.round(sizePx * 2) / 2
    const key = `${color}|${q}${hard ? '|h' : ''}`
    let arr = this.sprites.get(key)
    if (!arr) {
      arr = Array.from({ length: VARIANTS }, (_, i) => makeDab(color, q, i + 1, hard))
      this.sprites.set(key, arr)
    }
    return arr
  }

  /**
   * Stamp dabs for the part of `stroke` between arc lengths s0 and s1 (world units).
   * ctx has identity transform; xform maps local world units to layer pixels.
   */
  stampRange(ctx: CanvasRenderingContext2D, stroke: Stroke, s0: number, s1: number, xform: LayerXform, seed: number): void {
    if (stroke.kind === 'text' || s1 <= s0) return
    const widthPx = stroke.width * xform.s
    const sprites = this.getSprites(stroke.color, widthPx * 1.15, stroke.pop?.taper !== undefined && stroke.pop.taper !== null)
    const spacing = stroke.width * 0.28
    const kStart = Math.ceil(s0 / spacing)
    const kEnd = Math.floor(Math.min(s1, stroke.length) / spacing)
    if (stroke.pop) this.popRegion(ctx, stroke, s0, s1, xform)
    if (kEnd < kStart) return
    ctx.save()
    if (stroke.clip) {
      ctx.beginPath()
      for (const poly of stroke.clip) {
        poly.forEach((p, i) => {
          const px = (p.x - xform.ox) * xform.s
          const py = (p.y - xform.oy) * xform.s
          if (i === 0) ctx.moveTo(px, py)
          else ctx.lineTo(px, py)
        })
        ctx.closePath()
      }
      ctx.clip()
    }
    if (stroke.pop?.exclude) {
      ctx.beginPath()
      ctx.rect(-1e5, -1e5, 2e5, 2e5)
      this.tracePolys(ctx, stroke.pop.exclude, xform)
      ctx.clip('evenodd')
    }
    const taper = stroke.pop?.taper ?? null
    const passes = stroke.kind === 'outline' ? 2 : 1
    for (let pass = 0; pass < passes; pass++) {
      const passOff = pass === 0 ? 0 : 0.28
      for (let k = kStart; k <= kEnd; k++) {
        const s = k * spacing
        const p = pointAt(stroke, s)
        if (!p) continue
        const pressure = 0.72 + 0.28 * noise1(s * 0.4 + seed, seed + pass)
        const jx = noise1(k * 0.9 + seed * 3, seed + 11) * stroke.width * 0.12 + passOff
        const jy = noise1(k * 0.9 + seed * 5, seed + 13) * stroke.width * 0.12 + passOff * 0.6
        const sprite = sprites[(k + pass * 3) % VARIANTS]
        if (!sprite) continue
        const px = (p.x + jx - xform.ox) * xform.s
        const py = (p.y + jy - xform.oy) * xform.s
        ctx.globalAlpha = stroke.alpha * pressure * (pass === 0 ? 1 : 0.45)
        ctx.translate(px, py)
        ctx.rotate(((k * 37) % 360) * (Math.PI / 180))
        if (taper) {
          // Pop line quality: lift at both ends, press a little harder on the underside.
          const end = Math.min(s, stroke.length - s)
          const lift = Math.min(1, 0.4 + 0.6 * (end / Math.max(0.5, stroke.width * 1.8)))
          const k2 = lift * (p.y > taper.cy ? 1.08 : 0.95)
          ctx.drawImage(sprite, (-sprite.width * k2) / 2, (-sprite.height * k2) / 2, sprite.width * k2, sprite.height * k2)
        } else ctx.drawImage(sprite, -sprite.width / 2, -sprite.height / 2)
        ctx.setTransform(1, 0, 0, 1, 0, 0)
      }
    }
    ctx.restore()
  }

  private tracePolys(ctx: CanvasRenderingContext2D, polys: Vec[][], xform: LayerXform): void {
    for (const poly of polys) {
      poly.forEach((p, i) => {
        const px = (p.x - xform.ox) * xform.s
        const py = (p.y - xform.oy) * xform.s
        if (i === 0) ctx.moveTo(px, py)
        else ctx.lineTo(px, py)
      })
      ctx.closePath()
    }
  }

  /**
   * Pop region paints for the scan lines revealed between s0 and s1: the paper knockout (behind the
   * layer's pixels over the whole shape, over them inside the inset, so earlier parts are hidden but
   * this shape's own edge is not) and the gradient wash of sky/ground bands.
   */
  private popRegion(ctx: CanvasRenderingContext2D, stroke: Stroke, s0: number, s1: number, xform: LayerXform): void {
    const pop = stroke.pop
    if (!pop?.sweep || (!pop.knock && !pop.wash) || !stroke.clip) return
    const { cx, cy, nx, ny, spacing } = pop.sweep
    const offAt = (s: number): number => {
      const p = pointAt(stroke, s)
      return p ? (p.x - cx) * nx + (p.y - cy) * ny : 0
    }
    const o0 = s0 <= 0 ? -1e4 : offAt(s0) - spacing * 1.3
    const o1 = s1 >= stroke.length - 1e-6 ? 1e4 : offAt(s1) + spacing * 1.3
    if (o1 <= o0) return
    const L = 1e4
    const dx = -ny
    const dy = nx
    const band: Vec[] = [
      { x: cx + nx * o0 - dx * L, y: cy + ny * o0 - dy * L },
      { x: cx + nx * o0 + dx * L, y: cy + ny * o0 + dy * L },
      { x: cx + nx * o1 + dx * L, y: cy + ny * o1 + dy * L },
      { x: cx + nx * o1 - dx * L, y: cy + ny * o1 - dy * L },
    ]
    const W = ctx.canvas.width
    const H = ctx.canvas.height
    ctx.save()
    ctx.beginPath()
    this.tracePolys(ctx, [band], xform)
    ctx.clip()
    if (pop.knock) {
      ctx.save()
      ctx.beginPath()
      this.tracePolys(ctx, pop.knock.full, xform)
      ctx.clip()
      ctx.globalCompositeOperation = 'destination-over'
      ctx.fillStyle = KNOCK
      ctx.fillRect(0, 0, W, H)
      ctx.restore()
      ctx.save()
      ctx.beginPath()
      this.tracePolys(ctx, pop.knock.full, xform)
      ctx.clip()
      // The inset can spike out past sharp tips; the full shape bounds it.
      ctx.beginPath()
      this.tracePolys(ctx, pop.knock.inset, xform)
      ctx.clip()
      ctx.fillStyle = KNOCK
      ctx.fillRect(0, 0, W, H)
      ctx.restore()
    }
    if (pop.wash) {
      ctx.save()
      ctx.beginPath()
      this.tracePolys(ctx, stroke.clip, xform)
      ctx.clip()
      const g = ctx.createLinearGradient(0, (pop.wash.y0 - xform.oy) * xform.s, 0, (pop.wash.y1 - xform.oy) * xform.s)
      g.addColorStop(0, pop.wash.top)
      g.addColorStop(1, pop.wash.bottom)
      ctx.globalAlpha = 0.9
      ctx.fillStyle = g
      ctx.fillRect(0, 0, W, H)
      this.tooth ??= makeTooth()
      const pat = ctx.createPattern(this.tooth, 'repeat')
      if (pat) {
        ctx.globalAlpha = pop.wash.tooth
        ctx.globalCompositeOperation = 'destination-out'
        ctx.fillStyle = pat
        ctx.fillRect(0, 0, W, H)
      }
      ctx.restore()
    }
    ctx.restore()
  }

  /** Draw characters [from, to) of a text stroke in handwriting. Called incrementally as it reveals. */
  stampTextRange(ctx: CanvasRenderingContext2D, stroke: Stroke, from: number, to: number, xform: LayerXform): void {
    if (!stroke.text) return
    const { x, y, size, text } = stroke.text
    const a = Math.max(0, from)
    const b = Math.min(text.length, to)
    if (b <= a) return
    ctx.save()
    ctx.font = `${size * xform.s}px "Gloria Hallelujah", "Patrick Hand", cursive`
    ctx.textBaseline = 'alphabetic'
    ctx.textAlign = 'left'
    ctx.fillStyle = stroke.color
    const offset = a > 0 ? ctx.measureText(text.slice(0, a)).width : 0
    const px = (x - xform.ox) * xform.s + offset
    const py = (y - xform.oy) * xform.s
    const slice = text.slice(a, b)
    ctx.globalAlpha = stroke.alpha
    ctx.fillText(slice, px, py)
    ctx.globalAlpha = stroke.alpha * 0.35
    ctx.fillText(slice, px + xform.s * 0.15, py - xform.s * 0.1)
    ctx.restore()
  }

  /** Immediate crayon polyline in main-canvas world space (for effects and the cursor trail). */
  strokeWorld(
    ctx: CanvasRenderingContext2D,
    pts: Vec[],
    color: string,
    widthUnits: number,
    alpha: number,
    xform: LayerXform,
    seed: number
  ): void {
    if (pts.length < 2) return
    const cum: number[] = [0]
    let len = 0
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1]
      const b = pts[i]
      if (!a || !b) continue
      len += Math.hypot(b.x - a.x, b.y - a.y)
      cum.push(len)
    }
    const stroke: Stroke = {
      kind: 'outline',
      pts,
      cum,
      length: len,
      color,
      width: widthUnits,
      alpha,
      clip: null,
      text: null,
      speedMul: 1,
    }
    this.stampRange(ctx, stroke, 0, len, xform, seed)
  }
}
