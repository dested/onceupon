/**
 * Where the closing "The End" title goes: the candidate spot that covers the least of the drawing.
 * Pure and deterministic (no canvas, no clock), so the studio, replay and the mp4 export, which all
 * hold the same shapes at the same resting positions when the story ends, pick the same spot.
 */
import { outlinePolys } from './geometry'
import { GROUND_Y, WORLD_H, WORLD_W, type Shape, type Vec } from './types'

/** One drawn shape at rest, in world space terms: its object's anchor, scale and facing. */
export interface Occluder {
  shape: Shape
  x: number
  y: number
  scale: number
  flipped: boolean
  /** The object's layer: 0 and up (and -1, hidden behind something) are characters and props, -2 and below scenery. */
  layer: number
}

export interface FinaleSpot {
  /** Left edge and baseline of the title, world units. */
  x: number
  y: number
  name: string
  score: number
}

/**
 * Characters and props count fully; scenery (clouds, sun, moon, trees) far less, so the title would
 * rather brush a cloud than hide a castle flag; hills barely (their outline still shows through the
 * letters); the sky and ground bands not at all.
 */
const CHARACTER_WEIGHT = 1
const SCENERY_WEIGHT = 0.15
const HILL_WEIGHT = 0.05
/** A scenery shape this wide is a hill or a wash, not a thing in the picture. */
const FILL_WIDTH = WORLD_W * 0.45
const MARGIN = 5
/** Slide step and the price per world unit of sliding away from the centre line. */
const STEP = 2
const SLIDE_COST = 0.04
/** Grid cell, world units: the coverage is sampled at cell centres. */
const CELL = 1
const GW = Math.ceil(WORLD_W / CELL)
const GH = Math.ceil(WORLD_H / CELL)

/**
 * Advance per character of "The End" in the scrawl hand, as a fraction of the size (measured: 65
 * world units at size 16). A fixed number, never measureText: a font still loading would move it.
 */
export const TITLE_ADVANCE = 0.58
/** Clear space wanted around the lettering, and what something drawn there costs against the ink itself. */
const CLEARANCE = 2.5
const CLEARANCE_COST = 0.4

/**
 * The ink box of the title at its (left, baseline) anchor, grown by `pad`. "The End" has capitals and
 * ascenders but no descenders: measured, the lettering with its outline runs 0.9 of the size above
 * the baseline and a hair below it.
 */
export function titleBox(x: number, y: number, size: number, chars: number, pad = 0): { x0: number; y0: number; x1: number; y1: number } {
  return { x0: x - pad, y0: y - size * 0.9 - pad, x1: x + size * TITLE_ADVANCE * chars + pad, y1: y + size * 0.1 + pad }
}

/**
 * The candidate spots: four rows (the old top line, a higher line above the clouds, the open sky
 * under the clouds, and the band just above the ground), each slid across the page in 2-unit steps. `bias` is the small price of
 * leaving the top centre, so a spot moves only to clear something actually drawn.
 */
export function finaleCandidates(size: number, chars: number): { name: string; x: number; y: number; bias: number }[] {
  const w = size * TITLE_ADVANCE * chars
  const centre = WORLD_W / 2 - w / 2
  const rows = [
    { name: 'top', y: WORLD_H * 0.28, bias: 0 },
    { name: 'high', y: size + MARGIN - 1, bias: 0.5 },
    { name: 'middle', y: WORLD_H * 0.48, bias: 0.75 },
    { name: 'above the ground', y: GROUND_Y - 4, bias: 1 },
  ]
  const out: { name: string; x: number; y: number; bias: number }[] = []
  for (const r of rows) {
    out.push({ name: r.name, x: centre, y: r.y, bias: r.bias })
    for (let d = STEP; centre - d >= MARGIN - 1e-9; d += STEP) {
      out.push({ name: r.name, x: centre - d, y: r.y, bias: r.bias + d * SLIDE_COST })
      out.push({ name: r.name, x: centre + d, y: r.y, bias: r.bias + d * SLIDE_COST })
    }
  }
  return out
}

function pointInPoly(px: number, py: number, poly: Vec[]): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]
    const b = poly[j]
    if (!a || !b) continue
    if (a.y > py !== b.y > py && px < ((b.x - a.x) * (py - a.y)) / (b.y - a.y) + a.x) inside = !inside
  }
  return inside
}

function segDist2(px: number, py: number, a: Vec, b: Vec): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len = dx * dx + dy * dy
  const t = len > 0 ? Math.max(0, Math.min(1, ((px - a.x) * dx + (py - a.y) * dy) / len)) : 0
  const qx = a.x + dx * t - px
  const qy = a.y + dy * t - py
  return qx * qx + qy * qy
}

/** Does the shape cover an area (fill, or a closed outline), or only draw a line? */
function isArea(shape: Shape): boolean {
  if (shape.k === 'line') return false
  if (shape.k === 'text') return true
  if (shape.fill) return true
  if (shape.k === 'path') return false
  if (shape.k === 'poly') return shape.closed
  return true
}

/** Coverage weight per grid cell: the heaviest drawn thing on it. */
export function coverageGrid(items: Occluder[]): Float32Array {
  const grid = new Float32Array(GW * GH)
  for (const it of items) {
    const s = it.shape
    if (s.k === 'rect' && s.fill && s.w >= WORLD_W * 0.8) continue
    const sx = it.scale * (it.flipped ? -1 : 1)
    const polys = outlinePolys(s)
      .filter((p) => p.length > 0)
      .map((p) => p.map((q) => ({ x: it.x + q.x * sx, y: it.y + q.y * it.scale })))
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const p of polys)
      for (const q of p) {
        minX = Math.min(minX, q.x)
        minY = Math.min(minY, q.y)
        maxX = Math.max(maxX, q.x)
        maxY = Math.max(maxY, q.y)
      }
    if (!Number.isFinite(minX)) continue
    const scenery = it.layer <= -2
    const weight = !scenery ? CHARACTER_WEIGHT : maxX - minX >= FILL_WIDTH ? HILL_WEIGHT : SCENERY_WEIGHT
    const area = isArea(s)
    const reach = 0.9 * Math.max(1, it.scale)
    const pad = area ? 0 : reach
    const gx0 = Math.max(0, Math.floor((minX - pad) / CELL))
    const gx1 = Math.min(GW - 1, Math.floor((maxX + pad) / CELL))
    const gy0 = Math.max(0, Math.floor((minY - pad) / CELL))
    const gy1 = Math.min(GH - 1, Math.floor((maxY + pad) / CELL))
    for (let gy = gy0; gy <= gy1; gy++) {
      for (let gx = gx0; gx <= gx1; gx++) {
        const i = gy * GW + gx
        if ((grid[i] ?? 0) >= weight) continue
        const px = (gx + 0.5) * CELL
        const py = (gy + 0.5) * CELL
        let hit = false
        if (area) {
          for (const p of polys) if (p.length >= 3 && pointInPoly(px, py, p)) hit = true
        } else {
          const r2 = reach * reach
          for (const p of polys) {
            for (let k = 0; k + 1 < p.length && !hit; k++) {
              const a = p[k]
              const b = p[k + 1]
              if (a && b && segDist2(px, py, a, b) <= r2) hit = true
            }
            if (hit) break
          }
        }
        if (hit) grid[i] = weight
      }
    }
  }
  return grid
}

function scoreBox(grid: Float32Array, b: { x0: number; y0: number; x1: number; y1: number }): number {
  let sum = 0
  const gx0 = Math.max(0, Math.floor(b.x0 / CELL))
  const gx1 = Math.min(GW - 1, Math.ceil(b.x1 / CELL) - 1)
  const gy0 = Math.max(0, Math.floor(b.y0 / CELL))
  const gy1 = Math.min(GH - 1, Math.ceil(b.y1 / CELL) - 1)
  for (let gy = gy0; gy <= gy1; gy++) for (let gx = gx0; gx <= gx1; gx++) sum += grid[gy * GW + gx] ?? 0
  return sum
}

/** The candidate spot that covers the least of the drawing (earlier candidates win ties: centre first, then the top row). */
export function placeFinale(items: Occluder[], size: number, text: string): FinaleSpot {
  const grid = coverageGrid(items)
  let best: FinaleSpot | null = null
  for (const c of finaleCandidates(size, text.length)) {
    // Rounded so float noise can never flip a tie between machines.
    const ink = scoreBox(grid, titleBox(c.x, c.y, size, text.length))
    const ring = scoreBox(grid, titleBox(c.x, c.y, size, text.length, CLEARANCE)) - ink
    const score = Math.round((ink + ring * CLEARANCE_COST + c.bias) * 100) / 100
    if (!best || score < best.score) best = { name: c.name, x: c.x, y: c.y, score }
  }
  if (!best) throw new Error('placeFinale: no candidates')
  return best
}
