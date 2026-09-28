/**
 * The pop style: the same shapes drawn like a picture book. Opaque waxy fills (a paper knockout under
 * each filled shape, so nothing behind bleeds through), a lighter cross pass, a shading crescent away
 * from the light, a highlight tick on round things, outlines tinted toward their fill and tapered,
 * washed sky and ground bands with grass/water texture, and face extras (catchlights, cheeks, brows).
 * Everything is seeded from the shape's rng; nothing here reads the clock.
 */
import { GROUND_Y, WORLD_W, type Shape, type Vec } from './types'
import {
  closeWithOvershoot,
  cumLengths,
  ellipsePts,
  FILL_WIDTH,
  lineHits,
  OUTLINE_WIDTH,
  outlinePolys,
  parsePathData,
  polyBounds,
  shapeToStrokes,
  wobble,
  type Bounds,
  type PopPaint,
  type Stroke,
} from './geometry'
import type { Rng } from './rng'

/** The paper's base color (paper.ts); knockouts paint this. */
export const PAPER = '#fbf6ea'

// ---- color ----

interface Rgb {
  r: number
  g: number
  b: number
}

function parseHex(hex: string): Rgb | null {
  const m = /^#([0-9a-f]{6})$/i.exec(hex)
  if (!m || m[1] === undefined) return null
  const n = Number.parseInt(m[1], 16)
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }
}

function toHex(c: Rgb): string {
  const h = (v: number): string => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')
  return `#${h(c.r)}${h(c.g)}${h(c.b)}`
}

export function mixHex(a: string, b: string, t: number): string {
  const x = parseHex(a)
  const y = parseHex(b)
  if (!x || !y) return a
  return toHex({ r: x.r + (y.r - x.r) * t, g: x.g + (y.g - x.g) * t, b: x.b + (y.b - x.b) * t })
}

export function luminance(hex: string): number {
  const c = parseHex(hex)
  if (!c) return 0.5
  return (0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b) / 255
}

function toHsl(c: Rgb): { h: number; s: number; l: number } {
  const r = c.r / 255
  const g = c.g / 255
  const b = c.b / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) return { h: 0, s: 0, l }
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h = 0
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0)
  else if (max === g) h = (b - r) / d + 2
  else h = (r - g) / d + 4
  return { h: h / 6, s, l }
}

function fromHsl(h: number, s: number, l: number): Rgb {
  if (s === 0) return { r: l * 255, g: l * 255, b: l * 255 }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  const f = (t0: number): number => {
    let t = t0
    if (t < 0) t += 1
    if (t > 1) t -= 1
    if (t < 1 / 6) return p + (q - p) * 6 * t
    if (t < 1 / 2) return q
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
    return p
  }
  return { r: f(h + 1 / 3) * 255, g: f(h) * 255, b: f(h - 1 / 3) * 255 }
}

/** A deeper, richer version of a color: the line a picture-book artist would ink it with. */
export function deepen(hex: string, depth = 1): string {
  const c = parseHex(hex)
  if (!c) return hex
  const { h, s, l } = toHsl(c)
  const nl = Math.max(0.12, Math.min(l * (1 - 0.5 * depth), 0.36))
  const ns = s < 0.08 ? s : Math.min(1, s * 1.15 + 0.08)
  return toHex(fromHsl(h, ns, nl))
}

/** A darker shade for the shadow side, same hue. */
export function shade(hex: string): string {
  const c = parseHex(hex)
  if (!c) return hex
  const { h, s, l } = toHsl(c)
  // Warm-dark shadows read as crayon, gray ones as dirt: keep saturation, nudge hue toward purple for blues.
  return toHex(fromHsl(h, Math.min(1, s * 1.05 + 0.05), Math.max(0.1, l * 0.72)))
}

export function hue(hex: string): { h: number; s: number; l: number } {
  const c = parseHex(hex)
  return c ? toHsl(c) : { h: 0, s: 0, l: 0.5 }
}

/** Brown or near-black: the default ink the models reach for. */
function isGenericInk(hex: string): boolean {
  const c = parseHex(hex)
  if (!c) return false
  const { h, s, l } = toHsl(c)
  if (l < 0.2) return true
  // neutral grays (the "white things get a gray outline" rule)
  if (s < 0.08 && l < 0.65) return true
  // browns: orange hue, moderate saturation, darkish
  return h > 0.03 && h < 0.13 && l < 0.45 && s < 0.6
}

// ---- geometry helpers ----

function signedArea(poly: Vec[]): number {
  let a = 0
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]
    const q = poly[(i + 1) % poly.length]
    if (p && q) a += p.x * q.y - q.x * p.y
  }
  return a / 2
}

/** Move every vertex inward by d along the bisector (miter-limited). Good enough for crayon shapes. */
function insetPoly(poly: Vec[], d: number): Vec[] {
  if (poly.length < 3) return poly
  const a = offsetPoly(poly, d, 1)
  const b = offsetPoly(poly, d, -1)
  // One sign moves the edges in, the other out: the inset is the smaller one.
  return Math.abs(signedArea(a)) <= Math.abs(signedArea(b)) ? a : b
}

function offsetPoly(poly: Vec[], d: number, inwardSign: number): Vec[] {
  const n = poly.length
  const out: Vec[] = []
  for (let i = 0; i < n; i++) {
    const a = poly[(i - 1 + n) % n]
    const p = poly[i]
    const b = poly[(i + 1) % n]
    if (!a || !p || !b) continue
    const e1x = p.x - a.x
    const e1y = p.y - a.y
    const e2x = b.x - p.x
    const e2y = b.y - p.y
    const l1 = Math.hypot(e1x, e1y) || 1
    const l2 = Math.hypot(e2x, e2y) || 1
    // Left normals (y down): for a positive-area (clockwise on screen) polygon they point inward.
    const n1x = (-e1y / l1) * inwardSign
    const n1y = (e1x / l1) * inwardSign
    const n2x = (-e2y / l2) * inwardSign
    const n2y = (e2x / l2) * inwardSign
    let bx = n1x + n2x
    let by = n1y + n2y
    const bl = Math.hypot(bx, by)
    if (bl < 1e-6) {
      bx = n1x
      by = n1y
    } else {
      bx /= bl
      by /= bl
    }
    const cos = Math.max(0.5, bx * n1x + by * n1y)
    out.push({ x: p.x + (bx * d) / cos, y: p.y + (by * d) / cos })
  }
  return out
}

function boundsOf(polys: Vec[][]): Bounds {
  return polyBounds(polys)
}

function makeStroke(
  kind: Stroke['kind'],
  pts: Vec[],
  color: string,
  width: number,
  alpha: number,
  clip: Vec[][] | null,
  speedMul: number,
  pop: PopPaint | undefined
): Stroke {
  const { cum, length } = cumLengths(pts)
  const s: Stroke = { kind, pts, cum, length, color, width, alpha, clip, text: null, speedMul }
  if (pop) s.pop = pop
  return s
}

const NO_POP: PopPaint = { sweep: null, knock: null, wash: null, exclude: null, taper: null }

/** Inside-intervals of the line p + t*d against polygons (even-odd pairs). */
function intervals(polys: Vec[][], px: number, py: number, dx: number, dy: number): Array<[number, number]> {
  const hits = lineHits(polys, px, py, dx, dy)
  const out: Array<[number, number]> = []
  for (let k = 0; k + 1 < hits.length; k += 2) {
    const a = hits[k]
    const b = hits[k + 1]
    if (a !== undefined && b !== undefined) out.push([a, b])
  }
  return out
}

function subtract(a: Array<[number, number]>, b: Array<[number, number]>): Array<[number, number]> {
  let cur = a
  for (const [b0, b1] of b) {
    const next: Array<[number, number]> = []
    for (const [a0, a1] of cur) {
      if (b1 <= a0 || b0 >= a1) next.push([a0, a1])
      else {
        if (b0 > a0) next.push([a0, b0])
        if (b1 < a1) next.push([b1, a1])
      }
    }
    cur = next
  }
  return cur
}

/**
 * Zig-zag hachure over `polys` minus `exclude`, scan lines at `angle`, returning the points and the
 * sweep axis (so region paints can follow the reveal).
 */
function hachureSweep(
  polys: Vec[][],
  exclude: Vec[][] | null,
  angle: number,
  spacing: number,
  rng: Rng
): { pts: Vec[]; sweep: NonNullable<PopPaint['sweep']> } | null {
  const b = boundsOf(polys)
  if (!Number.isFinite(b.minX)) return null
  const dx = Math.cos(angle)
  const dy = Math.sin(angle)
  const nx = -dy
  const ny = dx
  const cx = (b.minX + b.maxX) / 2
  const cy = (b.minY + b.maxY) / 2
  const diag = Math.hypot(b.maxX - b.minX, b.maxY - b.minY)
  const lines = Math.ceil(diag / spacing)
  const pts: Vec[] = []
  let flip = false
  for (let i = -lines / 2; i <= lines / 2; i++) {
    const off = i * spacing + (rng() - 0.5) * spacing * 0.35
    const px = cx + nx * off
    const py = cy + ny * off
    let segs = intervals(polys, px, py, dx, dy)
    if (exclude) segs = subtract(segs, intervals(exclude, px, py, dx, dy))
    segs = segs.filter(([t0, t1]) => t1 - t0 > 0.3)
    if (segs.length === 0) continue
    const ordered = flip ? [...segs].reverse() : segs
    for (const [t0, t1] of ordered) {
      const a = flip ? t1 : t0
      const c = flip ? t0 : t1
      const over = 0.6
      pts.push({ x: px + dx * (a - Math.sign(c - a) * over), y: py + dy * (a - Math.sign(c - a) * over) })
      pts.push({ x: px + dx * (c + Math.sign(c - a) * over), y: py + dy * (c + Math.sign(c - a) * over) })
    }
    flip = !flip
  }
  if (pts.length < 2) return null
  return { pts, sweep: { cx, cy, nx, ny, spacing } }
}

function geomKey(s: Shape): string {
  switch (s.k) {
    case 'circle':
      return `c${s.cx},${s.cy},${s.r}`
    case 'ellipse':
      return `e${s.cx},${s.cy},${s.rx},${s.ry}`
    case 'rect':
      return `r${s.x},${s.y},${s.w},${s.h}`
    case 'line':
      return `l${s.x1},${s.y1},${s.x2},${s.y2}`
    case 'poly':
      return `p${s.pts.map((p) => `${p.x},${p.y}`).join(' ')}`
    case 'path':
      return `d${s.d}`
    case 'text':
      return `t${s.x},${s.y},${s.text}`
  }
}

/** The unfilled shape right after a filled one with the same geometry is its ink outline. */
export function isOutlineOf(outline: Shape | undefined, filled: Shape | undefined): boolean {
  if (!outline || !filled) return false
  if (!('fill' in outline) || outline.fill) return false
  if (!('fill' in filled) || !filled.fill) return false
  return geomKey(outline) === geomKey(filled)
}

// ---- the pop strokes of one shape ----

export interface PopContext {
  /** Object anchor in world units (bands are recognized by where they sit on the page). */
  ax: number
  ay: number
  /** The sky/ground background object. */
  background: boolean
  /** The shape after this one in the same batch (an ink outline of this fill?). */
  next: Shape | undefined
  /** When this shape is the ink outline of a fill: that fill's color. */
  pairedFill: string | null
  speedMul: number
  wobbleAmp: number
}

type BandKind = 'grass' | 'water' | 'sand' | 'plain'

function bandKind(color: string): BandKind {
  const { h, s, l } = hue(color)
  if (s < 0.15) return 'plain'
  const deg = h * 360
  if (deg >= 65 && deg < 170) return 'grass'
  if (deg >= 170 && deg < 260) return 'water'
  if (deg >= 25 && deg < 65 && l > 0.45) return 'sand'
  return 'plain'
}

/** A page-wide filled rect: a ground, water or floor band (or the sky). */
function isBand(shape: Shape): boolean {
  return shape.k === 'rect' && shape.w >= WORLD_W * 0.8
}

export function popShapeToStrokes(shape: Shape, rng: Rng, ctx: PopContext): Stroke[] {
  if (shape.k === 'text' || shape.k === 'line') return shapeToStrokes(shape, rng, ctx)
  const amp = ctx.wobbleAmp
  const out: Stroke[] = []
  const polys = outlinePolys(shape)
  const b = boundsOf(polys)
  const w = b.maxX - b.minX
  const h = b.maxY - b.minY
  const minDim = Math.min(w, h)
  const band = isBand(shape) || ctx.background
  const role = shape.role

  // ---- an unfilled shape: an ink line ----
  if (!shape.fill) {
    let color = shape.color
    if (ctx.pairedFill && !role && isGenericInk(color)) {
      const lum = luminance(ctx.pairedFill)
      color = lum > 0.85 ? mixHex('#8d8279', color, 0.25) : mixHex(deepen(ctx.pairedFill), color, 0.3)
    }
    if (band && shape.k === 'rect') {
      // A band's outline: only a soft horizon along its top edge; the page edges need no line.
      const top: Vec[] = [
        { x: shape.x, y: shape.y },
        { x: shape.x + shape.w, y: shape.y },
      ]
      out.push(makeStroke('outline', wobble(top, rng, amp * 1.4), color, OUTLINE_WIDTH * 1.1, 0.55, null, ctx.speedMul * 3, NO_POP))
      return out
    }
    const width = role === 'eye' ? OUTLINE_WIDTH * 0.7 : role === 'mouth' ? OUTLINE_WIDTH * 0.85 : OUTLINE_WIDTH
    const taper = { cy: (b.minY + b.maxY) / 2 }
    const line = (pts: Vec[]): void => {
      out.push(makeStroke('outline', wobble(pts, rng, amp), color, width, 0.95, null, ctx.speedMul, { ...NO_POP, taper }))
    }
    if (shape.k === 'circle') line(ellipsePts(shape.cx, shape.cy, shape.r, shape.r, rng))
    else if (shape.k === 'ellipse') line(ellipsePts(shape.cx, shape.cy, shape.rx, shape.ry, rng))
    else if (shape.k === 'rect') {
      const poly = polys[0] ?? []
      const start = Math.floor(rng() * 4)
      line(closeWithOvershoot([...poly.slice(start), ...poly.slice(0, start)]))
    } else if (shape.k === 'poly') line(shape.closed ? closeWithOvershoot(shape.pts) : shape.pts)
    else for (const p of parsePathData(shape.d)) line(p)
    return out
  }

  // ---- a filled shape ----
  const closed = shape.k === 'path' ? parsePathData(shape.d).filter((p) => p.length >= 3) : shape.k === 'poly' && !shape.closed ? [] : polys
  if (closed.length === 0) return shapeToStrokes(shape, rng, ctx)
  const color = shape.color
  const baseAngle = -Math.PI / 4 + (rng() - 0.5) * 0.5

  if (band) {
    // Sky and ground bands: a soft vertical wash (sky deeper at the top, ground lighter at the
    // horizon), then a light crayon texture pass over it.
    const bb = boundsOf(closed)
    const sky = ctx.background && bb.minY < 1
    const dark = luminance(color) < 0.3
    const top = sky ? mixHex(color, deepen(color), dark ? 0.15 : 0.28) : mixHex(color, '#ffffff', 0.14)
    const bottom = sky ? mixHex(color, '#ffffff', dark ? 0.18 : 0.5) : mixHex(color, shade(color), 0.4)
    // Near-horizontal strokes, a shade darker than the wash: laid-down crayon, never rain.
    const hz = hachureSweep(closed, null, -0.08 + (rng() - 0.5) * 0.08, 2.9, rng)
    if (hz) {
      out.push(
        makeStroke('fill', wobble(hz.pts, rng, amp * 0.9, 2), shade(color), FILL_WIDTH * 1.2, dark ? 0.1 : 0.13, closed, ctx.speedMul * (sky ? 1 : 2.2), {
          ...NO_POP,
          sweep: hz.sweep,
          wash: { top, bottom, y0: bb.minY, y1: bb.maxY, tooth: dark ? 0.18 : 0.42 },
        })
      )
    }
    if (!sky) out.push(...bandTexture(shape, color, rng, ctx))
    return out
  }

  const small = minDim < 4
  const face = role !== undefined

  // 1. main waxy fill, with the paper knockout riding the same sweep
  const main = hachureSweep(closed, null, baseAngle, small ? 1.3 : 1.15, rng)
  if (main) {
    const inset = Math.min(1.0, minDim * 0.2)
    out.push(
      makeStroke('fill', wobble(main.pts, rng, amp * 0.55, 2), color, FILL_WIDTH * 1.12, 0.8, closed, ctx.speedMul, {
        ...NO_POP,
        sweep: main.sweep,
        knock: { full: closed, inset: closed.map((p) => insetPoly(p, inset)) },
      })
    )
  }
  if (!small && !face) {
    // 2. a lighter cross pass at another angle: wax over wax
    const cross = hachureSweep(closed, null, baseAngle + 1.15 + (rng() - 0.5) * 0.3, 2.3, rng)
    if (cross)
      out.push(makeStroke('fill', wobble(cross.pts, rng, amp * 0.6, 2), mixHex(color, '#ffffff', 0.14), FILL_WIDTH, 0.32, closed, ctx.speedMul * 2.2, NO_POP))
    // 3. the shading crescent: the shape minus itself nudged toward the upper-left light
    const k = Math.max(1.2, minDim * 0.17)
    const lit = closed.map((p) => p.map((q) => ({ x: q.x - k, y: q.y - k * 1.1 })))
    const shadow = hachureSweep(closed, lit, baseAngle + 0.25, 1.35, rng)
    if (shadow)
      out.push(
        makeStroke('fill', wobble(shadow.pts, rng, amp * 0.5, 2), shade(color), FILL_WIDTH * 0.95, luminance(color) < 0.18 ? 0.25 : 0.5, closed, ctx.speedMul * 1.4, {
          ...NO_POP,
          exclude: lit,
        })
      )
    // 4. a highlight tick on round things
    if ((shape.k === 'circle' || shape.k === 'ellipse') && minDim >= 6 && luminance(color) < 0.9) {
      const rx = shape.k === 'circle' ? shape.r : shape.rx
      const ry = shape.k === 'circle' ? shape.r : shape.ry
      const pts: Vec[] = []
      const a0 = Math.PI * 1.08 + rng() * 0.1
      const a1 = Math.PI * 1.36 + rng() * 0.08
      for (let i = 0; i <= 10; i++) {
        const a = a0 + ((a1 - a0) * i) / 10
        pts.push({ x: shape.cx + Math.cos(a) * rx * 0.66, y: shape.cy + Math.sin(a) * ry * 0.66 })
      }
      out.push(makeStroke('outline', wobble(pts, rng, amp * 0.5), mixHex(color, '#ffffff', 0.5), OUTLINE_WIDTH * 0.8, 0.5, closed, ctx.speedMul, { ...NO_POP, taper: { cy: 1e9 } }))
    }
  }
  // 5. the edge: in the fill's own deeper ink, unless an explicit outline follows
  if (!isOutlineOf(ctx.next, shape)) {
    const edgeColor = role === 'eyeWhite' ? '#5b4a40' : deepen(color, 0.8)
    const edgeCtx: PopContext = { ...ctx, pairedFill: null, next: undefined }
    const edgeShape: Shape = { ...shape, color: edgeColor, fill: false }
    out.push(...popShapeToStrokes(edgeShape, rng, edgeCtx))
  }
  return out
}

/** Grass tufts, water ripples or sand specks scattered along a ground band. */
function bandTexture(shape: Shape, color: string, rng: Rng, ctx: PopContext): Stroke[] {
  if (shape.k !== 'rect') return []
  const kind = bandKind(color)
  const out: Stroke[] = []
  const x0 = Math.max(shape.x, -ctx.ax - 2)
  const x1 = Math.min(shape.x + shape.w, WORLD_W - ctx.ax + 2)
  const y0 = shape.y
  const depth = Math.min(shape.h, GROUND_Y + 22 - (ctx.ay + y0))
  if (depth <= 2) return []
  const n = Math.round((x1 - x0) / (kind === 'grass' ? 9 : 12))
  for (let i = 0; i < n; i++) {
    const x = x0 + ((i + 0.2 + rng() * 0.6) / n) * (x1 - x0)
    // Denser near the horizon, sparse below it.
    const y = y0 + 1.2 + rng() * rng() * Math.min(depth - 2, 16)
    if (kind === 'grass') {
      // A tuft: 2-4 curved blades of different heights, leaning, drawn in one flick up and down.
      const tuft: Vec[] = []
      const blades = 2 + Math.floor(rng() * 3)
      const lean = (rng() - 0.5) * 0.8
      for (let k = 0; k < blades; k++) {
        const side = k - (blades - 1) / 2
        const bx = x + side * (0.5 + rng() * 0.4)
        const hgt = (1.6 + rng() * 2.4) * (1 - Math.abs(side) * 0.18)
        // Blades fan out from the root like a quick crayon flick.
        const tip = bx + lean + side * (0.9 + rng() * 0.6)
        tuft.push({ x: bx, y }, { x: (bx + tip) / 2 + lean * 0.2, y: y - hgt * 0.55 }, { x: tip, y: y - hgt })
        tuft.push({ x: (bx + tip) / 2 + 0.15, y: y - hgt * 0.45 }, { x: bx + 0.25, y })
      }
      const tone = rng() < 0.3 ? mixHex(color, deepen(color, 0.3), 0.5) : deepen(color, 0.45)
      out.push(makeStroke('outline', wobble(tuft, rng, 0.06, 0.4), tone, OUTLINE_WIDTH * 0.42, 0.8, null, ctx.speedMul * 4, { ...NO_POP, taper: { cy: 1e9 } }))
    } else if (kind === 'water') {
      const wv: Vec[] = []
      const len = 5 + rng() * 4
      for (let k = 0; k <= 8; k++) wv.push({ x: x + (k / 8) * len, y: y + Math.sin((k / 8) * Math.PI * 2) * 0.7 })
      out.push(makeStroke('outline', wobble(wv, rng, 0.12, 0.6), mixHex(color, '#ffffff', 0.55), OUTLINE_WIDTH * 0.8, 0.65, null, ctx.speedMul * 4, NO_POP))
    } else if (kind === 'sand') {
      const dot: Vec[] = [
        { x, y },
        { x: x + 0.5, y: y + 0.2 },
      ]
      out.push(makeStroke('outline', dot, shade(color), OUTLINE_WIDTH * 0.7, 0.5, null, ctx.speedMul * 4, NO_POP))
    }
  }
  return out
}

// ---- faces ----

interface Eye {
  cx: number
  cy: number
  r: number
}

function eyesOf(shapes: Shape[]): Eye[] {
  const eyes: Eye[] = []
  for (const s of shapes) if (s.role === 'eyeWhite' && s.k === 'circle') eyes.push({ cx: s.cx, cy: s.cy, r: s.r })
  return eyes.slice(-2)
}

type Mood = 'happy' | 'sad' | 'surprised'

function moodOf(mouth: Shape): Mood {
  if (mouth.k === 'circle') return 'surprised'
  if (mouth.k === 'path') {
    const n = (mouth.d.match(/-?\d*\.?\d+/g) ?? []).map(Number)
    const y0 = n[1]
    const qy = n[3]
    if (y0 !== undefined && qy !== undefined && qy < y0) return 'sad'
  }
  return 'happy'
}

export interface FaceInfo {
  /** Eye whites in object-local units, with the lid color (the fill they sit on) and the eye ink. */
  eyes: Array<Eye & { lid: string; ink: string }>
}

/** The eyes of an object's face, for blinking: the lid is the fill of the shape the eye sits on. */
export function faceInfo(shapes: Shape[]): FaceInfo | null {
  const eyes = eyesOf(shapes)
  if (eyes.length === 0) return null
  const firstEye = shapes.findIndex((s) => s.role === 'eyeWhite')
  const ink = shapes.find((s) => s.role === 'eye')?.color ?? '#2b2626'
  return {
    eyes: eyes.map((e) => {
      let lid = PAPER
      for (let i = firstEye - 1; i >= 0; i--) {
        const s = shapes[i]
        if (!s || s.role || !('fill' in s) || !s.fill) continue
        const bb = boundsOf(outlinePolys(s))
        if (e.cx > bb.minX && e.cx < bb.maxX && e.cy > bb.minY && e.cy < bb.maxY) {
          lid = s.color
          break
        }
      }
      return { ...e, lid, ink }
    }),
  }
}

/** Strokes a face role gets on top of itself in pop: catchlights after a pupil; cheeks and brows after the mouth. */
export function faceExtras(shape: Shape, before: Shape[], rng: Rng, speedMul: number): Stroke[] {
  const out: Stroke[] = []
  if (shape.role === 'pupil' && shape.k === 'circle') {
    const r = Math.max(0.18, shape.r * 0.3)
    const cx = shape.cx - shape.r * 0.32
    const cy = shape.cy - shape.r * 0.36
    const ring: Vec[] = []
    for (let i = 0; i <= 10; i++) {
      const a = (i / 10) * Math.PI * 2
      ring.push({ x: cx + Math.cos(a) * r * 0.35, y: cy + Math.sin(a) * r * 0.35 })
    }
    out.push(makeStroke('outline', ring, '#ffffff', r * 1.5, 0.98, null, speedMul, NO_POP))
    return out
  }
  if (shape.role !== 'mouth') return out
  const eyes = eyesOf(before)
  if (eyes.length < 2) return out
  const [e0, e1] = eyes
  if (!e0 || !e1) return out
  const mid = (e0.cx + e1.cx) / 2
  const ink = before.find((s) => s.role === 'eye')?.color ?? '#2b2626'
  for (const e of [e0, e1]) {
    // rosy cheek: a soft blush oval below and outside the eye
    const cx = e.cx + (e.cx - mid) * 0.35
    const cy = e.cy + e.r * 1.9
    const cheek: Vec[] = []
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2
      cheek.push({ x: cx + Math.cos(a) * e.r * 0.95, y: cy + Math.sin(a) * e.r * 0.58 })
    }
    const hz = hachureSweep([cheek], null, -0.6 + rng() * 0.2, 0.7, rng)
    if (hz) out.push(makeStroke('fill', wobble(hz.pts, rng, 0.1, 1), '#f07f9a', FILL_WIDTH * 0.75, 0.38, [cheek], speedMul * 1.5, NO_POP))
  }
  const mood = moodOf(shape)
  if (mood !== 'happy') {
    for (const e of [e0, e1]) {
      const inner = e.cx < mid ? 1 : -1
      const by = e.cy - e.r * (mood === 'surprised' ? 2.1 : 1.7)
      const pts: Vec[] =
        mood === 'surprised'
          ? [
              { x: e.cx - e.r * 0.9, y: by + e.r * 0.25 },
              { x: e.cx, y: by - e.r * 0.2 },
              { x: e.cx + e.r * 0.9, y: by + e.r * 0.25 },
            ]
          : [
              { x: e.cx - inner * e.r * 0.9, y: by + e.r * 0.3 },
              { x: e.cx + inner * e.r * 0.8, y: by - e.r * 0.35 },
            ]
      out.push(makeStroke('outline', wobble(pts, rng, 0.08, 0.5), ink, OUTLINE_WIDTH * 0.85, 0.9, null, speedMul, { ...NO_POP, taper: { cy: 1e9 } }))
    }
  }
  return out
}
