/**
 * The sketch dialect (prototype): the model draws every entity as an SVG icon in its own 100x100
 * box (y down, feet at y=100, centered on x=50) and places the box on the paper with `ent id x [y]
 * h=<size>`. One color per shape (the fill; the outline is derived), smooth primitives (blob, curve,
 * rounded rect, full SVG paths with arcs), pattern fills, one-line backdrops. Everything becomes
 * the JSON dialect's operations, so verbs, timing and the engine are shared with `ops`.
 *
 *   bg <sky> [<ground>]
 *   ent <id> <x> [<y>] h=<size> ["name"] [float|sway|still] [back|far]
 *   <id>.<part> <color> [hollow] [mirror] [stripes|spots|dots[=<color>]] [ink=<color>] [w=<n>] <geometry>
 *     circle cx cy r | oval cx cy rx ry | rect x y w h [r] | blob x y x y .. | poly x y .. |
 *     curve x y x y .. | stamp <name> x y size | M .. (SVG path: M L H V Q T C S A Z, relative too)
 *   face / move / pose / recolor / fx / rm / say / scene / skip   (as in ops, paper coordinates)
 */
import type { Scene } from '~/engine/scene'
import { isStampName } from '~/engine/stamps'
import { hashString, mulberry32 } from '~/engine/rng'
import { faceShapes } from '~/engine/face'
import { GROUND_Y, WORLD_W, type Command, type Shape } from '~/engine/types'
import type { DialectInput, DialectOptions, DialectParse } from '~/llm/dialect'
import { JsonDialect, OPS_VOCAB, type PathCmd } from '~/llm/json-dsl'
import { parseOpsLine } from '~/llm/ops-dsl'
import type { PromptBlock } from '~/llm/providers'
import type { Dialect } from '~/llm/dialect'
import {
  blobPath,
  bounds,
  clipBand,
  curvePath,
  mapGeo,
  pointInPoly,
  polyPath,
  rectPath,
  sampleGeo,
  svgPath,
  type Geo,
  type Pt,
} from './geom'
import { inkFor, isSketchColor, sketchColor, sketchColorName } from './palette'
import { buildSketchUserBlocks, SKETCH_SYSTEM_PROMPT, SKETCH_SYSTEM_PROMPT_UNMODERATED } from './prompt'

/* ---------- tokens ---------- */

interface Tok {
  text: string
  quoted: boolean
}

function tokenize(line: string): Tok[] {
  const out: Tok[] = []
  const re = /"([^"]*)"|(\S+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(line)) !== null) {
    if (m[1] !== undefined) out.push({ text: m[1], quoted: true })
    else if (m[2] !== undefined) out.push({ text: m[2], quoted: false })
  }
  return out
}

const NUM_RE = /^[-+]?(\d+\.?\d*|\.\d+)$/
const isNum = (t: Tok): boolean => !t.quoted && NUM_RE.test(t.text)
const isKv = (t: Tok): boolean => !t.quoted && /^[a-z]+=/i.test(t.text)
function splitKv(t: Tok): [string, string] {
  const i = t.text.indexOf('=')
  return [t.text.slice(0, i).toLowerCase(), t.text.slice(i + 1)]
}
function num(v: string, what: string): number {
  const n = Number(v)
  if (!Number.isFinite(n)) throw new Error(`${what} needs a number, got "${v}"`)
  return n
}

/* ---------- backdrops ---------- */

export const SKIES: Record<string, string> = {
  day: '#c4e4f7',
  sunset: '#ffd2a6',
  dawn: '#fde0e3',
  night: '#2b3a6b',
  storm: '#9eaab6',
  indoor: '#fbe9cc',
  space: '#1d2248',
  underwater: '#86cbe9',
  paper: '#faf5ec',
}

interface GroundArt {
  fill: string
  base: string
  mark: string | null
  markColor: string
}

/** Ground art in paper-local units around (600, 525). The water surface sits at y=465. */
const GROUNDS: Record<string, GroundArt> = {
  grass: {
    fill: '#6cc24a',
    base: 'M -620 4 Q -470 -14 -320 2 T -20 0 T 280 2 T 620 -2 L 620 100 L -620 100 Z',
    mark: 'M -500 40 L -492 22 L -484 40 M -300 70 L -292 52 L -284 70 M -90 36 L -82 18 L -74 36 M 150 64 L 158 46 L 166 64 M 380 34 L 388 16 L 396 34 M 520 72 L 528 54 L 536 72',
    markColor: '#2f7d3b',
  },
  sand: {
    fill: '#efd9a2',
    base: 'M -620 6 Q -420 -10 -200 4 T 250 2 T 620 0 L 620 100 L -620 100 Z',
    mark: 'M -480 40 L -474 40 M -260 66 L -254 66 M -30 34 L -24 34 M 200 60 L 206 60 M 420 38 L 426 38',
    markColor: '#b58a4a',
  },
  water: {
    fill: '#63b5ec',
    base: 'M -620 -60 Q -540 -72 -460 -60 T -300 -60 T -140 -60 T 20 -60 T 180 -60 T 340 -60 T 500 -60 T 660 -60 L 620 100 L -620 100 Z',
    mark: 'M -440 -10 Q -410 -22 -380 -10 M -120 30 Q -90 18 -60 30 M 220 -8 Q 250 -20 280 -8 M 460 40 Q 490 28 520 40',
    markColor: '#2f6fd6',
  },
  snow: {
    fill: '#ffffff',
    base: 'M -620 8 Q -460 -16 -300 4 T 20 2 T 340 -4 T 620 4 L 620 100 L -620 100 Z',
    mark: null,
    markColor: '#9fb8cf',
  },
  floor: {
    fill: '#d9b27c',
    base: 'M -620 0 L 620 0 L 620 100 L -620 100 Z',
    mark: 'M -620 34 L 620 34 M -620 68 L 620 68 M -300 0 L -300 34 M 200 0 L 200 34 M -80 34 L -80 68 M 420 34 L 420 68',
    markColor: '#8a5a33',
  },
  road: {
    fill: '#9a9a9a',
    base: 'M -620 0 L 620 0 L 620 100 L -620 100 Z',
    mark: 'M -560 50 L -460 50 M -340 50 L -240 50 M -120 50 L -20 50 M 100 50 L 200 50 M 320 50 L 420 50 M 540 50 L 620 50',
    markColor: '#fdfcf8',
  },
  moon: {
    fill: '#c9ccd2',
    base: 'M -620 6 Q -420 -18 -180 4 T 300 0 T 620 6 L 620 100 L -620 100 Z',
    mark: 'M -420 40 Q -380 26 -340 40 Q -380 52 -420 40 M 120 60 Q 170 44 220 60 Q 170 74 120 60',
    markColor: '#8b8b8b',
  },
  dirt: {
    fill: '#9a6440',
    base: 'M -620 4 Q -420 -12 -220 4 T 200 2 T 620 0 L 620 100 L -620 100 Z',
    mark: null,
    markColor: '#5e3a22',
  },
}

const SKY_NAMES = Object.keys(SKIES)
const GROUND_NAMES = [...Object.keys(GROUNDS), 'none']

/* ---------- parts ---------- */

type Pattern = { kind: 'stripes' | 'spots' | 'dots'; color: string | null }

interface PartSpec {
  id: string
  color: string
  hollow: boolean
  mirror: boolean
  ink: string | null
  pattern: Pattern | null
  /** box units; ribbon width for open curves */
  w: number | null
  geo: Geo | { k: 'stamp'; name: string; x: number; y: number; size: number }
}

interface EntInfo {
  h: number
  parts: Map<string, PartSpec>
  /** Only the backdrop's ground entity. */
  groundName?: string
}

/** Paper -> world scale (the JSON dialect's K). */
const WK = WORLD_W / 1200
const f2 = (n: number): string => (Math.round(n * 100) / 100).toString()

/** Paper-local path commands -> an engine path string in world units. */
function cmdsToWorldSvg(cmds: PathCmd[]): string {
  return cmds
    .map((c) => {
      switch (c[0]) {
        case 'M':
        case 'L':
          return `${c[0]} ${f2(c[1] * WK)} ${f2(c[2] * WK)}`
        case 'Q':
          return `Q ${f2(c[1] * WK)} ${f2(c[2] * WK)} ${f2(c[3] * WK)} ${f2(c[4] * WK)}`
        case 'C':
          return `C ${f2(c[1] * WK)} ${f2(c[2] * WK)} ${f2(c[3] * WK)} ${f2(c[4] * WK)} ${f2(c[5] * WK)} ${f2(c[6] * WK)}`
        case 'Z':
          return 'Z'
      }
    })
    .join(' ')
}

const PATTERNS = ['stripes', 'spots', 'dots'] as const
const isPattern = (s: string): s is Pattern['kind'] => (PATTERNS as readonly string[]).includes(s)

function isLight(hex: string): boolean {
  const n = Number.parseInt(hex.slice(1), 16)
  const r = (n >> 16) & 255
  const g = (n >> 8) & 255
  const b = n & 255
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.62
}

/** An open polyline as a closed tapered ribbon (thick crayon line) of width w. */
function ribbon(g: Geo, w: number): Geo {
  const pts = sampleGeo(g)
  if (pts.length < 2) return g
  // resample to <= 16 points
  const step = Math.max(1, Math.floor(pts.length / 16))
  const p: Pt[] = []
  for (let i = 0; i < pts.length; i += step) {
    const q = pts[i]
    if (q) p.push(q)
  }
  const last = pts[pts.length - 1]
  if (last && p[p.length - 1] !== last) p.push(last)
  const left: Pt[] = []
  const right: Pt[] = []
  for (let i = 0; i < p.length; i++) {
    const a = p[Math.max(0, i - 1)] ?? { x: 0, y: 0 }
    const b = p[Math.min(p.length - 1, i + 1)] ?? { x: 0, y: 0 }
    const dx = b.x - a.x
    const dy = b.y - a.y
    const len = Math.hypot(dx, dy) || 1
    const t = i / (p.length - 1)
    const taper = 0.55 + 0.45 * Math.sin(Math.PI * Math.min(1, 0.15 + t * 0.85))
    const hw = (w / 2) * taper
    const c = p[i] ?? { x: 0, y: 0 }
    left.push({ x: c.x - (dy / len) * hw, y: c.y + (dx / len) * hw })
    right.push({ x: c.x + (dy / len) * hw, y: c.y - (dx / len) * hw })
  }
  const nums: number[] = []
  for (const q of [...left, ...right.reverse()]) nums.push(q.x, q.y)
  return polyPath(nums)
}

/** Pattern pieces inside a closed geometry, in box units. Deterministic per part id. */
function patternPieces(geo: Geo, pattern: Pattern, seedKey: string): Geo[] {
  const poly = sampleGeo(geo)
  if (poly.length < 3) return []
  const b = bounds(poly)
  const w = b.maxX - b.minX
  const h = b.maxY - b.minY
  const out: Geo[] = []
  if (pattern.kind === 'stripes') {
    // Bands run across the short side: a tall shirt gets horizontal stripes, a wide tiger vertical ones.
    const vertical = w > h
    const src = vertical ? poly.map((q) => ({ x: q.y, y: q.x })) : poly
    const lo = vertical ? b.minX : b.minY
    const span = vertical ? w : h
    const period = Math.max(3, span / 6)
    for (let c = lo + period * 0.5; c < lo + span; c += period * 2) {
      const piece = clipBand(src, c, c + period, 0)
      if (piece.length >= 3) {
        const nums: number[] = []
        for (const q of piece) nums.push(vertical ? q.y : q.x, vertical ? q.x : q.y)
        out.push(polyPath(nums))
      }
    }
    return out
  }
  const rng = mulberry32(hashString(seedKey))
  const r = pattern.kind === 'spots' ? Math.min(w, h) * 0.13 : Math.min(w, h) * 0.055
  const want = pattern.kind === 'spots' ? 5 : 9
  const placed: Pt[] = []
  for (let tries = 0; tries < 80 && placed.length < want; tries++) {
    const c = { x: b.minX + rng() * w, y: b.minY + rng() * h }
    const rim = [0, 1, 2, 3, 4, 5, 6, 7].map((k) => ({
      x: c.x + Math.cos((k * Math.PI) / 4) * r * 1.15,
      y: c.y + Math.sin((k * Math.PI) / 4) * r * 1.15,
    }))
    if (!pointInPoly(c, poly) || !rim.every((q) => pointInPoly(q, poly))) continue
    if (placed.some((q) => Math.hypot(q.x - c.x, q.y - c.y) < r * 2.6)) continue
    placed.push(c)
    const rr = pattern.kind === 'spots' ? r * (0.75 + rng() * 0.5) : r
    out.push(pattern.kind === 'spots' ? { k: 'oval', cx: c.x, cy: c.y, rx: rr * 1.15, ry: rr * 0.9 } : { k: 'circle', cx: c.x, cy: c.y, r: rr })
  }
  return out
}

const r2 = (n: number): number => Math.round(n * 100) / 100

function pathNums(cmds: PathCmd[]): PathCmd[] {
  return cmds.map((c): PathCmd => {
    switch (c[0]) {
      case 'M':
      case 'L':
        return [c[0], r2(c[1]), r2(c[2])]
      case 'Q':
        return ['Q', r2(c[1]), r2(c[2]), r2(c[3]), r2(c[4])]
      case 'C':
        return ['C', r2(c[1]), r2(c[2]), r2(c[3]), r2(c[4]), r2(c[5]), r2(c[6])]
      case 'Z':
        return c
    }
  })
}

/** A canonical paper-local geometry as the JSON shape fields. */
function geoFields(g: Geo): Record<string, unknown> {
  if (g.k === 'circle') return { circle: [r2(g.cx), r2(g.cy), r2(g.r)] }
  if (g.k === 'oval') return { oval: [r2(g.cx), r2(g.cy), r2(g.rx), r2(g.ry)] }
  return { path: pathNums(g.cmds) }
}

/* ---------- the dialect ---------- */

export class SketchDialect implements Dialect {
  readonly id = 'sketch'
  readonly system: string
  readonly maxTokens = 1600
  private inner: JsonDialect
  private ents = new Map<string, EntInfo>()

  constructor(
    private scene: Scene,
    opts: DialectOptions
  ) {
    this.inner = new JsonDialect(scene, opts)
    this.system = opts.moderation ? SKETCH_SYSTEM_PROMPT : SKETCH_SYSTEM_PROMPT_UNMODERATED
  }

  get later(): ((cmds: Command[]) => void) | null {
    return this.inner.later
  }
  set later(fn: ((cmds: Command[]) => void) | null) {
    this.inner.later = fn
  }

  buildUser(input: DialectInput): PromptBlock[] {
    return buildSketchUserBlocks({ storyChunks: input.storyChunks, scene: this.describe(), newWords: input.newWords })
  }

  isSkip(line: string): boolean {
    return /^skip\b/i.test(line.trim())
  }

  reset(): void {
    this.inner.reset()
    this.ents.clear()
  }

  parse(raw: string): DialectParse {
    const line = raw
      .trim()
      .replace(/^```\w*/, '')
      .replace(/```$/, '')
      .replace(/^draw\s+/i, '')
      .trim()
    if (!line || line.startsWith('#') || line.startsWith('//')) return { ok: true, cmds: [] }
    const toks = tokenize(line)
    const head = toks[0]
    if (!head) return { ok: true, cmds: [] }
    try {
      const verb = head.text.toLowerCase()
      if (!head.quoted && /^[a-z][a-z0-9_-]*\.[a-z0-9_-]+$/i.test(head.text)) return this.draw(head.text, toks.slice(1))
      if (verb === 'ent' || verb === 'entity') return this.ent(toks.slice(1))
      if (verb === 'bg' || verb === 'backdrop') return this.backdrop(toks.slice(1))
      if (verb === 'recolor' || verb === 'color') return this.recolor(toks.slice(1))
      if (verb === 'line') return this.paperLine(toks.slice(1))
      if (verb === 'turn' || verb === 'flip') {
        const id = toks[1]?.text ?? ''
        if (!this.scene.objects.has(id)) throw new Error(`turn: no entity "${id}"`)
        return { ok: true, cmds: [{ k: 'flip', id }] }
      }
      // Everything else is the ops grammar in paper coordinates; map sketch color names to hex first.
      // face bunny.head / face bunny bunny.head -> face bunny head
      if (verb === 'face') {
        const first = toks[1]
        if (first && first.text.includes('.')) {
          const [eid = '', part = 'head'] = first.text.split('.')
          toks.splice(1, 1, { text: eid, quoted: false }, { text: part, quoted: false })
        }
        const eid = toks[1]?.text ?? ''
        for (const t of toks.slice(2)) if (t.text.startsWith(`${eid}.`)) t.text = t.text.slice(eid.length + 1)
        const sleepyAt = toks.findIndex((t) => /^(sleepy|asleep|sleeping|sleep)$/i.test(t.text))
        if (sleepyAt > 1) {
          const rest = toks.slice(2).filter((_, i) => i + 2 !== sleepyAt)
          const headTok = rest.find((t) => !/^(front|left|right|happy|surprised|sad)$/i.test(t.text))
          const facing = rest.find((t) => /^(front|left|right)$/i.test(t.text))?.text.toLowerCase()
          return this.sleepyFace(eid, headTok?.text ?? 'head', facing === 'left' || facing === 'front' ? facing : 'right')
        }
      }
      // A move shorter than the contract allows is still a move.
      if (verb === 'move' || verb === 'mv') {
        const secs = toks[4]
        if (secs && isNum(secs) && Number(secs.text) < 0.2) secs.text = '0.2'
      }
      const mapped = toks
        .map((t) => (t.quoted ? `"${t.text}"` : isSketchColor(t.text) && !NUM_RE.test(t.text) && verb !== 'say' ? sketchColor(t.text) : t.text))
        .join(' ')
      const res = parseOpsLine(mapped)
      if (!res.ok) return res
      if (res.op === null) return { ok: true, cmds: [] }
      return this.inner.applyRaw(res.op, line)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      return { ok: false, error: `${msg} in ${line.slice(0, 80)}` }
    }
  }

  /* ----- ent ----- */

  private ent(rest: Tok[]): DialectParse {
    const idTok = rest[0]
    if (!idTok || idTok.quoted || isNum(idTok)) throw new Error('ent needs: ent <id> <x> [<y>] h=<size>')
    const id = idTok.text
    const x = rest[1]
    if (!x || !isNum(x)) throw new Error('ent needs: ent <id> <x> [<y>] h=<size>')
    let i = 2
    let y = 525
    const yTok = rest[2]
    if (yTok && isNum(yTok)) {
      y = Number(yTok.text)
      i = 3
    }
    let h = 200
    let idle: (typeof OPS_VOCAB.idle)[number] | null = null
    let layer: number | null = null
    const nameWords: string[] = []
    for (const t of rest.slice(i)) {
      const w = t.text.toLowerCase()
      if (t.quoted) nameWords.push(t.text)
      else if (isKv(t)) {
        const [k, v] = splitKv(t)
        if (k === 'h' || k === 'size') h = num(v, 'h')
        else if (k === 'idle') idle = w.endsWith('float') ? 'float' : w.endsWith('sway') ? 'sway' : w.endsWith('none') ? 'none' : 'breathe'
        else if (k === 'layer') layer = Math.round(num(v, 'layer'))
        else throw new Error(`ent: unknown option ${k}`)
      } else if (w === 'float' || w === 'sway' || w === 'breathe') idle = w
      else if (w === 'still') idle = 'none'
      else if (w === 'back') layer = -1
      else if (w === 'far') layer = -3
      else if (isNum(t) && h === 200) h = Number(t.text)
      else nameWords.push(t.text)
    }
    h = Math.max(10, Math.min(900, h))
    const lay = layer ?? 0
    if (this.scene.objects.has(id)) return { ok: true, cmds: [] }
    this.ents.set(id, { h, parts: new Map() })
    return this.inner.applyRaw(
      {
        op: 'entity',
        id,
        x: Number(x.text),
        y,
        name: nameWords.length ? nameWords.join(' ') : id,
        idle: idle ?? (lay < 0 ? 'none' : 'breathe'),
        layer: lay,
      },
      `ent ${id}`
    )
  }

  /* ----- draw ----- */

  private draw(target: string, rest: Tok[]): DialectParse {
    const dot = target.indexOf('.')
    const entity = target.slice(0, dot)
    const part = target.slice(dot + 1)
    const info = this.ents.get(entity)
    if (!info || !this.scene.objects.has(entity)) throw new Error(`no entity "${entity}" on this page (ent it first)`)
    const colorTok = rest[0]
    if (!colorTok || !isSketchColor(colorTok.text)) throw new Error(`${target} needs a color first`)
    const spec: PartSpec = {
      id: part,
      color: sketchColor(colorTok.text),
      hollow: false,
      mirror: false,
      ink: null,
      pattern: null,
      w: null,
      geo: { k: 'circle', cx: 50, cy: 50, r: 10 },
    }
    let i = 1
    for (; i < rest.length; i++) {
      const t = rest[i]
      if (!t) break
      const w = t.text.toLowerCase()
      if (w === 'hollow' || w === 'line') spec.hollow = true
      else if (w === 'mirror') spec.mirror = true
      else if (isPattern(w)) spec.pattern = { kind: w, color: null }
      else if (isKv(t)) {
        const [k, v] = splitKv(t)
        if (isPattern(k)) {
          if (!isSketchColor(v)) throw new Error(`${k}= needs a color`)
          spec.pattern = { kind: k, color: sketchColor(v) }
        } else if (k === 'ink' || k === 'outline') {
          if (!isSketchColor(v)) throw new Error('ink= needs a color')
          spec.ink = sketchColor(v)
        } else if (k === 'w' || k === 'width') spec.w = num(v, 'w')
        else throw new Error(`unknown option ${k}`)
      } else break
    }
    // Options are legal after the shape word too (models write "curve w=7 ...").
    const geomToks: Tok[] = []
    for (const t of rest.slice(i)) {
      if (!isKv(t)) {
        geomToks.push(t)
        continue
      }
      const [k, v] = splitKv(t)
      if (k === 'w' || k === 'width') spec.w = num(v, 'w')
      else if (isPattern(k) && isSketchColor(v)) spec.pattern = { kind: k, color: sketchColor(v) }
      else if ((k === 'ink' || k === 'outline') && isSketchColor(v)) spec.ink = sketchColor(v)
      else throw new Error(`unknown option ${k}`)
    }
    spec.geo = this.geometry(geomToks)
    info.parts.set(part, spec)
    return this.emit(entity, info, spec)
  }

  private geometry(rest: Tok[]): PartSpec['geo'] {
    const g = rest[0]
    if (!g) throw new Error('needs a geometry: circle, oval, rect, blob, poly, curve, stamp or an M.. path')
    const w = g.text.toLowerCase()
    const nums = (from: number): number[] => {
      const out: number[] = []
      for (const t of rest.slice(from)) {
        if (/^z$/i.test(t.text)) continue
        const parts = t.text.split(',').filter(Boolean)
        for (const p of parts) {
          if (!NUM_RE.test(p)) throw new Error(`${w} takes only numbers, got "${t.text}"`)
          out.push(Number(p))
        }
      }
      return out
    }
    const need = (xs: number[], n: number, what: string): number[] => {
      if (xs.length < n) throw new Error(`${what}`)
      return xs
    }
    switch (w) {
      case 'circle': {
        const [cx = 0, cy = 0, r = 0] = need(nums(1), 3, 'circle cx cy r')
        return { k: 'circle', cx, cy, r }
      }
      case 'oval':
      case 'ellipse': {
        const [cx = 0, cy = 0, rx = 0, ry = 0] = need(nums(1), 4, 'oval cx cy rx ry')
        return { k: 'oval', cx, cy, rx, ry }
      }
      case 'rect': {
        const xs = need(nums(1), 4, 'rect x y w h [r]')
        const [x = 0, y = 0, rw = 0, rh = 0] = xs
        return rectPath(x, y, rw, rh, xs[4])
      }
      case 'blob': {
        const xs = nums(1)
        if (xs.length < 6 || xs.length % 2) throw new Error('blob needs 3+ x y points')
        return blobPath(xs)
      }
      case 'poly': {
        const xs = nums(1)
        if (xs.length < 6 || xs.length % 2) throw new Error('poly needs 3+ x y points')
        return polyPath(xs)
      }
      case 'curve': {
        const xs = nums(1)
        if (xs.length < 4 || xs.length % 2) throw new Error('curve needs 2+ x y points')
        return curvePath(xs)
      }
      case 'stamp': {
        const name = rest[1]?.text.toLowerCase() ?? ''
        if (!isStampName(name)) throw new Error(`stamp needs sun|moon|cloud|star|heart, got "${name}"`)
        const [x = 50, y = 50, size = 20] = need(nums(2), 3, 'stamp name x y size')
        return { k: 'stamp', name, x, y, size }
      }
      default:
        if (/^[Mm]/.test(g.text)) return svgPath(rest.map((t) => t.text).join(' '))
        throw new Error(`unknown geometry "${g.text}"`)
    }
  }

  /** Draw ops for one part (plus its pattern pieces), in paper-local units. */
  private emit(entity: string, info: EntInfo, spec: PartSpec): DialectParse {
    const k = info.h / 100
    const f = (p: Pt): Pt => ({ x: (p.x - 50) * k, y: (p.y - 100) * k })
    const ops: Record<string, unknown>[] = []
    const geo = spec.geo
    if (geo.k === 'stamp') {
      ops.push({
        op: 'draw',
        shape: {
          id: spec.id,
          entity,
          color: spec.ink ?? inkFor(spec.color),
          fill: spec.color,
          mirror: spec.mirror || undefined,
          stamp: { name: geo.name, x: r2((geo.x - 50) * k), y: r2((geo.y - 100) * k), size: Math.max(2, r2(geo.size * k)) },
        },
      })
    } else {
      const open = geo.k === 'path' && !geo.closed
      let boxGeo: Geo = geo
      let filled = !spec.hollow
      let ink = spec.ink ?? inkFor(spec.color)
      if (open) {
        const w = spec.w ?? 0
        if (w > 0) {
          boxGeo = ribbon(geo, w)
          filled = true
        } else {
          filled = false
          ink = spec.color
        }
      }
      const paper = mapGeo(boxGeo, f, k)
      const shape: Record<string, unknown> = { id: spec.id, entity, color: filled ? ink : (spec.ink ?? spec.color), ...geoFields(paper) }
      if (filled) shape.fill = spec.color
      if (spec.mirror) shape.mirror = true
      ops.push({ op: 'draw', shape })
      const closed = boxGeo.k !== 'path' || boxGeo.closed
      if (spec.pattern && filled && closed) {
        const pc = spec.pattern.color ?? (isLight(spec.color) ? inkFor(spec.color) : '#fdfcf8')
        const pieces = patternPieces(boxGeo, spec.pattern, `${entity}.${spec.id}`)
        pieces.forEach((pg, n) => {
          const s: Record<string, unknown> = { id: `${spec.id}_p${n}`, entity, color: pc, fill: pc, ...geoFields(mapGeo(pg, f, k)) }
          if (spec.mirror) s.mirror = true
          ops.push({ op: 'draw', shape: s })
        })
      }
    }
    const cmds: Command[] = []
    for (const op of ops) {
      const res = this.inner.applyRaw(op, `${entity}.${spec.id}`)
      if (!res.ok) return res
      cmds.push(...res.cmds)
    }
    return { ok: true, cmds: compactResets(cmds) }
  }

  /* ----- a line between paper points (kite string, leash, rope) ----- */

  private paperLine(rest: Tok[]): DialectParse {
    const idTok = rest[0]
    const colorTok = rest[1]
    if (!idTok || idTok.quoted || !colorTok || !isSketchColor(colorTok.text))
      throw new Error('line needs: line <id> <color> x y x y ...')
    const xs = rest.slice(2).map((t) => {
      if (!isNum(t)) throw new Error(`line takes paper points, got "${t.text}"`)
      return Number(t.text)
    })
    if (xs.length < 4 || xs.length % 2) throw new Error('line needs 2+ paper points')
    const id = idTok.text
    // Paper points relative to the (600, 525) anchor, as numbers of a 100-box of size 100.
    const rel: number[] = []
    for (let i = 0; i + 1 < xs.length; i += 2) rel.push((xs[i] ?? 0) - 600 + 50, (xs[i + 1] ?? 0) - 525 + 100)
    const color = sketchColor(colorTok.text)
    const geo = curvePath(rel)
    const spec: PartSpec = { id: 'line', color, hollow: false, mirror: false, ink: null, pattern: null, w: null, geo }
    if (this.scene.objects.has(id)) {
      const info = this.ents.get(id)
      if (!info) throw new Error(`line: "${id}" is not a line`)
      info.parts.set('line', spec)
      return this.emit(id, info, spec)
    }
    const res = this.inner.applyRaw({ op: 'entity', id, x: 600, y: 525, name: id, idle: 'none', layer: 0 }, `line ${id}`)
    if (!res.ok) return res
    this.ents.set(id, { h: 100, parts: new Map([['line', spec]]) })
    // The entity is not in the Scene yet, so its shape rides inside the same obj block.
    const paper = mapGeo(geo, (p) => ({ x: p.x - 50, y: p.y - 100 }), 1)
    if (paper.k !== 'path') throw new Error('line: bad geometry')
    const shape: Shape = { k: 'path', d: cmdsToWorldSvg(paper.cmds), color, fill: false }
    const cmds = [...res.cmds]
    const end = cmds.findIndex((c) => c.k === 'end')
    cmds.splice(end < 0 ? cmds.length : end, 0, { k: 'shape', shape })
    return { ok: true, cmds }
  }

  /* ----- a sleeping face: closed eyes, small smile ----- */

  private sleepyFace(entity: string, head: string, facing: 'front' | 'left' | 'right'): DialectParse {
    const info = this.ents.get(entity)
    const spec = info?.parts.get(head)
    if (!info || !spec || spec.geo.k === 'stamp') throw new Error(`face: no head "${head}" in "${entity}"`)
    const k = info.h / 100
    const paper = mapGeo(spec.geo, (p) => ({ x: (p.x - 50) * k, y: (p.y - 100) * k }), k)
    // The head in world units, the way the JSON dialect hands it to faceShapes.
    const world: Shape =
      paper.k === 'circle'
        ? { k: 'circle', cx: paper.cx * WK, cy: paper.cy * WK, r: paper.r * WK, color: '#000000', fill: true }
        : paper.k === 'oval'
          ? { k: 'ellipse', cx: paper.cx * WK, cy: paper.cy * WK, rx: paper.rx * WK, ry: paper.ry * WK, color: '#000000', fill: true }
          : { k: 'path', d: cmdsToWorldSvg(paper.cmds), color: '#000000', fill: true }
    const ink = spec.ink ?? inkFor(spec.color)
    const ops: Record<string, unknown>[] = []
    for (const part of faceShapes(head, world, facing, 'happy', ink)) {
      const sh = part.shape
      const known = this.inner.snapshotData().entities.find((e) => e.id === entity)?.shapes.some((x) => x.id === part.id) ?? false
      if (/_eye\d+(w|_pupil)$/.test(part.id)) {
        // No open eye under a closed one: blank the white and the pupil if they were drawn before.
        if (known && sh.k === 'circle')
          ops.push({ op: 'draw', shape: { id: part.id, entity, color: spec.color, circle: [r2(sh.cx / WK), r2(sh.cy / WK), 0.01] } })
        continue
      }
      if (sh.k === 'circle') {
        const cx = sh.cx / WK
        const cy = sh.cy / WK
        const r = (sh.r / WK) * 1.1
        ops.push({ op: 'draw', shape: { id: part.id, entity, color: ink, path: [['M', r2(cx - r), r2(cy)], ['Q', r2(cx), r2(cy + r * 1.1), r2(cx + r), r2(cy)]] } })
      } else if (sh.k === 'path') {
        const g = svgPath(sh.d)
        const m = mapGeo(g, (p) => ({ x: p.x / WK, y: p.y / WK }), 1 / WK)
        if (m.k === 'path') ops.push({ op: 'draw', shape: { id: part.id, entity, color: ink, path: pathNums(m.cmds) } })
      }
    }
    const cmds: Command[] = []
    for (const op of ops) {
      const res = this.inner.applyRaw(op, `face ${entity} sleepy`)
      if (!res.ok) return res
      cmds.push(...res.cmds)
    }
    return { ok: true, cmds: compactResets(cmds) }
  }

  /* ----- recolor ----- */

  private recolor(rest: Tok[]): DialectParse {
    const idTok = rest[0]
    const a = rest[1]
    const b = rest[2]
    const info = idTok ? this.ents.get(idTok.text) : undefined
    // recolor <id> <part> <to>: one part (models reach for this naturally)
    const onePart = info && a ? info.parts.get(a.text) : undefined
    if (idTok && info && onePart && b && isSketchColor(b.text)) {
      onePart.color = sketchColor(b.text)
      return this.emit(idTok.text, info, onePart)
    }
    if (!idTok || !a || !isSketchColor(a.text)) throw new Error('recolor needs: recolor <id> [<from>|<part>] <to>')
    if (!info) throw new Error(`recolor: no entity "${idTok.text}"`)
    const from = b && isSketchColor(b.text) ? sketchColor(a.text).toLowerCase() : null
    const to = sketchColor(b && isSketchColor(b.text) ? b.text : a.text)
    const cmds: Command[] = []
    for (const spec of info.parts.values()) {
      const hit = from ? spec.color.toLowerCase() === from : isLight(spec.color)
      if (!hit) continue
      spec.color = to
      const res = this.emit(idTok.text, info, spec)
      if (!res.ok) return res
      cmds.push(...res.cmds)
    }
    return { ok: true, cmds: compactResets(cmds) }
  }

  /* ----- backdrop ----- */

  private backdrop(rest: Tok[]): DialectParse {
    const skyWord = rest[0]?.text.toLowerCase() ?? 'day'
    const sky = SKIES[skyWord] ?? (isSketchColor(skyWord) ? sketchColor(skyWord) : null)
    if (!sky) throw new Error(`bg sky must be one of ${SKY_NAMES.join('|')}`)
    const groundWord = rest[1]?.text.toLowerCase() ?? 'none'
    if (!GROUND_NAMES.includes(groundWord)) throw new Error(`bg ground must be one of ${GROUND_NAMES.join('|')}`)
    const cmds: Command[] = []
    const push = (op: Record<string, unknown>): void => {
      const res = this.inner.applyRaw(op, 'bg')
      if (!res.ok) throw new Error(res.error)
      cmds.push(...res.cmds)
    }
    push({ op: 'scene', background: sky })
    const art = GROUNDS[groundWord]
    if (art) {
      // The ground belongs to this dialect alone (the JSON dialect never sees it), so one line can
      // create and paint it: engine shapes in world units around the ground anchor.
      const d = (text: string): string => {
        const g = svgPath(text)
        return g.k === 'path' ? cmdsToWorldSvg(g.cmds) : ''
      }
      const base = d(art.base)
      const shapes: Shape[] = [
        { k: 'path', d: base, color: art.fill, fill: true },
        { k: 'path', d: base, color: inkFor(art.fill), fill: false },
      ]
      if (art.mark) shapes.push({ k: 'path', d: d(art.mark), color: art.markColor, fill: false })
      this.ents.set('ground', { h: 100, parts: new Map(), groundName: groundWord })
      if (this.scene.objects.has('ground')) cmds.push({ k: 'reset', id: 'ground', shapes })
      else {
        cmds.push({ k: 'obj', id: 'ground', x: 600 * WK, y: GROUND_Y })
        for (const shape of shapes) cmds.push({ k: 'shape', shape })
        cmds.push({ k: 'end' }, { k: 'layer', id: 'ground', z: -2 })
      }
    }
    return { ok: true, cmds: compactResets(cmds) }
  }

  /* ----- the page, described back ----- */

  describe(): string {
    const s = this.inner.snapshotData()
    const skyName = Object.entries(SKIES).find(([, v]) => v === s.background.toLowerCase())?.[0] ?? sketchColorName(s.background)
    const lines = [`page ${s.page}${s.title ? ` "${s.title}"` : ''} bg ${skyName}`]
    for (const e of s.entities) {
      const info = this.ents.get(e.id)
      if (e.id === 'ground' && info?.groundName) {
        lines[0] += ` ${info.groundName}`
        continue
      }
      const bits = [`ent ${e.id} ${e.x} ${e.y} h=${info?.h ?? 200}`]
      if (e.name !== e.id) bits.push(`"${e.name}"`)
      if (e.layer === -1) bits.push('back')
      else if (e.layer <= -3) bits.push('far')
      if (e.idle === 'float' || e.idle === 'sway') bits.push(e.idle)
      if (e.facing === 'left') bits.push('facing=left')
      const parts: string[] = []
      if (info) for (const p of info.parts.values()) parts.push(`${p.id} ${sketchColorName(p.color)}`)
      if (e.shapes.some((sh) => /_mouth$/.test(sh.id))) parts.push('face')
      lines.push(parts.length ? `${bits.join(' ')} | ${parts.join(', ')}` : bits.join(' '))
    }
    if (s.entities.length === 0) lines.push('(empty page)')
    return lines.join('\n')
  }
}

/** Several replacements in one line each re-issue the whole shape list: only the last one matters. */
function compactResets(cmds: Command[]): Command[] {
  const lastReset = new Map<string, number>()
  cmds.forEach((c, i) => {
    if (c.k === 'reset') lastReset.set(c.id, i)
  })
  return cmds.filter((c, i) => c.k !== 'reset' || lastReset.get(c.id) === i)
}
