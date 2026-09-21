import type { Shape, Vec } from './types'
import { CRAYONS } from './colors'

/**
 * Prefab scenery the model can place with one line: `s sun 140 15 10`.
 * Each stamp returns shapes in local coords centered on (x, y); `size` is roughly its height.
 * Characters are NOT stamps on purpose; the model composes those from primitives.
 */
export const STAMP_NAMES = [
  'sun',
  'moon',
  'cloud',
  'tree',
  'pine',
  'bush',
  'flower',
  'grass',
  'house',
  'castle',
  'mountain',
  'rock',
  'star',
  'heart',
  'car',
  'person',
] as const

export type StampName = (typeof STAMP_NAMES)[number]

export function isStampName(s: string): s is StampName {
  return STAMP_NAMES.some((n) => n === s)
}

const C = (n: string): string => CRAYONS[n] ?? '#2b2626'

function pick(color: string | undefined, fallback: string): string {
  return color ?? C(fallback)
}

function starPts(cx: number, cy: number, outer: number, inner: number, points = 5): Vec[] {
  const pts: Vec[] = []
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? outer : inner
    const a = -Math.PI / 2 + (i * Math.PI) / points
    pts.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r })
  }
  return pts
}

export function stampShapes(name: string, x: number, y: number, size: number, color: string | undefined): Shape[] {
  const s = size
  const n = name as StampName
  switch (n) {
    case 'sun':
      return [
        ...Array.from({ length: 8 }, (_, i): Shape => {
          const a = (i * Math.PI) / 4
          return {
            k: 'line',
            x1: x + Math.cos(a) * s * 0.65,
            y1: y + Math.sin(a) * s * 0.65,
            x2: x + Math.cos(a) * s * 1.0,
            y2: y + Math.sin(a) * s * 1.0,
            color: pick(color, 'orange'),
          }
        }),
        { k: 'circle', cx: x, cy: y, r: s * 0.5, color: pick(color, 'yellow'), fill: true },
      ]
    case 'moon':
      return [
        {
          k: 'path',
          d: `M ${x} ${y - s / 2} A ${s / 2} ${s / 2} 0 1 0 ${x} ${y + s / 2} A ${s * 0.35} ${s / 2} 0 1 1 ${x} ${y - s / 2} Z`,
          color: pick(color, 'yellow'),
          fill: true,
        },
      ]
    case 'cloud': {
      const c = pick(color, 'white')
      return [
        { k: 'ellipse', cx: x, cy: y + s * 0.1, rx: s * 0.9, ry: s * 0.4, color: c, fill: true },
        { k: 'circle', cx: x - s * 0.35, cy: y - s * 0.1, r: s * 0.38, color: c, fill: true },
        { k: 'circle', cx: x + s * 0.15, cy: y - s * 0.25, r: s * 0.45, color: c, fill: true },
        { k: 'circle', cx: x + s * 0.5, cy: y, r: s * 0.32, color: c, fill: true },
      ]
    }
    case 'tree':
      return [
        { k: 'rect', x: x - s * 0.08, y: y - s * 0.1, w: s * 0.16, h: s * 0.6, color: C('brown'), fill: true },
        { k: 'circle', cx: x, cy: y - s * 0.3, r: s * 0.32, color: pick(color, 'green'), fill: true },
        { k: 'circle', cx: x - s * 0.22, cy: y - s * 0.15, r: s * 0.24, color: pick(color, 'green'), fill: true },
        { k: 'circle', cx: x + s * 0.22, cy: y - s * 0.15, r: s * 0.24, color: pick(color, 'green'), fill: true },
      ]
    case 'pine':
      return [
        { k: 'rect', x: x - s * 0.06, y: y + s * 0.3, w: s * 0.12, h: s * 0.2, color: C('brown'), fill: true },
        {
          k: 'poly',
          pts: [
            { x: x, y: y - s * 0.5 },
            { x: x + s * 0.3, y: y },
            { x: x - s * 0.3, y: y },
          ],
          color: pick(color, 'darkgreen'),
          fill: true,
          closed: true,
        },
        {
          k: 'poly',
          pts: [
            { x: x, y: y - s * 0.2 },
            { x: x + s * 0.4, y: y + s * 0.3 },
            { x: x - s * 0.4, y: y + s * 0.3 },
          ],
          color: pick(color, 'darkgreen'),
          fill: true,
          closed: true,
        },
      ]
    case 'bush': {
      const c = pick(color, 'green')
      return [
        { k: 'circle', cx: x - s * 0.4, cy: y + s * 0.1, r: s * 0.35, color: c, fill: true },
        { k: 'circle', cx: x + s * 0.4, cy: y + s * 0.1, r: s * 0.35, color: c, fill: true },
        { k: 'circle', cx: x, cy: y - s * 0.05, r: s * 0.45, color: c, fill: true },
      ]
    }
    case 'flower': {
      const petal = pick(color, 'pink')
      const pr = s * 0.18
      return [
        { k: 'line', x1: x, y1: y + s * 0.5, x2: x, y2: y - s * 0.1, color: C('green') },
        { k: 'circle', cx: x - pr * 1.4, cy: y - s * 0.2, r: pr, color: petal, fill: true },
        { k: 'circle', cx: x + pr * 1.4, cy: y - s * 0.2, r: pr, color: petal, fill: true },
        { k: 'circle', cx: x, cy: y - s * 0.2 - pr * 1.4, r: pr, color: petal, fill: true },
        { k: 'circle', cx: x, cy: y - s * 0.2 + pr * 1.4, r: pr, color: petal, fill: true },
        { k: 'circle', cx: x, cy: y - s * 0.2, r: pr * 0.8, color: C('yellow'), fill: true },
      ]
    }
    case 'grass':
      return Array.from({ length: 7 }, (_, i): Shape => {
        const gx = x - s * 0.6 + (i * s * 1.2) / 6
        const lean = (i % 3) - 1
        return { k: 'line', x1: gx, y1: y + s * 0.15, x2: gx + lean * s * 0.15, y2: y - s * 0.25, color: pick(color, 'green') }
      })
    case 'house': {
      const wall = pick(color, 'peach')
      const w = s * 1.1
      const h = s * 0.6
      return [
        { k: 'rect', x: x - w / 2, y: y - h * 0.4, w, h, color: wall, fill: true },
        {
          k: 'poly',
          pts: [
            { x: x - w * 0.6, y: y - h * 0.4 },
            { x: x, y: y - h * 0.4 - s * 0.45 },
            { x: x + w * 0.6, y: y - h * 0.4 },
          ],
          color: C('red'),
          fill: true,
          closed: true,
        },
        { k: 'rect', x: x - w * 0.12, y: y + h * 0.15, w: w * 0.24, h: h * 0.45, color: C('brown'), fill: true },
        { k: 'rect', x: x + w * 0.18, y: y - h * 0.2, w: w * 0.2, h: h * 0.25, color: C('skyblue'), fill: true },
        { k: 'rect', x: x - w * 0.38, y: y - h * 0.2, w: w * 0.2, h: h * 0.25, color: C('skyblue'), fill: true },
      ]
    }
    case 'castle': {
      const wall = pick(color, 'gray')
      const w = s * 1.3
      const h = s * 0.7
      const tw = s * 0.28
      return [
        { k: 'rect', x: x - w / 2, y: y - h * 0.3, w, h, color: wall, fill: true },
        { k: 'rect', x: x - w / 2 - tw * 0.2, y: y - h * 0.8, w: tw, h: h * 1.5, color: wall, fill: true },
        { k: 'rect', x: x + w / 2 - tw * 0.8, y: y - h * 0.8, w: tw, h: h * 1.5, color: wall, fill: true },
        {
          k: 'poly',
          pts: [
            { x: x - w / 2 - tw * 0.3, y: y - h * 0.8 },
            { x: x - w / 2 + tw * 0.3, y: y - h * 0.8 - s * 0.35 },
            { x: x - w / 2 + tw * 0.9, y: y - h * 0.8 },
          ],
          color: C('purple'),
          fill: true,
          closed: true,
        },
        {
          k: 'poly',
          pts: [
            { x: x + w / 2 - tw * 0.9, y: y - h * 0.8 },
            { x: x + w / 2 - tw * 0.3, y: y - h * 0.8 - s * 0.35 },
            { x: x + w / 2 + tw * 0.3, y: y - h * 0.8 },
          ],
          color: C('purple'),
          fill: true,
          closed: true,
        },
        {
          k: 'path',
          d: `M ${x - s * 0.12} ${y + h * 0.7} L ${x - s * 0.12} ${y + h * 0.2} A ${s * 0.12} ${s * 0.12} 0 0 1 ${x + s * 0.12} ${y + h * 0.2} L ${x + s * 0.12} ${y + h * 0.7} Z`,
          color: C('brown'),
          fill: true,
        },
      ]
    }
    case 'mountain':
      return [
        {
          k: 'poly',
          pts: [
            { x: x - s * 0.9, y: y + s * 0.5 },
            { x: x, y: y - s * 0.5 },
            { x: x + s * 0.9, y: y + s * 0.5 },
          ],
          color: pick(color, 'gray'),
          fill: true,
          closed: true,
        },
        {
          k: 'poly',
          pts: [
            { x: x - s * 0.22, y: y - s * 0.26 },
            { x: x, y: y - s * 0.5 },
            { x: x + s * 0.22, y: y - s * 0.26 },
            { x: x + s * 0.1, y: y - s * 0.2 },
            { x: x - s * 0.1, y: y - s * 0.2 },
          ],
          color: C('white'),
          fill: true,
          closed: true,
        },
      ]
    case 'rock':
      return [{ k: 'ellipse', cx: x, cy: y, rx: s * 0.6, ry: s * 0.4, color: pick(color, 'gray'), fill: true }]
    case 'star':
      return [{ k: 'poly', pts: starPts(x, y, s * 0.5, s * 0.22), color: pick(color, 'yellow'), fill: true, closed: true }]
    case 'heart':
      return [
        {
          k: 'path',
          d: `M ${x} ${y + s * 0.45} C ${x - s * 0.9} ${y - s * 0.2} ${x - s * 0.45} ${y - s * 0.6} ${x} ${y - s * 0.15} C ${x + s * 0.45} ${y - s * 0.6} ${x + s * 0.9} ${y - s * 0.2} ${x} ${y + s * 0.45} Z`,
          color: pick(color, 'red'),
          fill: true,
        },
      ]
    case 'car': {
      const body = pick(color, 'red')
      const w = s * 1.6
      return [
        { k: 'rect', x: x - w / 2, y: y - s * 0.1, w, h: s * 0.35, color: body, fill: true },
        { k: 'rect', x: x - w * 0.28, y: y - s * 0.4, w: w * 0.55, h: s * 0.32, color: body, fill: true },
        { k: 'rect', x: x - w * 0.2, y: y - s * 0.34, w: w * 0.17, h: s * 0.2, color: C('skyblue'), fill: true },
        { k: 'rect', x: x + w * 0.03, y: y - s * 0.34, w: w * 0.17, h: s * 0.2, color: C('skyblue'), fill: true },
        { k: 'circle', cx: x - w * 0.3, cy: y + s * 0.3, r: s * 0.16, color: C('black'), fill: true },
        { k: 'circle', cx: x + w * 0.3, cy: y + s * 0.3, r: s * 0.16, color: C('black'), fill: true },
      ]
    }
    case 'person': {
      const shirt = pick(color, 'blue')
      const skin = C('peach')
      const h = s
      return [
        { k: 'circle', cx: x, cy: y - h * 0.38, r: h * 0.12, color: skin, fill: true },
        { k: 'rect', x: x - h * 0.13, y: y - h * 0.26, w: h * 0.26, h: h * 0.3, color: shirt, fill: true },
        { k: 'line', x1: x - h * 0.13, y1: y - h * 0.2, x2: x - h * 0.3, y2: y - h * 0.02, color: skin },
        { k: 'line', x1: x + h * 0.13, y1: y - h * 0.2, x2: x + h * 0.3, y2: y - h * 0.02, color: skin },
        { k: 'line', x1: x - h * 0.07, y1: y + h * 0.04, x2: x - h * 0.12, y2: y + h * 0.5, color: C('navy') },
        { k: 'line', x1: x + h * 0.07, y1: y + h * 0.04, x2: x + h * 0.12, y2: y + h * 0.5, color: C('navy') },
        { k: 'circle', cx: x - h * 0.04, cy: y - h * 0.4, r: h * 0.015, color: C('black'), fill: true },
        { k: 'circle', cx: x + h * 0.04, cy: y - h * 0.4, r: h * 0.015, color: C('black'), fill: true },
      ]
    }
  }
}
