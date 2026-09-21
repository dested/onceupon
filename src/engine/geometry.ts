import type { Shape, Vec } from './types'
import { noise1, type Rng } from './rng'

/** A stroke is one continuous crayon motion. `cum[i]` is arc length up to pts[i]. */
export interface Stroke {
  kind: 'outline' | 'fill' | 'text'
  pts: Vec[]
  cum: number[]
  length: number
  color: string
  width: number
  alpha: number
  /** Fill strokes are clipped to these closed polygons so the zig-zag stays inside the shape. */
  clip: Vec[][] | null
  /** Only for kind = text. */
  text: { x: number; y: number; size: number; text: string } | null
  /** Reveal-speed multiplier; backgrounds use a high value. */
  speedMul: number
}

export interface Bounds {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

export const OUTLINE_WIDTH = 1.5
export const FILL_WIDTH = 2.1
export const FILL_SPACING = 1.5

function cumLengths(pts: Vec[]): { cum: number[]; length: number } {
  const cum: number[] = [0]
  let total = 0
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]
    const b = pts[i]
    if (!a || !b) continue
    total += Math.hypot(b.x - a.x, b.y - a.y)
    cum.push(total)
  }
  return { cum, length: total }
}

function makeStroke(
  kind: Stroke['kind'],
  pts: Vec[],
  color: string,
  width: number,
  alpha: number,
  clip: Vec[][] | null,
  speedMul = 1
): Stroke {
  const { cum, length } = cumLengths(pts)
  return { kind, pts, cum, length, color, width, alpha, clip, text: null, speedMul }
}

/** Resample a polyline so no segment is longer than `step`, then add hand wobble. */
function wobble(pts: Vec[], rng: Rng, amp: number, step = 1.2): Vec[] {
  if (pts.length < 2) return pts
  const seed = Math.floor(rng() * 10000)
  const phase = rng() * 100
  const out: Vec[] = []
  let dist = 0
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i]
    const b = pts[i + 1]
    if (!a || !b) continue
    const segLen = Math.hypot(b.x - a.x, b.y - a.y)
    const n = Math.max(1, Math.ceil(segLen / step))
    for (let j = 0; j < n; j++) {
      const t = j / n
      const x = a.x + (b.x - a.x) * t
      const y = a.y + (b.y - a.y) * t
      const d = dist + segLen * t
      out.push({
        x: x + noise1(d * 0.45 + phase, seed) * amp,
        y: y + noise1(d * 0.45 + phase + 37, seed + 1) * amp,
      })
    }
    dist += segLen
  }
  const last = pts[pts.length - 1]
  if (last) {
    out.push({
      x: last.x + noise1(dist * 0.45 + phase, seed) * amp,
      y: last.y + noise1(dist * 0.45 + phase + 37, seed + 1) * amp,
    })
  }
  return out
}

function ellipsePts(cx: number, cy: number, rx: number, ry: number, rng: Rng): Vec[] {
  const per = Math.PI * (3 * (rx + ry) - Math.sqrt((3 * rx + ry) * (rx + 3 * ry)))
  const n = Math.max(16, Math.min(96, Math.ceil(per / 1.0)))
  const start = rng() * Math.PI * 2
  const dir = rng() < 0.5 ? 1 : -1
  const pts: Vec[] = []
  // overshoot past the start a little, like a real hand closing a circle
  const overshoot = 0.08
  for (let i = 0; i <= n * (1 + overshoot); i++) {
    const a = start + dir * (i / n) * Math.PI * 2
    pts.push({ x: cx + Math.cos(a) * rx, y: cy + Math.sin(a) * ry })
  }
  return pts
}

function closeWithOvershoot(pts: Vec[]): Vec[] {
  if (pts.length < 2) return pts
  const first = pts[0]
  const second = pts[1]
  if (!first || !second) return pts
  return [...pts, first, { x: first.x + (second.x - first.x) * 0.35, y: first.y + (second.y - first.y) * 0.35 }]
}

// ---- SVG path (subset: M L H V C S Q T A Z, absolute and relative) ----

function parsePathData(d: string): Vec[][] {
  const tokens = d.match(/[a-zA-Z]|-?\d*\.?\d+(?:e-?\d+)?/g) ?? []
  const polys: Vec[][] = []
  let cur: Vec[] = []
  let cmd = 'M'
  let x = 0
  let y = 0
  let startX = 0
  let startY = 0
  // Held in an object so narrowing does not freeze it to null across the closures below.
  const ctrl: { last: Vec | null } = { last: null }
  let i = 0
  const next = (): number => {
    const t = tokens[i++]
    return t === undefined ? 0 : Number(t)
  }
  const isNum = (): boolean => {
    const t = tokens[i]
    return t !== undefined && !/^[a-zA-Z]$/.test(t)
  }
  const flush = (): void => {
    if (cur.length > 1) polys.push(cur)
    cur = []
  }
  const lineTo = (nx: number, ny: number): void => {
    cur.push({ x: nx, y: ny })
    x = nx
    y = ny
  }
  const cubic = (c1: Vec, c2: Vec, p: Vec): void => {
    const p0 = { x, y }
    const n = 12
    for (let k = 1; k <= n; k++) {
      const t = k / n
      const mt = 1 - t
      cur.push({
        x: mt * mt * mt * p0.x + 3 * mt * mt * t * c1.x + 3 * mt * t * t * c2.x + t * t * t * p.x,
        y: mt * mt * mt * p0.y + 3 * mt * mt * t * c1.y + 3 * mt * t * t * c2.y + t * t * t * p.y,
      })
    }
    x = p.x
    y = p.y
    ctrl.last = c2
  }
  const quad = (c: Vec, p: Vec): void => {
    const p0 = { x, y }
    const n = 10
    for (let k = 1; k <= n; k++) {
      const t = k / n
      const mt = 1 - t
      cur.push({
        x: mt * mt * p0.x + 2 * mt * t * c.x + t * t * p.x,
        y: mt * mt * p0.y + 2 * mt * t * c.y + t * t * p.y,
      })
    }
    x = p.x
    y = p.y
    ctrl.last = c
  }
  const arc = (rx: number, ry: number, _rot: number, large: number, sweep: number, px: number, py: number): void => {
    // Approximate an SVG arc: solve for center per the spec, then sample.
    const x1 = x
    const y1 = y
    if (rx === 0 || ry === 0) {
      lineTo(px, py)
      return
    }
    const dx = (x1 - px) / 2
    const dy = (y1 - py) / 2
    let arx = Math.abs(rx)
    let ary = Math.abs(ry)
    const lambda = (dx * dx) / (arx * arx) + (dy * dy) / (ary * ary)
    if (lambda > 1) {
      arx *= Math.sqrt(lambda)
      ary *= Math.sqrt(lambda)
    }
    const sign = large !== sweep ? 1 : -1
    const num = arx * arx * ary * ary - arx * arx * dy * dy - ary * ary * dx * dx
    const den = arx * arx * dy * dy + ary * ary * dx * dx
    const coef = sign * Math.sqrt(Math.max(0, num / den))
    const cxp = (coef * (arx * dy)) / ary
    const cyp = (coef * -(ary * dx)) / arx
    const cx = cxp + (x1 + px) / 2
    const cy = cyp + (y1 + py) / 2
    const ang = (ux: number, uy: number, vx: number, vy: number): number => {
      const dot = ux * vx + uy * vy
      const len = Math.hypot(ux, uy) * Math.hypot(vx, vy)
      let a = Math.acos(Math.max(-1, Math.min(1, dot / len)))
      if (ux * vy - uy * vx < 0) a = -a
      return a
    }
    const theta1 = ang(1, 0, (dx - cxp) / arx, (dy - cyp) / ary)
    let dtheta = ang((dx - cxp) / arx, (dy - cyp) / ary, (-dx - cxp) / arx, (-dy - cyp) / ary)
    if (sweep === 0 && dtheta > 0) dtheta -= Math.PI * 2
    if (sweep === 1 && dtheta < 0) dtheta += Math.PI * 2
    const n = Math.max(6, Math.ceil(Math.abs(dtheta) * 8))
    for (let k = 1; k <= n; k++) {
      const t = theta1 + (dtheta * k) / n
      cur.push({ x: cx + arx * Math.cos(t), y: cy + ary * Math.sin(t) })
    }
    x = px
    y = py
  }

  while (i < tokens.length) {
    const t = tokens[i]
    if (t !== undefined && /^[a-zA-Z]$/.test(t)) {
      cmd = t
      i++
    }
    const rel = cmd === cmd.toLowerCase()
    const ox = rel ? x : 0
    const oy = rel ? y : 0
    switch (cmd.toUpperCase()) {
      case 'M': {
        flush()
        const nx = ox + next()
        const ny = oy + next()
        cur.push({ x: nx, y: ny })
        x = nx
        y = ny
        startX = nx
        startY = ny
        cmd = rel ? 'l' : 'L'
        break
      }
      case 'L':
        lineTo(ox + next(), oy + next())
        break
      case 'H':
        lineTo(ox + next(), y)
        break
      case 'V':
        lineTo(x, oy + next())
        break
      case 'C': {
        const c1 = { x: ox + next(), y: oy + next() }
        const c2 = { x: ox + next(), y: oy + next() }
        const p = { x: ox + next(), y: oy + next() }
        cubic(c1, c2, p)
        break
      }
      case 'S': {
        const c1 = ctrl.last ? { x: 2 * x - ctrl.last.x, y: 2 * y - ctrl.last.y } : { x, y }
        const c2 = { x: ox + next(), y: oy + next() }
        const p = { x: ox + next(), y: oy + next() }
        cubic(c1, c2, p)
        break
      }
      case 'Q': {
        const c = { x: ox + next(), y: oy + next() }
        const p = { x: ox + next(), y: oy + next() }
        quad(c, p)
        break
      }
      case 'T': {
        const c = ctrl.last ? { x: 2 * x - ctrl.last.x, y: 2 * y - ctrl.last.y } : { x, y }
        const p = { x: ox + next(), y: oy + next() }
        quad(c, p)
        break
      }
      case 'A': {
        const rx = next()
        const ry = next()
        const rot = next()
        const large = next()
        const sweep = next()
        const px = ox + next()
        const py = oy + next()
        arc(rx, ry, rot, large, sweep, px, py)
        break
      }
      case 'Z':
        cur.push({ x: startX, y: startY })
        x = startX
        y = startY
        flush()
        cur.push({ x: startX, y: startY })
        break
      default:
        i++
    }
    if (!isNum() && i < tokens.length && !/^[a-zA-Z]$/.test(tokens[i] ?? '')) i++
  }
  flush()
  return polys
}

// ---- Fill: zig-zag hachure clipped to the shape ----

function polyBounds(polys: Vec[][]): Bounds {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const poly of polys) {
    for (const p of poly) {
      if (p.x < minX) minX = p.x
      if (p.y < minY) minY = p.y
      if (p.x > maxX) maxX = p.x
      if (p.y > maxY) maxY = p.y
    }
  }
  return { minX, minY, maxX, maxY }
}

/** Intersections of the line through (px,py) with direction (dx,dy) against polygon edges, as params along the line. */
function lineHits(polys: Vec[][], px: number, py: number, dx: number, dy: number): number[] {
  const hits: number[] = []
  for (const poly of polys) {
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i]
      const b = poly[(i + 1) % poly.length]
      if (!a || !b) continue
      const ex = b.x - a.x
      const ey = b.y - a.y
      const den = dx * ey - dy * ex
      if (Math.abs(den) < 1e-9) continue
      const t = ((a.x - px) * ey - (a.y - py) * ex) / den
      const u = ((a.x - px) * dy - (a.y - py) * dx) / den
      if (u >= 0 && u < 1) hits.push(t)
    }
  }
  return hits.sort((m, n) => m - n)
}

function hachure(polys: Vec[][], rng: Rng, spacing: number): Vec[] {
  const b = polyBounds(polys)
  if (!Number.isFinite(b.minX)) return []
  const angle = -Math.PI / 4 + (rng() - 0.5) * 0.5
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
    const hits = lineHits(polys, px, py, dx, dy)
    if (hits.length < 2) continue
    const segs: Array<[number, number]> = []
    for (let k = 0; k + 1 < hits.length; k += 2) {
      const t0 = hits[k]
      const t1 = hits[k + 1]
      if (t0 !== undefined && t1 !== undefined && t1 - t0 > 0.3) segs.push([t0, t1])
    }
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
  return pts
}

/** Outline polygons of a shape in local coords (used for fill clipping and bounds). */
function outlinePolys(shape: Shape): Vec[][] {
  switch (shape.k) {
    case 'circle': {
      const pts: Vec[] = []
      for (let i = 0; i < 40; i++) {
        const a = (i / 40) * Math.PI * 2
        pts.push({ x: shape.cx + Math.cos(a) * shape.r, y: shape.cy + Math.sin(a) * shape.r })
      }
      return [pts]
    }
    case 'ellipse': {
      const pts: Vec[] = []
      for (let i = 0; i < 40; i++) {
        const a = (i / 40) * Math.PI * 2
        pts.push({ x: shape.cx + Math.cos(a) * shape.rx, y: shape.cy + Math.sin(a) * shape.ry })
      }
      return [pts]
    }
    case 'rect':
      return [
        [
          { x: shape.x, y: shape.y },
          { x: shape.x + shape.w, y: shape.y },
          { x: shape.x + shape.w, y: shape.y + shape.h },
          { x: shape.x, y: shape.y + shape.h },
        ],
      ]
    case 'poly':
      return [shape.pts]
    case 'path':
      return parsePathData(shape.d)
    case 'line':
      return [
        [
          { x: shape.x1, y: shape.y1 },
          { x: shape.x2, y: shape.y2 },
        ],
      ]
    case 'text':
      return [
        [
          { x: shape.x, y: shape.y - shape.size },
          { x: shape.x + shape.size * 0.55 * shape.text.length, y: shape.y - shape.size },
          { x: shape.x + shape.size * 0.55 * shape.text.length, y: shape.y + shape.size * 0.3 },
          { x: shape.x, y: shape.y + shape.size * 0.3 },
        ],
      ]
  }
}

export function shapeBounds(shape: Shape): Bounds {
  const b = polyBounds(outlinePolys(shape))
  const pad = OUTLINE_WIDTH * 1.5
  return { minX: b.minX - pad, minY: b.minY - pad, maxX: b.maxX + pad, maxY: b.maxY + pad }
}

export function unionBounds(a: Bounds | null, b: Bounds): Bounds {
  if (!a) return b
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  }
}

/** Convert a shape into the crayon strokes that draw it, in drawing order (outline first, then coloring in). */
export function shapeToStrokes(shape: Shape, rng: Rng, opts: { speedMul?: number; wobbleAmp?: number } = {}): Stroke[] {
  const amp = opts.wobbleAmp ?? 0.35
  const speedMul = opts.speedMul ?? 1
  const strokes: Stroke[] = []
  const outline = (pts: Vec[], color: string): void => {
    strokes.push(makeStroke('outline', wobble(pts, rng, amp), color, OUTLINE_WIDTH, 0.9, null, speedMul))
  }
  const fill = (polys: Vec[][], color: string): void => {
    const z = hachure(polys, rng, FILL_SPACING)
    if (z.length > 1) strokes.push(makeStroke('fill', wobble(z, rng, amp * 0.6, 2), color, FILL_WIDTH, 0.62, polys, speedMul))
  }

  switch (shape.k) {
    case 'circle':
      outline(ellipsePts(shape.cx, shape.cy, shape.r, shape.r, rng), shape.color)
      if (shape.fill) fill(outlinePolys(shape), shape.color)
      break
    case 'ellipse':
      outline(ellipsePts(shape.cx, shape.cy, shape.rx, shape.ry, rng), shape.color)
      if (shape.fill) fill(outlinePolys(shape), shape.color)
      break
    case 'rect': {
      const polys = outlinePolys(shape)
      const poly = polys[0] ?? []
      const start = Math.floor(rng() * 4)
      const rotated = [...poly.slice(start), ...poly.slice(0, start)]
      outline(closeWithOvershoot(rotated), shape.color)
      if (shape.fill) fill(polys, shape.color)
      break
    }
    case 'line':
      outline(
        [
          { x: shape.x1, y: shape.y1 },
          { x: shape.x2, y: shape.y2 },
        ],
        shape.color
      )
      break
    case 'poly':
      outline(shape.closed ? closeWithOvershoot(shape.pts) : shape.pts, shape.color)
      if (shape.fill && shape.closed && shape.pts.length >= 3) fill([shape.pts], shape.color)
      break
    case 'path': {
      const polys = parsePathData(shape.d)
      for (const poly of polys) outline(poly, shape.color)
      if (shape.fill) {
        const closed = polys.filter((p) => p.length >= 3)
        if (closed.length > 0) fill(closed, shape.color)
      }
      break
    }
    case 'text': {
      const w = shape.size * 0.55 * shape.text.length
      const s = makeStroke(
        'text',
        [
          { x: shape.x, y: shape.y },
          { x: shape.x + w, y: shape.y },
        ],
        shape.color,
        OUTLINE_WIDTH,
        0.95,
        null,
        speedMul
      )
      s.text = { x: shape.x, y: shape.y, size: shape.size, text: shape.text }
      strokes.push(s)
      break
    }
  }
  return strokes
}

/** Position along a stroke at arc length s (clamped). Returns null for empty strokes. */
export function pointAt(stroke: Stroke, s: number): Vec | null {
  const { pts, cum } = stroke
  if (pts.length === 0) return null
  if (pts.length === 1 || s <= 0) return pts[0] ?? null
  if (s >= stroke.length) return pts[pts.length - 1] ?? null
  let lo = 0
  let hi = cum.length - 1
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1
    if ((cum[mid] ?? 0) <= s) lo = mid
    else hi = mid
  }
  const a = pts[lo]
  const b = pts[lo + 1]
  const ca = cum[lo] ?? 0
  const cb = cum[lo + 1] ?? ca
  if (!a || !b) return a ?? null
  const t = cb > ca ? (s - ca) / (cb - ca) : 0
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
}
