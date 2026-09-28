/**
 * Shape helpers for the kit library. Everything is in the ops paper frame, local to an entity:
 * anchor at the feet (0,0), x right, negative y up, paper units (1200x620 page).
 * A KitShape is a JSON-dialect draw shape without its entity: it goes through the same zod schema,
 * so recolor, replace-by-id and the scene description work on kit drawings exactly as on ops ones.
 */
import type { PathCmd } from '~/llm/json-dsl'
import { hashString, mulberry32 } from '~/engine/rng'

export type { PathCmd }

export interface KitShape {
  id: string
  /** Outline (hex). */
  color: string
  /** Fill (hex). fill === color draws the fill only, no outline. */
  fill?: string
  path?: PathCmd[]
  circle?: [number, number, number]
  oval?: [number, number, number, number]
  rect?: [number, number, number, number]
  poly?: number[]
  mirror?: boolean
}

export interface Pt {
  x: number
  y: number
}

const r1 = (n: number): number => Math.round(n * 10) / 10

/* ---------- colors ---------- */

function hexToRgb(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function rgbToHex(r: number, g: number, b: number): string {
  const c = (v: number): string =>
    Math.max(0, Math.min(255, Math.round(v)))
      .toString(16)
      .padStart(2, '0')
  return `#${c(r)}${c(g)}${c(b)}`
}

/** Mix two hex colors; t=0 gives a, t=1 gives b. */
export function mix(a: string, b: string, t: number): string {
  const [ar, ag, ab] = hexToRgb(a)
  const [br, bg, bb] = hexToRgb(b)
  return rgbToHex(ar + (br - ar) * t, ag + (bg - ag) * t, ab + (bb - ab) * t)
}

/** The crayon outline for a fill: the same hue, much darker, a touch warm. */
export function ink(fill: string): string {
  return mix(fill, '#2a1a12', 0.55)
}

export const shade = (fill: string, t = 0.18): string => mix(fill, '#3a2230', t)
export const light = (fill: string, t = 0.45): string => mix(fill, '#fffaf0', t)

export function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex)
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255
}

/* ---------- primitives ---------- */

export function circle(id: string, fill: string, cx: number, cy: number, r: number, outline?: string): KitShape {
  return { id, color: outline ?? ink(fill), fill, circle: [r1(cx), r1(cy), r1(r)] }
}

export function oval(id: string, fill: string, cx: number, cy: number, rx: number, ry: number, outline?: string): KitShape {
  return { id, color: outline ?? ink(fill), fill, oval: [r1(cx), r1(cy), r1(rx), r1(ry)] }
}

/** A fill-only patch (no outline): shading, cheeks, bellies, highlights. */
export function patch(shape: KitShape): KitShape {
  const fill = shape.fill ?? shape.color
  return { ...shape, color: fill, fill }
}

/** An outline-only line (no fill). */
export function line(id: string, color: string, pts: Pt[], smooth = true): KitShape {
  return { id, color, path: smooth ? openCurve(pts) : polyline(pts) }
}

export function poly(id: string, fill: string, pts: Pt[], outline?: string): KitShape {
  return { id, color: outline ?? ink(fill), fill, poly: pts.flatMap((p) => [r1(p.x), r1(p.y)]) }
}

/** A closed smooth blob through the points (Catmull-Rom as cubic Béziers). */
export function blob(id: string, fill: string, pts: Pt[], outline?: string, tension = 1): KitShape {
  return { id, color: outline ?? ink(fill), fill, path: closedCurve(pts, tension) }
}

/** A rounded rectangle (x,y top-left). */
export function rrect(id: string, fill: string, x: number, y: number, w: number, h: number, rad: number, outline?: string): KitShape {
  return { id, color: outline ?? ink(fill), fill, path: roundRectPath(x, y, w, h, rad) }
}

export function rect(id: string, fill: string, x: number, y: number, w: number, h: number, outline?: string): KitShape {
  return { id, color: outline ?? ink(fill), fill, rect: [r1(x), r1(y), r1(w), r1(h)] }
}

/** A closed path from raw commands. */
export function path(id: string, fill: string | undefined, cmds: PathCmd[], outline?: string): KitShape {
  if (fill === undefined) return { id, color: outline ?? '#2b2626', path: cmds }
  return { id, color: outline ?? ink(fill), fill, path: cmds }
}

/* ---------- path builders ---------- */

export const P = (x: number, y: number): Pt => ({ x, y })

export function polyline(pts: Pt[]): PathCmd[] {
  const out: PathCmd[] = []
  pts.forEach((p, i) => out.push([i === 0 ? 'M' : 'L', r1(p.x), r1(p.y)]))
  return out
}

/** Closed Catmull-Rom spline through the points. */
export function closedCurve(pts: Pt[], tension = 1): PathCmd[] {
  const n = pts.length
  if (n < 3) return polyline(pts)
  const at = (i: number): Pt => pts[((i % n) + n) % n] ?? P(0, 0)
  const first = at(0)
  const out: PathCmd[] = [['M', r1(first.x), r1(first.y)]]
  const k = tension / 6
  for (let i = 0; i < n; i++) {
    const p0 = at(i - 1)
    const p1 = at(i)
    const p2 = at(i + 1)
    const p3 = at(i + 2)
    out.push([
      'C',
      r1(p1.x + (p2.x - p0.x) * k),
      r1(p1.y + (p2.y - p0.y) * k),
      r1(p2.x - (p3.x - p1.x) * k),
      r1(p2.y - (p3.y - p1.y) * k),
      r1(p2.x),
      r1(p2.y),
    ])
  }
  out.push(['Z'])
  return out
}

/** Open Catmull-Rom spline through the points (ends clamped). */
export function openCurve(pts: Pt[], tension = 1): PathCmd[] {
  const n = pts.length
  if (n < 3) return polyline(pts)
  const at = (i: number): Pt => pts[Math.max(0, Math.min(n - 1, i))] ?? P(0, 0)
  const first = at(0)
  const out: PathCmd[] = [['M', r1(first.x), r1(first.y)]]
  const k = tension / 6
  for (let i = 0; i < n - 1; i++) {
    const p0 = at(i - 1)
    const p1 = at(i)
    const p2 = at(i + 1)
    const p3 = at(i + 2)
    out.push([
      'C',
      r1(p1.x + (p2.x - p0.x) * k),
      r1(p1.y + (p2.y - p0.y) * k),
      r1(p2.x - (p3.x - p1.x) * k),
      r1(p2.y - (p3.y - p1.y) * k),
      r1(p2.x),
      r1(p2.y),
    ])
  }
  return out
}

export function roundRectPath(x: number, y: number, w: number, h: number, rad: number): PathCmd[] {
  const r = Math.min(rad, w / 2, h / 2)
  return [
    ['M', r1(x + r), r1(y)],
    ['L', r1(x + w - r), r1(y)],
    ['Q', r1(x + w), r1(y), r1(x + w), r1(y + r)],
    ['L', r1(x + w), r1(y + h - r)],
    ['Q', r1(x + w), r1(y + h), r1(x + w - r), r1(y + h)],
    ['L', r1(x + r), r1(y + h)],
    ['Q', r1(x), r1(y + h), r1(x), r1(y + h - r)],
    ['L', r1(x), r1(y + r)],
    ['Q', r1(x), r1(y), r1(x + r), r1(y)],
    ['Z'],
  ]
}

/** An ellipse as four cubic arcs (so it can be rotated). */
export function ellipsePath(cx: number, cy: number, rx: number, ry: number): PathCmd[] {
  const k = 0.5523
  return [
    ['M', r1(cx + rx), r1(cy)],
    ['C', r1(cx + rx), r1(cy + ry * k), r1(cx + rx * k), r1(cy + ry), r1(cx), r1(cy + ry)],
    ['C', r1(cx - rx * k), r1(cy + ry), r1(cx - rx), r1(cy + ry * k), r1(cx - rx), r1(cy)],
    ['C', r1(cx - rx), r1(cy - ry * k), r1(cx - rx * k), r1(cy - ry), r1(cx), r1(cy - ry)],
    ['C', r1(cx + rx * k), r1(cy - ry), r1(cx + rx), r1(cy - ry * k), r1(cx + rx), r1(cy)],
    ['Z'],
  ]
}

/** A star polygon's points. */
export function starPts(cx: number, cy: number, rOut: number, rIn: number, n = 5, rot = -Math.PI / 2): Pt[] {
  const pts: Pt[] = []
  for (let i = 0; i < n * 2; i++) {
    const r = i % 2 === 0 ? rOut : rIn
    const a = rot + (i * Math.PI) / n
    pts.push(P(cx + Math.cos(a) * r, cy + Math.sin(a) * r))
  }
  return pts
}

/** Points around an ellipse, for blobs (n points, optional jitter from a seeded rng). */
export function ringPts(cx: number, cy: number, rx: number, ry: number, n: number, start = 0): Pt[] {
  const pts: Pt[] = []
  for (let i = 0; i < n; i++) {
    const a = start + (i / n) * Math.PI * 2
    pts.push(P(cx + Math.cos(a) * rx, cy + Math.sin(a) * ry))
  }
  return pts
}

/** A scalloped cloud/bush/mane outline: bumps around an ellipse. */
export function scallop(cx: number, cy: number, rx: number, ry: number, bumps: number, depth: number, start = 0): PathCmd[] {
  const out: PathCmd[] = []
  const pt = (a: number, s: number): Pt => P(cx + Math.cos(a) * rx * s, cy + Math.sin(a) * ry * s)
  const a0 = start
  const p0 = pt(a0, 1)
  out.push(['M', r1(p0.x), r1(p0.y)])
  for (let i = 0; i < bumps; i++) {
    const a1 = start + ((i + 1) / bumps) * Math.PI * 2
    const am = (start + ((i + 0.5) / bumps) * Math.PI * 2)
    const c = pt(am, 1 + depth * 2)
    const e = pt(a1, 1)
    out.push(['Q', r1(c.x), r1(c.y), r1(e.x), r1(e.y)])
  }
  out.push(['Z'])
  return out
}

/* ---------- transforms ---------- */

export interface Xform {
  dx?: number
  dy?: number
  s?: number
  /** Radians, about the origin, applied before translation. */
  rot?: number
  flipX?: boolean
}

function xpt(x: number, y: number, t: Xform): Pt {
  const s = t.s ?? 1
  let px = x * s * (t.flipX ? -1 : 1)
  let py = y * s
  if (t.rot) {
    const c = Math.cos(t.rot)
    const sn = Math.sin(t.rot)
    const nx = px * c - py * sn
    const ny = px * sn + py * c
    px = nx
    py = ny
  }
  return P(r1(px + (t.dx ?? 0)), r1(py + (t.dy ?? 0)))
}

function xpath(cmds: PathCmd[], t: Xform): PathCmd[] {
  return cmds.map((c): PathCmd => {
    switch (c[0]) {
      case 'M':
      case 'L': {
        const p = xpt(c[1], c[2], t)
        return [c[0], p.x, p.y]
      }
      case 'Q': {
        const a = xpt(c[1], c[2], t)
        const b = xpt(c[3], c[4], t)
        return ['Q', a.x, a.y, b.x, b.y]
      }
      case 'C': {
        const a = xpt(c[1], c[2], t)
        const b = xpt(c[3], c[4], t)
        const d = xpt(c[5], c[6], t)
        return ['C', a.x, a.y, b.x, b.y, d.x, d.y]
      }
      case 'Z':
        return c
    }
  })
}

/** The shape as a path (for rotation). Mirror stays a flag. */
function asPath(s: KitShape): PathCmd[] | null {
  if (s.path) return s.path
  if (s.oval) return ellipsePath(s.oval[0], s.oval[1], s.oval[2], s.oval[3])
  if (s.rect) return polyline([P(s.rect[0], s.rect[1]), P(s.rect[0] + s.rect[2], s.rect[1]), P(s.rect[0] + s.rect[2], s.rect[1] + s.rect[3]), P(s.rect[0], s.rect[1] + s.rect[3])]).concat([['Z']])
  if (s.poly) {
    const pts: Pt[] = []
    for (let i = 0; i + 1 < s.poly.length; i += 2) pts.push(P(s.poly[i] ?? 0, s.poly[i + 1] ?? 0))
    return polyline(pts).concat([['Z']])
  }
  return null
}

/** Mirror flags become two shapes (so flips and rotations stay correct). */
function unmirror(s: KitShape): KitShape[] {
  if (!s.mirror) return [s]
  const { mirror: _m, ...base } = s
  return [base, { ...xform([base], { flipX: true })[0] ?? base, id: `${s.id}_m` }]
}

export function xform(shapes: KitShape[], t: Xform): KitShape[] {
  const out: KitShape[] = []
  for (const s0 of shapes) {
    const parts = t.flipX || t.rot ? unmirror(s0) : [s0]
    for (const s of parts) {
      const { circle: c, oval: o, rect: r, poly: pl, path: pa, ...rest } = s
      const sc = t.s ?? 1
      if (c && !t.rot) {
        const p = xpt(c[0], c[1], t)
        out.push({ ...rest, circle: [p.x, p.y, r1(c[2] * sc)] })
      } else if (c) {
        const p = xpt(c[0], c[1], t)
        out.push({ ...rest, circle: [p.x, p.y, r1(c[2] * sc)] })
      } else if (o && !t.rot) {
        const p = xpt(o[0], o[1], t)
        out.push({ ...rest, oval: [p.x, p.y, r1(o[2] * sc), r1(o[3] * sc)] })
      } else if (r && !t.rot && !t.flipX) {
        const p = xpt(r[0], r[1], t)
        out.push({ ...rest, rect: [p.x, p.y, r1(r[2] * sc), r1(r[3] * sc)] })
      } else if (pl && !t.rot) {
        const pts: number[] = []
        for (let i = 0; i + 1 < pl.length; i += 2) {
          const p = xpt(pl[i] ?? 0, pl[i + 1] ?? 0, t)
          pts.push(p.x, p.y)
        }
        out.push({ ...rest, poly: pts })
      } else {
        const cmds = pa ?? asPath(s)
        if (cmds) out.push({ ...rest, path: xpath(cmds, t) })
      }
    }
  }
  return out
}

/** Prefix every shape id (so two builders can be merged into one entity). */
export function prefixIds(shapes: KitShape[], prefix: string): KitShape[] {
  return shapes.map((s) => ({ ...s, id: `${prefix}${s.id}` }))
}

/* ---------- determinism ---------- */

export type Rng = () => number
export function rngFor(key: string): Rng {
  return mulberry32(hashString(key))
}
/** A seeded value in [a, b]. */
export const between = (rng: Rng, a: number, b: number): number => a + (b - a) * rng()

/** Rough vertical extent of a shape list (paper units, local), for anchoring and heights. */
export function extent(shapes: KitShape[]): { minX: number; maxX: number; minY: number; maxY: number } {
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  const add = (x: number, y: number): void => {
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
  }
  for (const s of shapes) {
    const m = s.mirror ? [1, -1] : [1]
    for (const sx of m) {
      if (s.circle) {
        add(s.circle[0] * sx - s.circle[2], s.circle[1] - s.circle[2])
        add(s.circle[0] * sx + s.circle[2], s.circle[1] + s.circle[2])
      } else if (s.oval) {
        add(s.oval[0] * sx - s.oval[2], s.oval[1] - s.oval[3])
        add(s.oval[0] * sx + s.oval[2], s.oval[1] + s.oval[3])
      } else if (s.rect) {
        add(s.rect[0] * sx, s.rect[1])
        add((s.rect[0] + s.rect[2]) * sx, s.rect[1] + s.rect[3])
      } else if (s.poly) {
        for (let i = 0; i + 1 < s.poly.length; i += 2) add((s.poly[i] ?? 0) * sx, s.poly[i + 1] ?? 0)
      } else if (s.path) {
        for (const c of s.path) {
          if (c[0] === 'M' || c[0] === 'L') add(c[1] * sx, c[2])
          else if (c[0] === 'Q') add(c[3] * sx, c[4])
          else if (c[0] === 'C') add(c[5] * sx, c[6])
        }
      }
    }
  }
  return { minX, maxX, minY, maxY }
}
