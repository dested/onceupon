/**
 * Accessories that attach to ANY character at its head / neck / hand anchors. Back parts (cape,
 * wings) are drawn before the character, front parts after it (before the face).
 */
import { blob, circle, ink, line, oval, P, path, patch, poly, rrect, starPts, type KitShape } from '../geom'
import { C } from '../palette'
import type { HeadAnchor, KitDrawing } from '../types'

export const WEAR = [
  'crown',
  'tiara',
  'hat',
  'tophat',
  'wizardhat',
  'partyhat',
  'pirate',
  'cap',
  'helmet',
  'bow',
  'flower',
  'glasses',
  'sunglasses',
  'eyepatch',
  'mask',
  'scarf',
  'cape',
  'wings',
  'bowtie',
  'necklace',
] as const
export type Wear = (typeof WEAR)[number]
export const isWear = (s: string): s is Wear => (WEAR as readonly string[]).includes(s)

const ALIAS: Record<string, Wear> = {
  sunhat: 'hat',
  cowboyhat: 'hat',
  witchhat: 'wizardhat',
  wizard: 'wizardhat',
  party: 'partyhat',
  piratehat: 'pirate',
  baseballcap: 'cap',
  shades: 'sunglasses',
  patch: 'eyepatch',
  tie: 'bowtie',
  fairywings: 'wings',
}
export function wearName(s: string): Wear | null {
  const t = s.toLowerCase()
  if (isWear(t)) return t
  return ALIAS[t] ?? null
}

/** Eye positions the face helper will use (mirrors src/engine/face.ts). */
function eyes(h: HeadAnchor): { y: number; xs: [number, number]; r: number } {
  const minX = h.cx - h.r
  const w = h.r * 2
  const y = h.cy - h.r + w * 0.42
  const r = Math.max(4, w * 0.09)
  const xs: [number, number] = h.facing === 'front' ? [minX + w * 0.35, minX + w * 0.65] : [minX + w * 0.5, minX + w * 0.74]
  return { y, xs, r }
}

export interface WearParts {
  back: KitShape[]
  front: KitShape[]
  /** Drawn after the face (glasses, patch, mask). */
  over: KitShape[]
}

export function wearParts(items: Wear[], d: KitDrawing, color: string | undefined): WearParts {
  const back: KitShape[] = []
  const front: KitShape[] = []
  const over: KitShape[] = []
  const h = d.head
  for (const w of items) {
    const id = `w_${w}`
    if (w === 'cape') {
      const top = h ? h.cy + h.r * 0.9 : -150
      const c = color ?? C('red')
      back.push(blob(id, c, [P(-48, top), P(48, top), P(80, -20), P(0, -8), P(-80, -20)], undefined, 0.6))
      continue
    }
    if (w === 'wings') {
      const y = h ? h.cy + h.r * 1.5 : -150
      const c = color ?? C('lightblue')
      back.push(blob(`${id}1`, c, [P(-10, y), P(-95, y - 70), P(-120, y - 10), P(-70, y + 40)], undefined, 1))
      back.push(blob(`${id}2`, c, [P(10, y), P(95, y - 70), P(120, y - 10), P(70, y + 40)], undefined, 1))
      continue
    }
    if (w === 'scarf') {
      const n = d.neck ?? (h ? { x: h.cx, y: h.cy + h.r * 0.95, w: h.r * 1.4 } : null)
      if (!n) continue
      const c = color ?? C('red')
      front.push(rrect(id, c, n.x - n.w / 2, n.y - 10, n.w, 22, 10))
      front.push(rrect(`${id}_tail`, c, n.x + n.w * 0.12, n.y + 4, 20, 50, 8))
      continue
    }
    if (w === 'bowtie') {
      const n = d.neck ?? (h ? { x: h.cx, y: h.cy + h.r * 0.95, w: h.r } : null)
      if (!n) continue
      const c = color ?? C('red')
      front.push(poly(id, c, [P(n.x, n.y), P(n.x - 24, n.y - 14), P(n.x - 24, n.y + 14)]))
      front.push(poly(`${id}2`, c, [P(n.x, n.y), P(n.x + 24, n.y - 14), P(n.x + 24, n.y + 14)]))
      continue
    }
    if (w === 'necklace') {
      const n = d.neck ?? (h ? { x: h.cx, y: h.cy + h.r * 0.95, w: h.r } : null)
      if (!n) continue
      for (let i = -2; i <= 2; i++) front.push(circle(`${id}${i + 2}`, color ?? C('white'), n.x + i * 12, n.y + 6 + Math.abs(i) * -2 + 6, 6))
      continue
    }
    if (!h) continue
    const top = h.cy - h.r
    const { cx, r } = h
    switch (w) {
      case 'crown':
      case 'tiara': {
        const c = color ?? C('golden')
        const bw = w === 'tiara' ? r * 0.9 : r * 1.25
        const bh = w === 'tiara' ? r * 0.38 : r * 0.62
        const base = top + r * 0.22
        front.push(
          poly(id, c, [
            P(cx - bw / 2, base),
            P(cx - bw / 2, base - bh * 0.7),
            P(cx - bw / 4, base - bh * 0.35),
            P(cx, base - bh),
            P(cx + bw / 4, base - bh * 0.35),
            P(cx + bw / 2, base - bh * 0.7),
            P(cx + bw / 2, base),
          ])
        )
        front.push(circle(`${id}_gem`, C('red'), cx, base - bh * 0.3, Math.max(5, r * 0.09)))
        break
      }
      case 'hat': {
        const c = color ?? C('tan')
        front.push(oval(id, c, cx, top + r * 0.3, r * 1.45, r * 0.24))
        front.push(path(`${id}_top`, c, [['M', cx - r * 0.75, top + r * 0.3], ['C', cx - r * 0.75, top - r * 0.75, cx + r * 0.75, top - r * 0.75, cx + r * 0.75, top + r * 0.3], ['Z']]))
        front.push(patch(rrect(`${id}_band`, C('red'), cx - r * 0.74, top + r * 0.05, r * 1.48, r * 0.2, 4)))
        break
      }
      case 'tophat': {
        const c = color ?? C('black')
        front.push(oval(id, c, cx, top + r * 0.22, r * 1.1, r * 0.2))
        front.push(rrect(`${id}_top`, c, cx - r * 0.6, top - r * 0.9, r * 1.2, r * 1.1, 6))
        front.push(patch(rrect(`${id}_band`, C('red'), cx - r * 0.6, top - r * 0.05, r * 1.2, r * 0.2, 3)))
        break
      }
      case 'wizardhat': {
        const c = color ?? C('indigo')
        front.push(path(`${id}`, c, [['M', cx - r * 1.2, top + r * 0.35], ['Q', cx - r * 0.3, top - r * 0.2, cx + r * 0.2, top - r * 1.7], ['Q', cx + r * 0.4, top - r * 0.2, cx + r * 1.2, top + r * 0.35], ['Q', cx, top + r * 0.1, cx - r * 1.2, top + r * 0.35], ['Z']]))
        front.push(patch(poly(`${id}_star`, C('yellow'), starPts(cx - r * 0.05, top - r * 0.35, r * 0.24, r * 0.1))))
        break
      }
      case 'partyhat': {
        const c = color ?? C('pink')
        front.push(poly(id, c, [P(cx - r * 0.5, top + r * 0.2), P(cx + r * 0.15, top - r * 1.15), P(cx + r * 0.6, top + r * 0.25)]))
        front.push(circle(`${id}_pom`, C('yellow'), cx + r * 0.15, top - r * 1.2, r * 0.16))
        break
      }
      case 'pirate': {
        const c = color ?? C('black')
        front.push(path(id, c, [['M', cx - r * 1.35, top + r * 0.2], ['Q', cx - r * 1.1, top - r * 0.45, cx - r * 0.5, top - r * 0.2], ['Q', cx, top - r * 0.95, cx + r * 0.5, top - r * 0.2], ['Q', cx + r * 1.1, top - r * 0.45, cx + r * 1.35, top + r * 0.2], ['Q', cx, top + r * 0.05, cx - r * 1.35, top + r * 0.2], ['Z']]))
        front.push(patch(circle(`${id}_skull`, C('white'), cx, top - r * 0.25, r * 0.16)))
        break
      }
      case 'cap': {
        const c = color ?? C('blue')
        front.push(path(id, c, [['M', cx - r * 0.95, top + r * 0.45], ['C', cx - r, top - r * 0.45, cx + r, top - r * 0.45, cx + r * 0.95, top + r * 0.45], ['Z']]))
        const dir = h.facing === 'right' ? 1 : 1
        front.push(oval(`${id}_brim`, c, cx + dir * r * 0.75, top + r * 0.45, r * 0.6, r * 0.14))
        break
      }
      case 'helmet': {
        const c = color ?? C('silver')
        front.push(path(id, c, [['M', cx - r * 1.08, top + r * 0.7], ['C', cx - r * 1.1, top - r * 0.5, cx + r * 1.1, top - r * 0.5, cx + r * 1.08, top + r * 0.7], ['Q', cx, top + r * 0.4, cx - r * 1.08, top + r * 0.7], ['Z']]))
        front.push(line(`${id}_ridge`, ink(c), [P(cx, top - r * 0.18), P(cx, top + r * 0.45)]))
        break
      }
      case 'bow': {
        const c = color ?? C('pink')
        const bx = cx + r * 0.55
        const by = top + r * 0.12
        front.push(poly(id, c, [P(bx, by), P(bx - r * 0.45, by - r * 0.3), P(bx - r * 0.45, by + r * 0.3)]))
        front.push(poly(`${id}2`, c, [P(bx, by), P(bx + r * 0.45, by - r * 0.3), P(bx + r * 0.45, by + r * 0.3)]))
        front.push(circle(`${id}_knot`, c, bx, by, r * 0.12))
        break
      }
      case 'flower': {
        const fx = cx + r * 0.6
        const fy = top + r * 0.25
        const c = color ?? C('pink')
        for (let i = 0; i < 5; i++) {
          const a = (i / 5) * Math.PI * 2
          front.push(circle(`${id}${i}`, c, fx + Math.cos(a) * r * 0.16, fy + Math.sin(a) * r * 0.16, r * 0.13))
        }
        front.push(circle(`${id}_c`, C('yellow'), fx, fy, r * 0.1))
        break
      }
      case 'glasses':
      case 'sunglasses': {
        const e = eyes(h)
        const gr = e.r * 1.9
        const c = color ?? C(w === 'sunglasses' ? 'black' : 'darkbrown')
        for (const [i, ex] of e.xs.entries()) {
          if (w === 'sunglasses') over.push(circle(`${id}${i}`, c, ex, e.y, gr, C('black')))
          else over.push({ id: `${id}${i}`, color: c, circle: [ex, e.y, gr] })
        }
        over.push(line(`${id}_bridge`, c, [P(e.xs[0] + gr, e.y), P(e.xs[1] - gr, e.y)], false))
        break
      }
      case 'eyepatch': {
        const e = eyes(h)
        over.push(line(`${id}_strap`, C('black'), [P(cx - r, e.y - r * 0.5), P(cx + r * 0.95, e.y + r * 0.1)], false))
        over.push(oval(id, C('black'), e.xs[1], e.y, e.r * 1.8, e.r * 1.5, C('black')))
        break
      }
      case 'mask': {
        const e = eyes(h)
        const c = color ?? C('black')
        over.push(rrect(id, c, e.xs[0] - e.r * 2.6, e.y - e.r * 1.6, e.xs[1] - e.xs[0] + e.r * 5.2, e.r * 3.2, e.r * 1.4))
        break
      }
      default:
        break
    }
  }
  return { back, front, over }
}
