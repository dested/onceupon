import { describe, expect, test } from 'bun:test'
import { placeFinale, type Occluder } from './finale-place'
import { luminance, popShapeToStrokes, type PopContext } from './pop'
import { mulberry32 } from './rng'
import type { Shape } from './types'

const SIZE = 16
const TEXT = 'The End'

/** A filled circle on an object anchored at (x, y) on the given layer. */
function blob(x: number, y: number, r: number, layer: number): Occluder {
  return { shape: { k: 'circle', cx: 0, cy: 0, r, color: '#8a5a2b', fill: true }, x, y, scale: 1, flipped: false, layer }
}

describe('finale placement', () => {
  test('an empty page keeps the title at the top centre', () => {
    const spot = placeFinale([], SIZE, TEXT)
    expect(spot.name).toBe('top')
    expect(Math.round(spot.x + (SIZE * 0.58 * TEXT.length) / 2)).toBe(80)
    expect(Math.round(spot.y)).toBe(28)
  })

  test('a character under the top centre pushes the title off it', () => {
    const owl = blob(80, 26, 12, 0)
    const spot = placeFinale([owl], SIZE, TEXT)
    // Only the price of leaving the top centre (at most 1 + 42.5 x 0.04): nothing drawn under it.
    expect(spot.score <= 2.7).toBe(true)
    expect(spot.name === 'top' && Math.abs(spot.x - 47.52) < 0.01).toBe(false)
  })

  test('it would rather cover a cloud than a character', () => {
    // Characters fill the page except a window around the top row's centre, where a cloud sits.
    const rect = (x: number, y: number, w: number, h: number): Occluder => ({
      shape: { k: 'rect', x, y, w, h, color: '#8a5a2b', fill: true },
      x: 0,
      y: 0,
      scale: 1,
      flipped: false,
      layer: 0,
    })
    const items = [rect(0, 0, 40, 100), rect(120, 0, 40, 100), rect(40, 34, 80, 66), rect(40, 0, 80, 8), blob(80, 22, 9, -3)]
    const spot = placeFinale(items, SIZE, TEXT)
    expect(spot.name).toBe('top')
    expect(spot.score > 0).toBe(true)
  })

  test('hills and ground bands do not count as drawn things', () => {
    const band: Occluder = { shape: { k: 'rect', x: -2, y: 0, w: 164, h: 100, color: '#72c858', fill: true }, x: 0, y: 0, scale: 1, flipped: false, layer: -2 }
    expect(placeFinale([band], SIZE, TEXT).score).toBe(0)
  })

  test('the same shapes always give the same spot', () => {
    const items = [blob(60, 30, 10, 0), blob(110, 22, 8, -3), blob(30, 60, 12, 0)]
    expect(placeFinale(items, SIZE, TEXT)).toEqual(placeFinale(items, SIZE, TEXT))
  })
})

describe('white fill-only shapes stay white', () => {
  const ctx: PopContext = { ax: 80, ay: 40, background: false, next: undefined, pairedFill: null, speedMul: 1, wobbleAmp: 0.35 }

  test('a snowflake gets no grey edge', () => {
    const flake: Shape = { k: 'circle', cx: 0, cy: 0, r: 0.8, color: '#ffffff', fill: true }
    const strokes = popShapeToStrokes(flake, mulberry32(7), ctx)
    expect(strokes.length > 0).toBe(true)
    expect(strokes.every((s) => luminance(s.color) > 0.9)).toBe(true)
  })

  test('a bigger snow cap gets only a pale edge', () => {
    const cap: Shape = { k: 'poly', pts: [{ x: 0, y: 0 }, { x: 4, y: 5 }, { x: -4, y: 5 }], color: '#ffffff', fill: true, closed: true }
    const strokes = popShapeToStrokes(cap, mulberry32(7), ctx)
    expect(strokes.filter((s) => s.kind === 'outline').every((s) => luminance(s.color) > 0.6)).toBe(true)
  })
})
