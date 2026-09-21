import type { FxKind, Vec } from './types'
import { CRAYONS } from './colors'
import { mulberry32, type Rng } from './rng'
import type { CrayonBrush, LayerXform } from './brush'

interface Particle {
  kind: 'ray' | 'dot' | 'twinkle' | 'heart' | 'drop' | 'flame' | 'puff' | 'scribble'
  x: number
  y: number
  vx: number
  vy: number
  size: number
  color: string
  born: number
  ttl: number
  seed: number
  phase: number
  pts: Vec[] | null
}

const C = (n: string): string => CRAYONS[n] ?? '#2b2626'

function heartPts(cx: number, cy: number, s: number): Vec[] {
  const pts: Vec[] = []
  for (let i = 0; i <= 24; i++) {
    const t = (i / 24) * Math.PI * 2
    const x = 16 * Math.sin(t) ** 3
    const y = -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t))
    pts.push({ x: cx + (x / 16) * s, y: cy + (y / 16) * s })
  }
  return pts
}

function starPts(cx: number, cy: number, s: number): Vec[] {
  const pts: Vec[] = []
  for (let i = 0; i <= 10; i++) {
    const r = i % 2 === 0 ? s : s * 0.45
    const a = -Math.PI / 2 + (i * Math.PI) / 5
    pts.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r })
  }
  return pts
}

/** Short-lived crayon effects drawn immediate-mode on the main canvas. */
export class FxSystem {
  private particles: Particle[] = []
  private rng: Rng

  constructor(seed: number) {
    this.rng = mulberry32(seed ^ 0x5f3759df)
  }

  get active(): boolean {
    return this.particles.length > 0
  }

  spawn(kind: FxKind, x: number, y: number, size: number, now: number): void {
    const r = this.rng
    const add = (p: Omit<Particle, 'born' | 'seed'>): void => {
      this.particles.push({ ...p, born: now, seed: Math.floor(r() * 1e6) })
    }
    switch (kind) {
      case 'explode': {
        for (let i = 0; i < 14; i++) {
          const a = (i / 14) * Math.PI * 2 + r() * 0.3
          const sp = size * (0.8 + r() * 0.6)
          add({ kind: 'ray', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, size: size * 0.12, color: [C('orange'), C('yellow'), C('red')][i % 3] ?? C('orange'), ttl: 1.1, phase: r(), pts: null })
        }
        for (let i = 0; i < 10; i++) {
          const a = r() * Math.PI * 2
          const sp = size * (0.5 + r() * 1.2)
          add({ kind: 'dot', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - size * 0.4, size: size * (0.1 + r() * 0.12), color: [C('black'), C('gray'), C('orange')][i % 3] ?? C('gray'), ttl: 1.4, phase: r(), pts: null })
        }
        break
      }
      case 'poof':
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2
          add({ kind: 'puff', x, y, vx: Math.cos(a) * size * 0.9, vy: Math.sin(a) * size * 0.9, size: size * 0.35, color: i % 2 ? C('white') : C('silver'), ttl: 0.8, phase: r(), pts: null })
        }
        break
      case 'sparkle':
      case 'stars': {
        const n = kind === 'stars' ? 9 : 12
        for (let i = 0; i < n; i++) {
          add({
            kind: 'twinkle',
            x: x + (r() - 0.5) * size * 3,
            y: y + (r() - 0.5) * size * 2,
            vx: 0,
            vy: kind === 'stars' ? -size * 0.05 : 0,
            size: size * (kind === 'stars' ? 0.28 : 0.16) * (0.6 + r() * 0.8),
            color: kind === 'stars' ? C('yellow') : ([C('yellow'), C('white'), C('pink'), C('skyblue')][i % 4] ?? C('yellow')),
            ttl: kind === 'stars' ? 4 : 2.2,
            phase: r() * Math.PI * 2,
            pts: null,
          })
        }
        break
      }
      case 'hearts':
        for (let i = 0; i < 8; i++) {
          add({ kind: 'heart', x: x + (r() - 0.5) * size, y: y + (r() - 0.5) * size * 0.4, vx: (r() - 0.5) * size * 0.3, vy: -size * (0.5 + r() * 0.5), size: size * (0.18 + r() * 0.16), color: i % 3 === 0 ? C('pink') : C('red'), ttl: 2.4, phase: r() * 6, pts: null })
        }
        break
      case 'rain':
        for (let i = 0; i < 46; i++) {
          add({ kind: 'drop', x: x + (r() - 0.5) * size * 4, y: y - r() * 50, vx: -size * 0.1, vy: size * 4 + r() * size * 2, size: size * 0.14, color: C('blue'), ttl: 3.5 + r(), phase: r() * 2, pts: null })
        }
        break
      case 'fire':
        for (let i = 0; i < 9; i++) {
          add({ kind: 'flame', x: x + (r() - 0.5) * size * 0.9, y, vx: 0, vy: 0, size: size * (0.5 + r() * 0.6), color: [C('red'), C('orange'), C('yellow')][i % 3] ?? C('orange'), ttl: 3, phase: r() * 10, pts: null })
        }
        break
      case 'smoke':
        for (let i = 0; i < 9; i++) {
          add({ kind: 'puff', x: x + (r() - 0.5) * size * 0.5, y, vx: (r() - 0.5) * size * 0.2, vy: -size * (0.4 + r() * 0.4), size: size * (0.25 + r() * 0.2), color: i % 2 ? C('gray') : C('silver'), ttl: 3, phase: r(), pts: null })
        }
        break
    }
  }

  /** A quick gray scribble over a rectangle (used when an object is removed). */
  scribble(minX: number, minY: number, maxX: number, maxY: number, now: number): void {
    const pts: Vec[] = []
    const rows = Math.max(3, Math.ceil((maxY - minY) / 3))
    for (let i = 0; i <= rows; i++) {
      const y = minY + ((maxY - minY) * i) / rows + (this.rng() - 0.5) * 2
      pts.push(i % 2 === 0 ? { x: minX - 2, y } : { x: maxX + 2, y })
    }
    this.particles.push({ kind: 'scribble', x: 0, y: 0, vx: 0, vy: 0, size: 1.6, color: C('gray'), born: now, ttl: 1.1, seed: Math.floor(this.rng() * 1e6), phase: 0, pts })
  }

  draw(ctx: CanvasRenderingContext2D, brush: CrayonBrush, xform: LayerXform, now: number): void {
    const alive: Particle[] = []
    for (const p of this.particles) {
      const age = (now - p.born) / 1000
      if (age > p.ttl) continue
      alive.push(p)
      const life = age / p.ttl
      const fade = life < 0.75 ? 1 : 1 - (life - 0.75) / 0.25
      switch (p.kind) {
        case 'ray': {
          const len = Math.min(1, age * 2.2)
          const tail = Math.max(0, age * 2.2 - 0.6)
          brush.strokeWorld(ctx, [{ x: p.x + p.vx * tail, y: p.y + p.vy * tail }, { x: p.x + p.vx * len, y: p.y + p.vy * len }], p.color, p.size * 3, 0.9 * fade, xform, p.seed)
          break
        }
        case 'dot': {
          const x = p.x + p.vx * age
          const y = p.y + p.vy * age + 25 * age * age
          brush.strokeWorld(ctx, [{ x: x - p.size, y }, { x: x + p.size, y: y + 0.01 }], p.color, p.size * 1.5, 0.85 * fade, xform, p.seed)
          break
        }
        case 'twinkle': {
          const tw = 0.4 + 0.6 * Math.abs(Math.sin(age * 6 + p.phase))
          brush.strokeWorld(ctx, starPts(p.x, p.y + p.vy * age * 10, p.size * tw), p.color, 0.9, 0.9 * fade * tw, xform, p.seed)
          break
        }
        case 'heart': {
          const x = p.x + p.vx * age + Math.sin(age * 3 + p.phase) * 1.5
          const y = p.y + p.vy * age
          brush.strokeWorld(ctx, heartPts(x, y, p.size), p.color, 1.1, 0.9 * fade, xform, p.seed)
          break
        }
        case 'drop': {
          const t = (age + p.phase) % 1.4
          const x = p.x + p.vx * t * 10
          const y = p.y + p.vy * t
          if (y < 84) brush.strokeWorld(ctx, [{ x, y }, { x: x - 0.4, y: y + 2.2 }], p.color, p.size * 4, 0.8 * fade, xform, p.seed)
          break
        }
        case 'flame': {
          const flick = 0.75 + 0.25 * Math.sin(age * 9 + p.phase)
          const h = p.size * flick
          const w = p.size * 0.45
          const sway = Math.sin(age * 5 + p.phase) * w * 0.4
          brush.strokeWorld(ctx, [{ x: p.x - w, y: p.y }, { x: p.x + sway, y: p.y - h }, { x: p.x + w, y: p.y }, { x: p.x - w, y: p.y }], p.color, 1.3, 0.85 * fade, xform, p.seed)
          break
        }
        case 'puff': {
          const x = p.x + p.vx * age
          const y = p.y + p.vy * age
          const rad = p.size * (0.6 + age * 0.8)
          const ring: Vec[] = []
          for (let i = 0; i <= 14; i++) {
            const a = (i / 14) * Math.PI * 2
            ring.push({ x: x + Math.cos(a) * rad, y: y + Math.sin(a) * rad * 0.85 })
          }
          brush.strokeWorld(ctx, ring, p.color, 1.4, 0.7 * fade, xform, p.seed)
          break
        }
        case 'scribble': {
          if (!p.pts) break
          const n = Math.max(2, Math.ceil(p.pts.length * Math.min(1, age * 3)))
          brush.strokeWorld(ctx, p.pts.slice(0, n), p.color, p.size, 0.8 * fade, xform, p.seed)
          break
        }
      }
    }
    this.particles = alive
  }
}
