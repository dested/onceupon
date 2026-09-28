/**
 * Sketch geometry, in the entity's 100-box (x 0..100, y 0..100 down, feet at y=100). Everything the
 * model writes becomes one of three canonical geometries: a circle, an oval, or an absolute
 * M/L/Q/C/Z path (the only path commands the engine knows). Smooth curves (blob, curve), rounded
 * rects and full SVG path syntax (relative, H/V, S/T, A) are expanded here.
 */
import type { PathCmd } from '~/llm/json-dsl'

export interface Pt {
  x: number
  y: number
}

export type Geo =
  | { k: 'circle'; cx: number; cy: number; r: number }
  | { k: 'oval'; cx: number; cy: number; rx: number; ry: number }
  | { k: 'path'; cmds: PathCmd[]; closed: boolean }

const NUM_RE = /^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i

/* ---------- smooth curves ---------- */

function pairs(nums: number[]): Pt[] {
  const out: Pt[] = []
  for (let i = 0; i + 1 < nums.length; i += 2) out.push({ x: nums[i] ?? 0, y: nums[i + 1] ?? 0 })
  return out
}

/** Closed Catmull-Rom through the points, as cubic Béziers. */
export function blobPath(nums: number[]): Geo {
  const p = pairs(nums)
  const n = p.length
  const at = (i: number): Pt => p[((i % n) + n) % n] ?? { x: 0, y: 0 }
  const first = at(0)
  const cmds: PathCmd[] = [['M', first.x, first.y]]
  for (let i = 0; i < n; i++) {
    const p0 = at(i - 1)
    const p1 = at(i)
    const p2 = at(i + 1)
    const p3 = at(i + 2)
    cmds.push([
      'C',
      p1.x + (p2.x - p0.x) / 6,
      p1.y + (p2.y - p0.y) / 6,
      p2.x - (p3.x - p1.x) / 6,
      p2.y - (p3.y - p1.y) / 6,
      p2.x,
      p2.y,
    ])
  }
  cmds.push(['Z'])
  return { k: 'path', cmds, closed: true }
}

/** Open Catmull-Rom through the points (a tail, an arm, a smile, a mane). */
export function curvePath(nums: number[]): Geo {
  const p = pairs(nums)
  const n = p.length
  const at = (i: number): Pt => p[Math.max(0, Math.min(n - 1, i))] ?? { x: 0, y: 0 }
  const first = at(0)
  const cmds: PathCmd[] = [['M', first.x, first.y]]
  for (let i = 0; i < n - 1; i++) {
    const p0 = at(i - 1)
    const p1 = at(i)
    const p2 = at(i + 1)
    const p3 = at(i + 2)
    cmds.push([
      'C',
      p1.x + (p2.x - p0.x) / 6,
      p1.y + (p2.y - p0.y) / 6,
      p2.x - (p3.x - p1.x) / 6,
      p2.y - (p3.y - p1.y) / 6,
      p2.x,
      p2.y,
    ])
  }
  return { k: 'path', cmds, closed: false }
}

export function polyPath(nums: number[]): Geo {
  const p = pairs(nums)
  const first = p[0] ?? { x: 0, y: 0 }
  const cmds: PathCmd[] = [['M', first.x, first.y]]
  for (const q of p.slice(1)) cmds.push(['L', q.x, q.y])
  cmds.push(['Z'])
  return { k: 'path', cmds, closed: true }
}

/** A rect with rounded corners (r defaults to a slight rounding so boxes look hand-drawn). */
export function rectPath(x: number, y: number, w: number, h: number, r0?: number): Geo {
  const r = Math.max(0, Math.min(r0 ?? Math.min(w, h) * 0.12, w / 2, h / 2))
  if (r < 0.01) return polyPath([x, y, x + w, y, x + w, y + h, x, y + h])
  const cmds: PathCmd[] = [
    ['M', x + r, y],
    ['L', x + w - r, y],
    ['Q', x + w, y, x + w, y + r],
    ['L', x + w, y + h - r],
    ['Q', x + w, y + h, x + w - r, y + h],
    ['L', x + r, y + h],
    ['Q', x, y + h, x, y + h - r],
    ['L', x, y + r],
    ['Q', x, y, x + r, y],
    ['Z'],
  ]
  return { k: 'path', cmds, closed: true }
}

/* ---------- SVG path text ---------- */

const ARITY: Record<string, number> = { M: 2, L: 2, H: 1, V: 1, Q: 4, T: 2, C: 6, S: 4, A: 7, Z: 0 }

/** SVG elliptical arc -> cubic Béziers (endpoint to center parameterization). */
function arcToCubics(
  x1: number,
  y1: number,
  rx0: number,
  ry0: number,
  phiDeg: number,
  largeArc: boolean,
  sweep: boolean,
  x2: number,
  y2: number
): PathCmd[] {
  let rx = Math.abs(rx0)
  let ry = Math.abs(ry0)
  if (rx < 1e-6 || ry < 1e-6 || (x1 === x2 && y1 === y2)) return [['L', x2, y2]]
  const phi = (phiDeg * Math.PI) / 180
  const cos = Math.cos(phi)
  const sin = Math.sin(phi)
  const dx = (x1 - x2) / 2
  const dy = (y1 - y2) / 2
  const x1p = cos * dx + sin * dy
  const y1p = -sin * dx + cos * dy
  const lam = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry)
  if (lam > 1) {
    rx *= Math.sqrt(lam)
    ry *= Math.sqrt(lam)
  }
  const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p
  const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p
  let coef = Math.sqrt(Math.max(0, num / den))
  if (largeArc === sweep) coef = -coef
  const cxp = (coef * rx * y1p) / ry
  const cyp = (-coef * ry * x1p) / rx
  const cx = cos * cxp - sin * cyp + (x1 + x2) / 2
  const cy = sin * cxp + cos * cyp + (y1 + y2) / 2
  const ang = (ux: number, uy: number, vx: number, vy: number): number => {
    const a = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy)
    return a
  }
  const t1 = ang(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry)
  let dt = ang((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry)
  if (!sweep && dt > 0) dt -= 2 * Math.PI
  if (sweep && dt < 0) dt += 2 * Math.PI
  const segs = Math.max(1, Math.ceil(Math.abs(dt) / (Math.PI / 2)))
  const step = dt / segs
  const k = (4 / 3) * Math.tan(step / 4)
  const out: PathCmd[] = []
  const pt = (t: number): Pt => ({
    x: cx + rx * Math.cos(t) * cos - ry * Math.sin(t) * sin,
    y: cy + rx * Math.cos(t) * sin + ry * Math.sin(t) * cos,
  })
  const dpt = (t: number): Pt => ({
    x: -rx * Math.sin(t) * cos - ry * Math.cos(t) * sin,
    y: -rx * Math.sin(t) * sin + ry * Math.cos(t) * cos,
  })
  for (let i = 0; i < segs; i++) {
    const a = t1 + i * step
    const b = a + step
    const pa = pt(a)
    const pb = pt(b)
    const da = dpt(a)
    const db = dpt(b)
    out.push(['C', pa.x + k * da.x, pa.y + k * da.y, pb.x - k * db.x, pb.y - k * db.y, pb.x, pb.y])
  }
  return out
}

/** Full SVG path syntax -> absolute M/L/Q/C/Z. */
export function svgPath(text: string): Geo {
  const toks = text.match(/[MLHVQTCSAZmlhvqtcsaz]|[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/g) ?? []
  const cmds: PathCmd[] = []
  let cmd = ''
  let i = 0
  let cx = 0
  let cy = 0
  let sx = 0
  let sy = 0
  let lastC: Pt | null = null
  let lastQ: Pt | null = null
  let closed = false
  const take = (): number => {
    const t = toks[i++]
    if (t === undefined || !NUM_RE.test(t)) throw new Error(`path: ${cmd} is missing numbers`)
    return Number(t)
  }
  while (i < toks.length) {
    const t = toks[i] ?? ''
    if (/^[A-Za-z]$/.test(t)) {
      cmd = t
      i++
    } else if (!cmd) throw new Error('path must start with M')
    else if (cmd === 'M') cmd = 'L'
    else if (cmd === 'm') cmd = 'l'
    const up = cmd.toUpperCase()
    const rel = cmd !== up
    const ox = rel ? cx : 0
    const oy = rel ? cy : 0
    if (!(up in ARITY)) throw new Error(`path: unsupported command ${cmd}`)
    if (cmds.length === 0 && up !== 'M') throw new Error('path must start with M')
    let nextC: Pt | null = null
    let nextQ: Pt | null = null
    switch (up) {
      case 'M':
      case 'L': {
        const x = take() + ox
        const y = take() + oy
        cmds.push([up, x, y])
        cx = x
        cy = y
        if (up === 'M') {
          sx = x
          sy = y
        }
        break
      }
      case 'H': {
        cx = take() + ox
        cmds.push(['L', cx, cy])
        break
      }
      case 'V': {
        cy = take() + oy
        cmds.push(['L', cx, cy])
        break
      }
      case 'Q':
      case 'T': {
        let qx: number
        let qy: number
        if (up === 'Q') {
          qx = take() + ox
          qy = take() + oy
        } else {
          qx = lastQ ? 2 * cx - lastQ.x : cx
          qy = lastQ ? 2 * cy - lastQ.y : cy
        }
        const x = take() + ox
        const y = take() + oy
        cmds.push(['Q', qx, qy, x, y])
        nextQ = { x: qx, y: qy }
        cx = x
        cy = y
        break
      }
      case 'C':
      case 'S': {
        let c1x: number
        let c1y: number
        if (up === 'C') {
          c1x = take() + ox
          c1y = take() + oy
        } else {
          c1x = lastC ? 2 * cx - lastC.x : cx
          c1y = lastC ? 2 * cy - lastC.y : cy
        }
        const c2x = take() + ox
        const c2y = take() + oy
        const x = take() + ox
        const y = take() + oy
        cmds.push(['C', c1x, c1y, c2x, c2y, x, y])
        nextC = { x: c2x, y: c2y }
        cx = x
        cy = y
        break
      }
      case 'A': {
        const rx = take()
        const ry = take()
        const rot = take()
        const large = take() !== 0
        const sweep = take() !== 0
        const x = take() + ox
        const y = take() + oy
        cmds.push(...arcToCubics(cx, cy, rx, ry, rot, large, sweep, x, y))
        cx = x
        cy = y
        break
      }
      case 'Z':
        cmds.push(['Z'])
        cx = sx
        cy = sy
        cmd = ''
        closed = true
        break
    }
    lastC = nextC
    lastQ = nextQ
  }
  if (cmds.length < 2) throw new Error('path needs at least two points')
  return { k: 'path', cmds, closed }
}

/* ---------- transforms, sampling, clipping ---------- */

export function mapGeo(g: Geo, f: (p: Pt) => Pt, scale: number): Geo {
  if (g.k === 'circle') {
    const c = f({ x: g.cx, y: g.cy })
    return { k: 'circle', cx: c.x, cy: c.y, r: Math.abs(g.r * scale) }
  }
  if (g.k === 'oval') {
    const c = f({ x: g.cx, y: g.cy })
    return { k: 'oval', cx: c.x, cy: c.y, rx: Math.abs(g.rx * scale), ry: Math.abs(g.ry * scale) }
  }
  const cmds = g.cmds.map((c): PathCmd => {
    switch (c[0]) {
      case 'M':
      case 'L': {
        const p = f({ x: c[1], y: c[2] })
        return [c[0], p.x, p.y]
      }
      case 'Q': {
        const a = f({ x: c[1], y: c[2] })
        const b = f({ x: c[3], y: c[4] })
        return ['Q', a.x, a.y, b.x, b.y]
      }
      case 'C': {
        const a = f({ x: c[1], y: c[2] })
        const b = f({ x: c[3], y: c[4] })
        const d = f({ x: c[5], y: c[6] })
        return ['C', a.x, a.y, b.x, b.y, d.x, d.y]
      }
      case 'Z':
        return c
    }
  })
  return { k: 'path', cmds, closed: g.closed }
}

/** The outline of a closed geometry as a polygon (for pattern clipping). */
export function sampleGeo(g: Geo): Pt[] {
  if (g.k === 'circle' || g.k === 'oval') {
    const rx = g.k === 'circle' ? g.r : g.rx
    const ry = g.k === 'circle' ? g.r : g.ry
    const out: Pt[] = []
    for (let i = 0; i < 40; i++) {
      const a = (i / 40) * Math.PI * 2
      out.push({ x: g.cx + Math.cos(a) * rx, y: g.cy + Math.sin(a) * ry })
    }
    return out
  }
  const out: Pt[] = []
  let cur: Pt = { x: 0, y: 0 }
  for (const c of g.cmds) {
    switch (c[0]) {
      case 'M':
      case 'L':
        cur = { x: c[1], y: c[2] }
        out.push(cur)
        break
      case 'Q': {
        const p0 = cur
        for (let s = 1; s <= 8; s++) {
          const t = s / 8
          const u = 1 - t
          out.push({ x: u * u * p0.x + 2 * u * t * c[1] + t * t * c[3], y: u * u * p0.y + 2 * u * t * c[2] + t * t * c[4] })
        }
        cur = { x: c[3], y: c[4] }
        break
      }
      case 'C': {
        const p0 = cur
        for (let s = 1; s <= 10; s++) {
          const t = s / 10
          const u = 1 - t
          out.push({
            x: u * u * u * p0.x + 3 * u * u * t * c[1] + 3 * u * t * t * c[3] + t * t * t * c[5],
            y: u * u * u * p0.y + 3 * u * u * t * c[2] + 3 * u * t * t * c[4] + t * t * t * c[6],
          })
        }
        cur = { x: c[5], y: c[6] }
        break
      }
      case 'Z':
        break
    }
  }
  return out
}

export function bounds(pts: Pt[]): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const p of pts) {
    minX = Math.min(minX, p.x)
    minY = Math.min(minY, p.y)
    maxX = Math.max(maxX, p.x)
    maxY = Math.max(maxY, p.y)
  }
  return { minX, minY, maxX, maxY }
}

export function pointInPoly(p: Pt, poly: Pt[]): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]
    const b = poly[j]
    if (!a || !b) continue
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside
  }
  return inside
}

/** Sutherland–Hodgman: keep the part of `poly` on the side where keep(p) holds (a half-plane). */
function clipHalf(poly: Pt[], keep: (p: Pt) => boolean, cross: (a: Pt, b: Pt) => Pt): Pt[] {
  const out: Pt[] = []
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]
    const b = poly[(i + 1) % poly.length]
    if (!a || !b) continue
    const ia = keep(a)
    const ib = keep(b)
    if (ia) out.push(a)
    if (ia !== ib) out.push(cross(a, b))
  }
  return out
}

/** The part of a polygon between two lines y = c + slope*x (a slanted stripe band). */
export function clipBand(poly: Pt[], c0: number, c1: number, slope: number): Pt[] {
  const f = (p: Pt): number => p.y - slope * p.x
  const at = (a: Pt, b: Pt, c: number): Pt => {
    const fa = f(a)
    const fb = f(b)
    const t = (c - fa) / (fb - fa)
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
  }
  const lo = clipHalf(poly, (p) => f(p) >= c0, (a, b) => at(a, b, c0))
  return clipHalf(lo, (p) => f(p) <= c1, (a, b) => at(a, b, c1))
}
