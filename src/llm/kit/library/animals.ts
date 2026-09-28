/**
 * Four-legged animals, side view facing right: a rounded body, four stubby legs (far pair darker),
 * a big round head, a snout, species ears / tail / signature. Color slots: body, second (mane,
 * spots, stripes, belly), third (horn, nose).
 */
import { blob, circle, ink, light, line, luminance, oval, P, path, patch, poly, rrect, scallop, shade, xform, type KitShape, type PathCmd } from '../geom'
import { C, slot } from '../palette'
import type { KitDef, KitDrawing, KitParams } from '../types'

type Ear = 'mouse' | 'pointy' | 'floppy' | 'round' | 'leaf' | 'cow' | 'pig' | 'elephant' | 'long' | 'none'
type Tail = 'curve' | 'up' | 'horse' | 'curly' | 'tuft' | 'fluffy' | 'puff' | 'none'
type Snout = 'none' | 'small' | 'dog' | 'long' | 'wide' | 'pig' | 'trunk' | 'beak'

interface Species {
  body: string
  second: string
  third?: string
  /** body half-width, half-height, center height */
  rx: number
  ry: number
  by: number
  legH: number
  legW: number
  headR: number
  /** head center relative to the body's front-top */
  hx: number
  hy: number
  neck?: boolean
  ear: Ear
  tail: Tail
  snout: Snout
  extra?: Array<'mane' | 'lionmane' | 'horn' | 'spots' | 'stripes' | 'whiskers' | 'wool' | 'udder' | 'horns' | 'belly' | 'hooves' | 'tusks' | 'patch'>
  height: number
}

const SPECIES: Record<string, Species> = {
  cat: { body: 'orange', second: 'cream', rx: 78, ry: 46, by: 92, legH: 60, legW: 20, headR: 52, hx: 78, hy: -150, ear: 'pointy', tail: 'curve', snout: 'small', extra: ['whiskers', 'stripes'], height: 220 },
  dog: { body: 'tan', second: 'brown', rx: 88, ry: 48, by: 98, legH: 64, legW: 22, headR: 54, hx: 86, hy: -158, ear: 'floppy', tail: 'up', snout: 'dog', extra: ['patch'], height: 225 },
  puppy: { body: 'beige', second: 'brown', rx: 70, ry: 42, by: 82, legH: 50, legW: 20, headR: 52, hx: 72, hy: -140, ear: 'floppy', tail: 'up', snout: 'dog', height: 200 },
  horse: { body: 'brown', second: 'darkbrown', rx: 105, ry: 55, by: 150, legH: 118, legW: 22, headR: 44, hx: 150, hy: -262, neck: true, ear: 'leaf', tail: 'horse', snout: 'long', extra: ['mane', 'hooves'], height: 300 },
  unicorn: { body: 'white', second: 'lavender', third: 'golden', rx: 105, ry: 55, by: 150, legH: 118, legW: 22, headR: 44, hx: 150, hy: -262, neck: true, ear: 'leaf', tail: 'horse', snout: 'long', extra: ['mane', 'horn', 'hooves'], height: 330 },
  pony: { body: 'pink', second: 'purple', rx: 90, ry: 50, by: 118, legH: 88, legW: 22, headR: 44, hx: 128, hy: -218, neck: true, ear: 'leaf', tail: 'horse', snout: 'long', extra: ['mane', 'hooves'], height: 265 },
  cow: { body: 'white', second: 'black', third: 'pink', rx: 112, ry: 60, by: 118, legH: 82, legW: 26, headR: 52, hx: 118, hy: -178, ear: 'cow', tail: 'tuft', snout: 'wide', extra: ['spots', 'horns', 'udder', 'hooves'], height: 250 },
  pig: { body: 'pink', second: 'rose', rx: 92, ry: 58, by: 88, legH: 46, legW: 24, headR: 56, hx: 88, hy: -140, ear: 'pig', tail: 'curly', snout: 'pig', extra: ['hooves'], height: 205 },
  sheep: { body: 'white', second: 'black', rx: 95, ry: 60, by: 108, legH: 64, legW: 18, headR: 44, hx: 105, hy: -165, ear: 'leaf', tail: 'puff', snout: 'none', extra: ['wool'], height: 225 },
  lamb: { body: 'white', second: 'gray', rx: 76, ry: 50, by: 90, legH: 54, legW: 16, headR: 40, hx: 86, hy: -140, ear: 'leaf', tail: 'puff', snout: 'none', extra: ['wool'], height: 190 },
  goat: { body: 'white', second: 'gray', third: 'tan', rx: 90, ry: 50, by: 110, legH: 76, legW: 18, headR: 44, hx: 104, hy: -175, ear: 'leaf', tail: 'up', snout: 'long', extra: ['horns', 'hooves'], height: 240 },
  lion: { body: 'golden', second: 'ginger', rx: 100, ry: 55, by: 110, legH: 74, legW: 26, headR: 56, hx: 100, hy: -172, ear: 'round', tail: 'tuft', snout: 'small', extra: ['lionmane'], height: 260 },
  tiger: { body: 'orange', second: 'black', rx: 100, ry: 52, by: 104, legH: 70, legW: 24, headR: 54, hx: 100, hy: -165, ear: 'round', tail: 'curve', snout: 'small', extra: ['stripes', 'whiskers', 'belly'], height: 240 },
  fox: { body: 'orange', second: 'white', rx: 82, ry: 44, by: 88, legH: 56, legW: 18, headR: 48, hx: 82, hy: -140, ear: 'pointy', tail: 'fluffy', snout: 'small', extra: ['belly'], height: 205 },
  wolf: { body: 'gray', second: 'white', rx: 95, ry: 50, by: 104, legH: 72, legW: 20, headR: 50, hx: 96, hy: -165, ear: 'pointy', tail: 'fluffy', snout: 'dog', extra: ['belly'], height: 240 },
  elephant: { body: 'gray', second: 'pink', rx: 125, ry: 80, by: 150, legH: 80, legW: 42, headR: 72, hx: 112, hy: -200, ear: 'elephant', tail: 'tuft', snout: 'trunk', extra: ['tusks'], height: 290 },
  giraffe: { body: 'yellow', second: 'brown', rx: 88, ry: 48, by: 185, legH: 150, legW: 18, headR: 36, hx: 150, hy: -400, neck: true, ear: 'leaf', tail: 'tuft', snout: 'long', extra: ['spots', 'horns', 'hooves', 'mane'], height: 440 },
  deer: { body: 'brown', second: 'cream', rx: 88, ry: 46, by: 130, legH: 100, legW: 16, headR: 40, hx: 120, hy: -220, neck: true, ear: 'leaf', tail: 'puff', snout: 'long', extra: ['spots', 'horns', 'hooves'], height: 280 },
  mouse: { body: 'gray', second: 'pink', rx: 58, ry: 38, by: 50, legH: 18, legW: 14, headR: 36, hx: 58, hy: -80, ear: 'mouse', tail: 'curve', snout: 'small', extra: ['whiskers'], height: 135 },
  rat: { body: 'gray', second: 'pink', rx: 58, ry: 38, by: 50, legH: 18, legW: 14, headR: 36, hx: 58, hy: -80, ear: 'mouse', tail: 'curve', snout: 'small', extra: ['whiskers'], height: 135 },
  hippo: { body: 'lavender', second: 'pink', rx: 120, ry: 70, by: 110, legH: 50, legW: 36, headR: 64, hx: 110, hy: -150, ear: 'round', tail: 'none', snout: 'wide', height: 230 },
  rhino: { body: 'gray', second: 'white', rx: 120, ry: 68, by: 115, legH: 56, legW: 34, headR: 58, hx: 115, hy: -150, ear: 'leaf', tail: 'tuft', snout: 'wide', extra: ['horn'], height: 230 },
  bearwalk: { body: 'brown', second: 'tan', rx: 105, ry: 62, by: 110, legH: 62, legW: 32, headR: 56, hx: 105, hy: -165, ear: 'round', tail: 'none', snout: 'dog', height: 240 },
}

function earShapes(kind: Ear, col: string, inner: string, hx: number, hy: number, r: number): { back: KitShape[]; front: KitShape[] } {
  const back: KitShape[] = []
  const front: KitShape[] = []
  switch (kind) {
    case 'pointy':
      back.push(poly('ear', col, [P(hx - r * 0.75, hy - r * 0.5), P(hx - r * 0.55, hy - r * 1.45), P(hx - r * 0.05, hy - r * 0.85)]))
      back.push(poly('ear2', col, [P(hx + r * 0.05, hy - r * 0.85), P(hx + r * 0.5, hy - r * 1.45), P(hx + r * 0.72, hy - r * 0.5)]))
      front.push(patch(poly('earin', inner, [P(hx + r * 0.2, hy - r * 0.85), P(hx + r * 0.46, hy - r * 1.25), P(hx + r * 0.58, hy - r * 0.72)])))
      break
    case 'round':
      back.push(circle('ear', col, hx - r * 0.6, hy - r * 0.86, r * 0.38), circle('ear2', col, hx + r * 0.42, hy - r * 0.92, r * 0.38))
      back.push(patch(circle('earin', inner, hx + r * 0.42, hy - r * 1.02, r * 0.2)))
      break
    case 'mouse':
      back.push(circle('ear', col, hx - r * 0.55, hy - r * 0.95, r * 0.6), circle('ear2', col, hx + r * 0.35, hy - r * 1.0, r * 0.6))
      back.push(patch(circle('earin', inner, hx + r * 0.35, hy - r * 1.02, r * 0.38)))
      break
    case 'floppy':
      front.push(blob('ear', shade(col, 0.25), [P(hx - r * 0.35, hy - r * 0.85), P(hx - r * 0.05, hy - r * 0.75), P(hx - r * 0.25, hy + r * 0.25), P(hx - r * 0.7, hy + r * 0.35), P(hx - r * 0.8, hy - r * 0.35)]))
      break
    case 'leaf':
      back.push(blob('ear', col, [P(hx - r * 0.35, hy - r * 0.7), P(hx - r * 0.35, hy - r * 1.55), P(hx + r * 0.05, hy - r * 0.8)]))
      break
    case 'long':
      back.push(oval('ear', col, hx - r * 0.25, hy - r * 1.5, r * 0.3, r * 0.8), oval('ear2', col, hx + r * 0.3, hy - r * 1.45, r * 0.3, r * 0.8))
      break
    case 'cow':
      front.push(blob('ear', col, [P(hx - r * 0.7, hy - r * 0.55), P(hx - r * 1.35, hy - r * 0.62), P(hx - r * 1.05, hy - r * 0.3)]))
      break
    case 'pig':
      back.push(poly('ear', shade(col, 0.1), [P(hx - r * 0.7, hy - r * 0.55), P(hx - r * 0.55, hy - r * 1.35), P(hx - r * 0.05, hy - r * 0.9)]))
      back.push(poly('ear2', shade(col, 0.1), [P(hx + r * 0.05, hy - r * 0.95), P(hx + r * 0.45, hy - r * 1.35), P(hx + r * 0.6, hy - r * 0.6)]))
      break
    case 'elephant':
      front.push(blob('ear', col, [P(hx - r * 0.3, hy - r * 0.75), P(hx - r * 1.35, hy - r * 1.0), P(hx - r * 1.55, hy - r * 0.05), P(hx - r * 1.05, hy + r * 0.8), P(hx - r * 0.35, hy + r * 0.35)]))
      front.push(patch(blob('earin', inner, [P(hx - r * 0.5, hy - r * 0.5), P(hx - r * 1.2, hy - r * 0.7), P(hx - r * 1.3, hy - r * 0.05), P(hx - r * 0.95, hy + r * 0.5), P(hx - r * 0.55, hy + r * 0.2)])))
      break
    case 'none':
      break
  }
  return { back, front }
}

function tailShapes(kind: Tail, col: string, second: string, x: number, y: number, s: number): KitShape[] {
  const k = ink(col)
  switch (kind) {
    case 'curve':
      return [path('tail', col, [['M', x + 4, y - 8], ['C', x - 60 * s, y - 10 * s, x - 70 * s, y - 90 * s, x - 40 * s, y - 110 * s], ['C', x - 58 * s, y - 80 * s, x - 48 * s, y - 20 * s, x + 4, y + 10], ['Z']])]
    case 'up':
      return [path('tail', col, [['M', x + 4, y - 6], ['Q', x - 50 * s, y - 40 * s, x - 45 * s, y - 85 * s], ['Q', x - 30 * s, y - 40 * s, x + 6, y + 10], ['Z']])]
    case 'horse':
      return [blob('tail', second, [P(x + 4, y - 10), P(x - 45 * s, y - 20 * s), P(x - 70 * s, y + 50 * s), P(x - 55 * s, y + 110 * s), P(x - 30 * s, y + 60 * s), P(x - 5, y + 14)], undefined, 0.9)]
    case 'curly':
      return [{ id: 'tail', color: k, path: [['M', x + 2, y], ['C', x - 30 * s, y - 10 * s, x - 36 * s, y - 40 * s, x - 18 * s, y - 40 * s], ['C', x - 4 * s, y - 40 * s, x - 6 * s, y - 20 * s, x - 22 * s, y - 22 * s]] }]
    case 'tuft':
      return [{ id: 'tail', color: k, path: [['M', x + 2, y], ['Q', x - 40 * s, y + 10 * s, x - 42 * s, y + 70 * s]] }, blob('tailtuft', second, [P(x - 42 * s, y + 60 * s), P(x - 56 * s, y + 90 * s), P(x - 40 * s, y + 100 * s), P(x - 28 * s, y + 88 * s)])]
    case 'fluffy':
      return [blob('tail', col, [P(x + 6, y - 6), P(x - 60 * s, y - 50 * s), P(x - 125 * s, y - 30 * s), P(x - 90 * s, y + 10 * s), P(x - 30 * s, y + 20 * s)]), patch(blob('tailtip', second, [P(x - 100 * s, y - 42 * s), P(x - 125 * s, y - 30 * s), P(x - 100 * s, y + 4 * s), P(x - 88 * s, y - 20 * s)]))]
    case 'puff':
      return [{ id: 'tail', color: ink(col), fill: col, path: scallop(x - 6, y, 18 * s, 16 * s, 6, 0.15) }]
    case 'none':
      return []
  }
}

function buildQuad(sp: Species, p: KitParams): KitDrawing {
  const body = slot(p, 0, sp.body)
  const second = slot(p, 1, sp.second)
  const third = slot(p, 2, sp.third ?? 'pink')
  const extra = new Set(sp.extra ?? [])
  const sleep = p.pose === 'sleep'
  // Sitting (a rider in a car or boat) drops the body like sleep and hides the legs, head up.
  const low = sleep || p.pose === 'sit'
  const drop = low ? sp.by - sp.ry * 0.95 : 0
  const by = sp.by - drop
  const { rx, ry } = sp
  let hx = sp.hx
  let hy = sp.hy + drop + (sleep ? sp.headR * 0.5 : 0)
  if (sleep && sp.neck) {
    hx = sp.hx * 0.85
    hy = -by - ry * 0.4
  }
  const r = sp.headR
  const back: KitShape[] = []
  const shapes: KitShape[] = []
  const farCol = shade(body, 0.22)
  const legTop = -by + ry * 0.2
  const legFoot = extra.has('hooves') ? shade(body, 0.55) : shade(body, 0.12)
  const legs = (id: string, x: number, col: string): KitShape[] => {
    const h = -legTop
    const out: KitShape[] = [rrect(id, col, x - sp.legW / 2, legTop, sp.legW, h, sp.legW * 0.45)]
    if (extra.has('hooves')) out.push(rrect(`${id}_hoof`, legFoot, x - sp.legW / 2 - 1, -14, sp.legW + 2, 14, 4))
    else out.push(oval(`${id}_paw`, col, x + sp.legW * 0.2, -6, sp.legW * 0.72, 8))
    return out
  }
  // tail behind, far legs behind
  back.push(...tailShapes(sp.tail, body, second, -rx * 0.92, -by - ry * 0.25, Math.max(0.7, rx / 95)))
  if (!low) {
    back.push(...legs('leg3', -rx * 0.5 + 16, farCol), ...legs('leg4', rx * 0.55 + 16, farCol))
  }
  // neck
  if (sp.neck) {
    shapes.push(blob('neck', body, [P(rx * 0.25, -by - ry * 0.55), P(hx - r * 0.85, hy + r * 0.05), P(hx - r * 0.2, hy - r * 0.35), P(hx + r * 0.3, hy + r * 0.55), P(rx * 0.95, -by - ry * 0.05), P(rx * 0.55, -by + ry * 0.2)], undefined, 0.7))
  }
  // body
  if (extra.has('wool')) {
    shapes.push({ id: 'body', color: '#9a9aa4', fill: body, path: scallop(0, -by, rx * 1.05, ry * 1.08, 11, 0.07, 0.3) })
  } else {
    shapes.push(blob('body', body, [P(-rx, -by + ry * 0.1), P(-rx * 0.7, -by - ry * 0.95), P(rx * 0.3, -by - ry * 1.02), P(rx, -by - ry * 0.25), P(rx * 0.75, -by + ry * 0.85), P(-rx * 0.55, -by + ry * 0.92)]))
  }
  const bellyCol = luminance(second) < 0.3 ? C('cream') : light(second, 0.2)
  if (extra.has('belly')) shapes.push(patch(oval('belly', bellyCol, rx * 0.1, -by + ry * 0.45, rx * 0.6, ry * 0.42)))
  if (extra.has('spots')) {
    const n = 5
    for (let i = 0; i < n; i++) {
      const sx = -rx * 0.6 + (i * rx * 1.2) / (n - 1) + (p.rng() - 0.5) * 20
      const sy = -by + (i % 2 === 0 ? -ry * 0.35 : ry * 0.2)
      shapes.push(patch(blob(`spot${i}`, second, [P(sx - 16, sy), P(sx, sy - 14), P(sx + 18, sy - 2), P(sx + 4, sy + 14)])))
    }
    if (sp.neck) for (let i = 0; i < 3; i++) {
      const t = (i + 1) / 4
      const sx = rx * 0.6 + (hx - r * 0.3 - rx * 0.6) * t
      const sy = -by - ry * 0.5 + (hy + by + ry * 0.5) * t
      shapes.push(patch(circle(`nspot${i}`, second, sx, sy, 10)))
    }
  }
  if (extra.has('stripes')) {
    for (let i = 0; i < 4; i++) {
      const sx = -rx * 0.55 + i * rx * 0.36
      shapes.push({ id: `stripe${i}`, color: shade(second === body ? '#3a2a24' : second, 0.1), path: [['M', sx - 6, -by - ry * 0.95], ['Q', sx + 10, -by - ry * 0.4, sx - 2, -by - ry * 0.05]] })
    }
  }
  if (extra.has('patch')) shapes.push(patch(blob('patch', second, [P(-rx * 0.5, -by - ry * 0.8), P(-rx * 0.05, -by - ry * 0.85), P(-rx * 0.1, -by - ry * 0.2), P(-rx * 0.55, -by - ry * 0.1)])))
  if (extra.has('udder')) shapes.push(oval('udder', third, -rx * 0.1, -by + ry * 0.95, 22, 13))
  // near legs over the body bottom
  if (!low) shapes.push(...legs('leg1', -rx * 0.5, body), ...legs('leg2', rx * 0.55, body))
  // mane along the neck / on top of the head
  const ears = earShapes(sp.ear, extra.has('wool') ? second : body, light(third, 0.3), hx, hy, r)
  if (extra.has('lionmane')) shapes.push({ id: 'mane', color: ink(second), fill: second, path: scallop(hx - r * 0.1, hy, r * 1.55, r * 1.5, 12, 0.09, 0.1) })
  if (!extra.has('lionmane')) shapes.push(...ears.back)
  // head
  const headCol = extra.has('wool') ? second : body
  shapes.push(circle('head', headCol, hx, hy, r))
  if (extra.has('mane')) {
    const mx = hx - r * 0.7
    const my = hy - r * 0.55
    const tail = sp.neck ? P(rx * 0.3, -by - ry * 0.75) : P(hx - r * 1.2, hy + r * 0.6)
    shapes.push(blob('mane', second, [P(mx + r * 0.5, my - r * 0.55), P(mx - r * 0.35, my - r * 0.1), P((mx + tail.x) / 2 - r * 0.45, (my + tail.y) / 2), P(tail.x - r * 0.2, tail.y), P(tail.x + r * 0.35, tail.y - r * 0.15), P((mx + tail.x) / 2 + r * 0.2, (my + tail.y) / 2 - r * 0.2), P(mx + r * 0.5, my + r * 0.1)], undefined, 0.9))
  }
  // snout
  const sx = hx + r * 0.78
  const sy = hy + r * 0.38
  switch (sp.snout) {
    case 'small':
      shapes.push(patch(oval('muzzle', light(headCol, 0.55), hx + r * 0.62, hy + r * 0.42, r * 0.34, r * 0.24)))
      shapes.push(poly('nose', third === body ? C('pink') : C('pink'), [P(hx + r * 0.78, hy + r * 0.22), P(hx + r * 0.98, hy + r * 0.22), P(hx + r * 0.88, hy + r * 0.36)]))
      break
    case 'dog':
      shapes.push(oval('muzzle', light(headCol, 0.35), sx, sy, r * 0.5, r * 0.36))
      shapes.push(oval('nose', C('black'), sx + r * 0.42, sy - r * 0.12, r * 0.16, r * 0.12))
      break
    case 'long':
      shapes.push(oval('muzzle', light(headCol, 0.25), hx + r * 0.9, hy + r * 0.45, r * 0.72, r * 0.5))
      shapes.push(patch(circle('nostril', shade(headCol, 0.5), hx + r * 1.35, hy + r * 0.38, r * 0.08)))
      break
    case 'wide':
      shapes.push(oval('muzzle', third, sx, sy + r * 0.05, r * 0.6, r * 0.42))
      shapes.push(patch(circle('nostril', shade(third, 0.45), sx + r * 0.1, sy, r * 0.08)), patch(circle('nostril2', shade(third, 0.45), sx + r * 0.38, sy, r * 0.08)))
      break
    case 'pig':
      shapes.push(oval('snout', light(headCol, 0.15), hx + r * 0.95, hy + r * 0.2, r * 0.3, r * 0.36))
      shapes.push(patch(oval('nostril', shade(headCol, 0.5), hx + r * 1.0, hy + r * 0.08, r * 0.06, r * 0.1)), patch(oval('nostril2', shade(headCol, 0.5), hx + r * 1.0, hy + r * 0.32, r * 0.06, r * 0.1)))
      break
    case 'trunk':
      shapes.push(path('trunk', headCol, [['M', hx + r * 0.55, hy + r * 0.1], ['C', hx + r * 1.4, hy + r * 0.4, hx + r * 1.2, hy + r * 1.3, hx + r * 1.55, hy + r * 1.7], ['L', hx + r * 1.3, hy + r * 1.85], ['C', hx + r * 0.9, hy + r * 1.4, hx + r * 1.0, hy + r * 0.9, hx + r * 0.4, hy + r * 0.8], ['Z']]))
      break
    default:
      break
  }
  if (extra.has('tusks')) shapes.push(path('tusk', C('cream'), [['M', hx + r * 0.6, hy + r * 0.75], ['Q', hx + r * 0.9, hy + r * 1.2, hx + r * 1.2, hy + r * 1.05], ['Q', hx + r * 0.85, hy + r * 1.0, hx + r * 0.75, hy + r * 0.62], ['Z']]))
  if (extra.has('horn')) {
    const hc = sp.snout === 'wide' ? C('cream') : third
    const baseX = sp.snout === 'wide' ? hx + r * 1.05 : hx + r * 0.2
    const baseY = sp.snout === 'wide' ? hy - r * 0.05 : hy - r * 0.85
    shapes.push(poly('horn', hc, [P(baseX - r * 0.22, baseY + r * 0.05), P(baseX + r * 0.35, baseY - r * 1.05), P(baseX + r * 0.2, baseY + r * 0.1)]))
    if (sp.snout !== 'wide') shapes.push({ id: 'hornline', color: ink(hc), path: [['M', baseX - r * 0.1, baseY - r * 0.2], ['L', baseX + r * 0.15, baseY - r * 0.3], ['M', baseX, baseY - r * 0.5], ['L', baseX + r * 0.22, baseY - r * 0.58]] })
  }
  if (extra.has('horns')) {
    const hc = sp.snout === 'long' && sp.neck ? shade(body, 0.3) : C('cream')
    shapes.push(path('horns', hc, [['M', hx - r * 0.35, hy - r * 0.8], ['Q', hx - r * 0.6, hy - r * 1.4, hx - r * 0.25, hy - r * 1.55], ['Q', hx - r * 0.35, hy - r * 1.2, hx - r * 0.1, hy - r * 0.9], ['Z']]))
    shapes.push(path('horns2', hc, [['M', hx + r * 0.05, hy - r * 0.9], ['Q', hx + r * 0.1, hy - r * 1.45, hx + r * 0.45, hy - r * 1.5], ['Q', hx + r * 0.25, hy - r * 1.2, hx + r * 0.3, hy - r * 0.85], ['Z']]))
  }
  shapes.push(...ears.front)
  if (extra.has('whiskers')) {
    const wx = hx + r * 0.72
    const wy = hy + r * 0.45
    shapes.push({ id: 'whiskers', color: '#5a4a44', path: [['M', wx + 8, wy - 4], ['L', wx + r * 0.95, wy - r * 0.2], ['M', wx + 8, wy + 2], ['L', wx + r * 1.0, wy + r * 0.08], ['M', wx - 8, wy - 4], ['L', wx - r * 0.6, wy - r * 0.2]] })
  }
  return {
    shapes: [...back, ...shapes],
    head: { id: 'head', cx: hx, cy: hy, r, facing: 'right' },
    neck: { x: hx - r * 0.3, y: hy + r * 0.9, w: r * 1.2 },
  }
}

const S = (k: string): Species => {
  const s = SPECIES[k]
  if (!s) throw new Error(`no species ${k}`)
  return s
}

function quad(kind: string, doc: string, aliases?: string[]): KitDef {
  const sp = S(kind)
  return { kind, ...(aliases ? { aliases } : {}), doc, height: sp.height, idle: 'breathe', character: true, build: (p) => buildQuad(sp, p) }
}

export const ANIMALS: KitDef[] = [
  quad('cat', 'cat [fur] [belly] (whiskers)', ['kitty', 'kitten']),
  quad('dog', 'dog [fur] [patch]', ['doggy', 'hound']),
  quad('puppy', 'puppy [fur] [ears]'),
  quad('horse', 'horse [body] [mane]', ['stallion', 'mare']),
  quad('unicorn', 'unicorn [body] [mane] [horn]'),
  quad('pony', 'pony [body] [mane]'),
  quad('cow', 'cow [body] [spots] [muzzle]', ['bull', 'calf']),
  quad('pig', 'pig [body] [ears]', ['piggy', 'piglet', 'hog']),
  quad('sheep', 'sheep [wool] [face]'),
  quad('lamb', 'lamb [wool] [face]'),
  quad('goat', 'goat [body] [horns]'),
  quad('lion', 'lion [body] [mane]'),
  quad('tiger', 'tiger [body] [stripes]'),
  quad('fox', 'fox [body] [belly]'),
  quad('wolf', 'wolf [body] [belly]'),
  quad('elephant', 'elephant [body] [ear inside]'),
  quad('giraffe', 'giraffe [body] [spots]'),
  quad('deer', 'deer [body] [spots]', ['reindeer', 'fawn']),
  quad('mouse', 'mouse [body] [ears]', ['mice']),
  quad('rat', 'rat [body] [ears]'),
  quad('hippo', 'hippo [body] [muzzle]', ['hippopotamus']),
  quad('rhino', 'rhino [body]', ['rhinoceros']),
]

export { line, xform }
export type { PathCmd }
