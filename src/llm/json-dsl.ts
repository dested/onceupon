import { z } from 'zod'
import { realClock, type Clock } from '~/engine/clock'
import { faceShapes } from '~/engine/face'
import type { Scene } from '~/engine/scene'
import { BG_ID } from '~/engine/scene'
import { isStampName, stampShapes } from '~/engine/stamps'
import { GROUND_Y, WORLD_W, type AnimKind, type Command, type FxKind, type Shape } from '~/engine/types'
import { cleanText } from '~/story/clean'
import type { Dialect, DialectInput, DialectOptions, DialectParse } from './dialect'
import { buildJsonUserBlocks, JSON_SYSTEM_PROMPT, JSON_SYSTEM_PROMPT_UNMODERATED } from './json-prompt'
import type { PromptBlock } from './providers'

/* ---------- the JSON contract (v1 of the operations doc) ---------- */

const PAPER_W = 1200
const PAPER_H = 620
const PAPER_GROUND = 525
/** Uniform paper -> world scale, so curves keep their shape. */
const K = WORLD_W / PAPER_W
/** Vertical offset that puts the paper's ground line on the world's. */
const OY = GROUND_Y - PAPER_GROUND * K
export const DEFAULT_BACKGROUND = '#faf5ec'

const idSchema = z.string().regex(/^[a-zA-Z][a-zA-Z0-9_-]{0,47}$/)
const colorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/)
const num = z.number().finite().min(-2400).max(2400)

const pathCmdSchema = z.union([
  z.tuple([z.literal('M'), num, num]),
  z.tuple([z.literal('L'), num, num]),
  z.tuple([z.literal('Q'), num, num, num, num]),
  z.tuple([z.literal('C'), num, num, num, num, num, num]),
  z.tuple([z.literal('Z')]),
])
export type PathCmd = z.infer<typeof pathCmdSchema>

/**
 * A shape carries exactly one geometry. `path` is the original contract; the primitives, `poly`
 * and `stamp` are additive (the ops dialect teaches them, JSON may use them too).
 */
const GEOMETRY_KEYS = ['path', 'circle', 'oval', 'rect', 'poly', 'stamp'] as const
const shapeSchema = z
  .object({
    id: idSchema,
    entity: idSchema,
    color: colorSchema,
    fill: colorSchema.optional(),
    width: z.number().min(1).max(24).optional(),
    path: z.array(pathCmdSchema).min(2).max(80).optional(),
    /** cx cy r */
    circle: z.tuple([num, num, num]).optional(),
    /** cx cy rx ry */
    oval: z.tuple([num, num, num, num]).optional(),
    /** top-left x y, w h */
    rect: z.tuple([num, num, num, num]).optional(),
    /** x y pairs, closed */
    poly: z.array(num).min(6).max(80).optional(),
    /** prefab scenery from the crayon box, placed inside the entity */
    stamp: z.object({ name: z.string().refine(isStampName), x: num, y: num, size: z.number().min(2).max(1200) }).optional(),
    /** also draw the x-mirror (two ears, two legs) */
    mirror: z.boolean().optional(),
    motion: z.enum(['none', 'flap', 'wag', 'blink', 'sway']).optional(),
    pivot: z.tuple([num, num]).optional(),
  })
  .refine((s) => GEOMETRY_KEYS.filter((k) => s[k] !== undefined).length === 1, {
    message: 'shape needs exactly one of path, circle, oval, rect, poly, stamp',
  })
export type ShapeOp = z.infer<typeof shapeSchema>

const IDLE = ['none', 'breathe', 'float', 'sway'] as const
const MOVE_STYLE = ['glide', 'walk', 'hop'] as const
const POSE = ['shake', 'jump', 'spin', 'celebrate'] as const
const EFFECT = ['burst', 'smoke', 'sparkles', 'rain', 'hearts', 'fire', 'stars', 'poof'] as const
const FACING = ['front', 'left', 'right'] as const
const EXPRESSION = ['happy', 'surprised', 'sad'] as const
/** Word lists shared with the terse ops parser. */
export const OPS_VOCAB = { idle: IDLE, moveStyle: MOVE_STYLE, pose: POSE, effect: EFFECT, facing: FACING, expression: EXPRESSION }

export const operationSchema = z.discriminatedUnion('op', [
  z.object({
    op: z.literal('entity'),
    id: idSchema,
    name: z.string().min(1).max(100),
    x: num,
    y: num,
    scale: z.number().min(0.1).max(3).default(1),
    idle: z.enum(IDLE).default('none'),
    layer: z.number().int().min(-10).max(10).default(0),
  }),
  z.object({ op: z.literal('draw'), shape: shapeSchema }),
  z.object({
    op: z.literal('face'),
    id: idSchema,
    head: idSchema,
    facing: z.enum(FACING).default('right'),
    expression: z.enum(EXPRESSION).default('happy'),
  }),
  z.object({
    op: z.literal('move'),
    id: idSchema,
    x: num,
    y: num,
    duration: z.number().min(0.2).max(12).default(2),
    style: z.enum(MOVE_STYLE).default('walk'),
  }),
  z.object({ op: z.literal('pose'), id: idSchema, action: z.enum(POSE), duration: z.number().min(0.2).max(8).default(2) }),
  z.object({ op: z.literal('recolor'), id: idSchema, from: colorSchema.optional(), color: colorSchema }),
  z.object({
    op: z.literal('effect'),
    kind: z.enum(EFFECT),
    x: num,
    y: num,
    color: colorSchema.optional(),
    size: z.number().min(10).max(250).default(70),
  }),
  z.object({ op: z.literal('remove'), id: idSchema }),
  z.object({
    op: z.literal('scene'),
    background: colorSchema.default(DEFAULT_BACKGROUND),
    clear: z.boolean().default(false),
    keep: z.array(idSchema).max(12).default([]),
    title: z.string().max(80).default(''),
  }),
  // Once Upon extensions to the contract.
  z.object({ op: z.literal('say'), id: idSchema, text: z.string().min(1).max(200) }),
  z.object({ op: z.literal('skip') }),
])
export type Operation = z.infer<typeof operationSchema>

/* ---------- translation to engine commands ---------- */

interface ShapeMeta {
  id: string
  color: string
  fill: string | undefined
  /** Engine shapes this one became (fill pass, then outline pass), in local world units. */
  shapes: Shape[]
}

interface EntityMeta {
  name: string
  idle: (typeof IDLE)[number]
  layer: number
  shapes: Map<string, ShapeMeta>
}

/** What the model is told about the page, in paper units. Each dialect renders it its own way. */
export interface SceneSnapshot {
  page: number
  title: string
  background: string
  entities: {
    id: string
    name: string
    x: number
    y: number
    scale: number
    idle: (typeof IDLE)[number]
    layer: number
    facing: 'left' | 'right'
    shapes: { id: string; color: string; fill?: string }[]
  }[]
}

const IDLE_ANIM: Record<(typeof IDLE)[number], AnimKind> = { none: 'none', breathe: 'bob', float: 'fly', sway: 'wobble' }
const POSE_ANIM: Record<(typeof POSE)[number], AnimKind> = { shake: 'shake', jump: 'bounce', spin: 'spin', celebrate: 'bounce' }
const EFFECT_FX: Record<(typeof EFFECT)[number], FxKind> = {
  burst: 'explode',
  smoke: 'smoke',
  sparkles: 'sparkle',
  rain: 'rain',
  hearts: 'hearts',
  fire: 'fire',
  stars: 'stars',
  poof: 'poof',
}

const f2 = (n: number): string => (Math.round(n * 100) / 100).toString()

function pathToSvg(path: PathCmd[]): string {
  const parts: string[] = []
  for (const c of path) {
    switch (c[0]) {
      case 'M':
      case 'L':
        parts.push(`${c[0]} ${f2(c[1] * K)} ${f2(c[2] * K)}`)
        break
      case 'Q':
        parts.push(`Q ${f2(c[1] * K)} ${f2(c[2] * K)} ${f2(c[3] * K)} ${f2(c[4] * K)}`)
        break
      case 'C':
        parts.push(`C ${f2(c[1] * K)} ${f2(c[2] * K)} ${f2(c[3] * K)} ${f2(c[4] * K)} ${f2(c[5] * K)} ${f2(c[6] * K)}`)
        break
      case 'Z':
        parts.push('Z')
        break
    }
  }
  return parts.join(' ')
}

function mirrorPath(path: PathCmd[]): PathCmd[] {
  return path.map((c): PathCmd => {
    switch (c[0]) {
      case 'M':
      case 'L':
        return [c[0], -c[1], c[2]]
      case 'Q':
        return ['Q', -c[1], c[2], -c[3], c[4]]
      case 'C':
        return ['C', -c[1], c[2], -c[3], c[4], -c[5], c[6]]
      case 'Z':
        return c
    }
  })
}

/** One geometry pass in local world units (fill pass or outline pass). */
function geometryShape(s: ShapeOp, color: string, fill: boolean, mirrored: boolean): Shape[] {
  const mx = mirrored ? -1 : 1
  if (s.path) return [{ k: 'path', d: pathToSvg(mirrored ? mirrorPath(s.path) : s.path), color, fill }]
  if (s.circle) {
    const [cx, cy, r] = s.circle
    return [{ k: 'circle', cx: cx * K * mx, cy: cy * K, r: Math.abs(r) * K, color, fill }]
  }
  if (s.oval) {
    const [cx, cy, rx, ry] = s.oval
    return [{ k: 'ellipse', cx: cx * K * mx, cy: cy * K, rx: Math.abs(rx) * K, ry: Math.abs(ry) * K, color, fill }]
  }
  if (s.rect) {
    const [x, y, w, h] = s.rect
    const left = mirrored ? -(x + w) : x
    return [{ k: 'rect', x: left * K, y: y * K, w: Math.abs(w) * K, h: Math.abs(h) * K, color, fill }]
  }
  if (s.poly) {
    const pts = []
    for (let i = 0; i + 1 < s.poly.length; i += 2) pts.push({ x: (s.poly[i] ?? 0) * K * mx, y: (s.poly[i + 1] ?? 0) * K })
    return [{ k: 'poly', pts, color, fill, closed: true }]
  }
  if (s.stamp) return stampShapes(s.stamp.name, s.stamp.x * K * mx, s.stamp.y * K, s.stamp.size * K, fill ? color : undefined)
  return []
}

/** Engine shapes for a draw op: fill pass then outline pass (and the mirror of both). */
function shapeToEngine(s: ShapeOp): Shape[] {
  const out: Shape[] = []
  const sides = s.mirror ? [false, true] : [false]
  for (const mirrored of sides) {
    if (s.stamp) {
      out.push(...geometryShape(s, s.fill ?? s.color, s.fill !== undefined, mirrored))
      continue
    }
    if (s.fill) out.push(...geometryShape(s, s.fill, true, mirrored))
    if (!s.fill || s.fill.toLowerCase() !== s.color.toLowerCase()) out.push(...geometryShape(s, s.color, false, mirrored))
  }
  return out
}

function isLight(hex: string): boolean {
  const n = Number.parseInt(hex.slice(1), 16)
  if (!Number.isFinite(n)) return false
  const r = (n >> 16) & 255
  const g = (n >> 8) & 255
  const b = n & 255
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.35
}

const px = (x: number): number => x * K
const py = (y: number): number => y * K + OY
const toPaperX = (x: number): number => Math.round(x / K)
const toPaperY = (y: number): number => Math.round((y - OY) / K)

/**
 * The JSON operations dialect: NDJSON operations with curved paths, a face helper, poses and
 * recolors, mapped onto the same crayon engine. Keeps its own table of entity names and shape
 * ids so shapes can be replaced by id and the scene can be described back as JSON.
 * The ops dialect composes this class: same operations, terser wire syntax.
 */
export class JsonDialect implements Dialect {
  readonly id = 'json' as const
  readonly system: string
  readonly maxTokens = 2600
  later: ((cmds: Command[]) => void) | null = null
  private ents = new Map<string, EntityMeta>()
  private timers: number[] = []
  private clock: Clock

  constructor(
    private scene: Scene,
    opts: DialectOptions
  ) {
    this.system = opts.moderation ? JSON_SYSTEM_PROMPT : JSON_SYSTEM_PROMPT_UNMODERATED
    this.clock = opts.clock ?? realClock
  }

  buildUser(input: DialectInput): PromptBlock[] {
    return buildJsonUserBlocks({ storyChunks: input.storyChunks, sceneJson: this.snapshot(), newWords: input.newWords })
  }

  isSkip(line: string): boolean {
    return /"op"\s*:\s*"skip"/.test(line)
  }

  reset(): void {
    this.ents.clear()
    for (const t of this.timers) this.clock.cancel(t)
    this.timers = []
  }

  parse(line: string): DialectParse {
    const text = line.trim().replace(/^```(json)?/, '').replace(/```$/, '')
    if (!text || text.startsWith('#') || text.startsWith('//')) return { ok: true, cmds: [] }
    let raw: unknown
    try {
      raw = JSON.parse(text)
    } catch {
      return { ok: false, error: `not JSON: ${text.slice(0, 80)}` }
    }
    return this.applyRaw(raw, text)
  }

  /** Validate an untyped operation against the contract and run it. */
  applyRaw(raw: unknown, source: string): DialectParse {
    const res = operationSchema.safeParse(raw)
    if (!res.success) {
      const issue = res.error.issues[0]
      return { ok: false, error: `${issue ? `${issue.path.join('.')}: ${issue.message}` : 'invalid operation'} in ${source.slice(0, 80)}` }
    }
    return this.apply(res.data)
  }

  /** The scene as JSON for the model: paper coordinates, entity names, shape ids and colors. */
  snapshot(): string {
    return JSON.stringify(this.snapshotData())
  }

  snapshotData(): SceneSnapshot {
    const p = this.scene.page
    const entities: SceneSnapshot['entities'] = []
    for (const obj of this.scene.objects.values()) {
      if (obj.id === BG_ID) continue
      const meta = this.ents.get(obj.id)
      entities.push({
        id: obj.id,
        name: meta?.name ?? obj.id,
        x: toPaperX(obj.x),
        y: toPaperY(obj.y),
        scale: obj.scale,
        idle: meta?.idle ?? 'none',
        layer: obj.layer,
        facing: obj.flipped ? 'left' : 'right',
        shapes: meta ? [...meta.shapes.values()].map((s) => (s.fill ? { id: s.id, color: s.color, fill: s.fill } : { id: s.id, color: s.color })) : [],
      })
    }
    return { page: p.index, title: p.title, background: p.sky ?? DEFAULT_BACKGROUND, entities }
  }

  private schedule(ms: number, cmds: Command[]): void {
    const t = this.clock.after(ms, () => {
      this.timers = this.timers.filter((x) => x !== t)
      this.later?.(cmds)
    })
    this.timers.push(t)
  }

  private idleCmd(id: string): Command {
    return { k: 'anim', id, kind: IDLE_ANIM[this.ents.get(id)?.idle ?? 'none'] }
  }

  /** Commands that append shapes to an existing entity without moving it. */
  private appendCmds(id: string, shapes: Shape[]): Command[] {
    const obj = this.scene.objects.get(id)
    if (!obj) return []
    const cmds: Command[] = [{ k: 'obj', id, x: obj.x, y: obj.y }]
    for (const shape of shapes) cmds.push({ k: 'shape', shape })
    cmds.push({ k: 'end' })
    return cmds
  }

  private allShapes(meta: EntityMeta): Shape[] {
    const out: Shape[] = []
    for (const s of meta.shapes.values()) out.push(...s.shapes)
    return out
  }

  apply(op: Operation): DialectParse {
    switch (op.op) {
      case 'skip':
        return { ok: true, cmds: [{ k: 'skip' }] }

      case 'entity': {
        if (this.scene.objects.has(op.id)) return { ok: true, cmds: [] }
        this.ents.set(op.id, { name: op.name, idle: op.idle, layer: op.layer, shapes: new Map() })
        const cmds: Command[] = [{ k: 'obj', id: op.id, x: px(op.x), y: py(op.y) }, { k: 'end' }]
        if (op.layer !== 0) cmds.push({ k: 'layer', id: op.id, z: op.layer })
        if (op.scale !== 1) cmds.push({ k: 'sc', id: op.id, factor: op.scale, secs: 0 })
        if (op.idle !== 'none') cmds.push(this.idleCmd(op.id))
        return { ok: true, cmds }
      }

      case 'draw': {
        const s = op.shape
        const meta = this.ents.get(s.entity)
        if (!meta || !this.scene.objects.has(s.entity)) return { ok: false, error: `draw: no entity "${s.entity}" on this page` }
        const shapes = shapeToEngine(s)
        const replacing = meta.shapes.has(s.id)
        meta.shapes.set(s.id, { id: s.id, color: s.color, fill: s.fill, shapes })
        if (replacing) return { ok: true, cmds: [{ k: 'reset', id: s.entity, shapes: this.allShapes(meta) }] }
        return { ok: true, cmds: this.appendCmds(s.entity, shapes) }
      }

      case 'face': {
        const meta = this.ents.get(op.id)
        const head = meta?.shapes.get(op.head)
        if (!meta || !head) return { ok: false, error: `face: no head "${op.head}" in "${op.id}"` }
        const headShape = head.shapes[0]
        if (!headShape) return { ok: false, error: 'face: head has no geometry' }
        const parts = faceShapes(op.head, headShape, op.facing, op.expression, head.color)
        let replacing = false
        const fresh: Shape[] = []
        for (const part of parts) {
          if (meta.shapes.has(part.id)) replacing = true
          meta.shapes.set(part.id, { id: part.id, color: part.shape.color, fill: undefined, shapes: [part.shape] })
          fresh.push(part.shape)
        }
        if (replacing) return { ok: true, cmds: [{ k: 'reset', id: op.id, shapes: this.allShapes(meta) }] }
        return { ok: true, cmds: this.appendCmds(op.id, fresh) }
      }

      case 'move': {
        const cmds: Command[] = []
        if (op.style === 'hop') cmds.push({ k: 'anim', id: op.id, kind: 'bounce' })
        if (op.style === 'walk') cmds.push({ k: 'anim', id: op.id, kind: 'walk' })
        cmds.push({ k: 'mv', id: op.id, to: { kind: 'abs', x: px(op.x), y: py(op.y) }, secs: op.duration })
        if (op.style !== 'glide') this.schedule(op.duration * 1000 + 80, [this.idleCmd(op.id)])
        return { ok: true, cmds }
      }

      case 'pose': {
        const cmds: Command[] = [{ k: 'anim', id: op.id, kind: POSE_ANIM[op.action] }]
        if (op.action === 'celebrate') {
          const obj = this.scene.objects.get(op.id)
          if (obj) {
            const top = obj.bounds ? obj.y + obj.bounds.minY * obj.scale : obj.y - 20
            cmds.push({ k: 'fx', kind: 'sparkle', x: obj.x, y: top - 4, size: 14 })
          }
        }
        this.schedule(op.duration * 1000, [this.idleCmd(op.id)])
        return { ok: true, cmds }
      }

      case 'recolor': {
        const meta = this.ents.get(op.id)
        if (!meta) return { ok: false, error: `recolor: no entity "${op.id}"` }
        const from = op.from?.toLowerCase()
        const hit = (c: string): boolean => (from ? c.toLowerCase() === from : isLight(c))
        let changed = 0
        for (const s of meta.shapes.values()) {
          if (s.fill && hit(s.fill)) {
            s.fill = op.color
            changed++
          }
          if (hit(s.color) && (from || !s.fill)) {
            s.color = op.color
            changed++
          }
          // New objects, not mutation: the scene compares old and new shapes to keep the drawn prefix.
          s.shapes = s.shapes.map((shape) => (hit(shape.color) ? { ...shape, color: op.color } : shape))
        }
        if (changed === 0) return { ok: true, cmds: [] }
        return { ok: true, cmds: [{ k: 'reset', id: op.id, shapes: this.allShapes(meta) }] }
      }

      case 'effect':
        return { ok: true, cmds: [{ k: 'fx', kind: EFFECT_FX[op.kind], x: px(op.x), y: py(op.y), size: Math.max(3, op.size * K) }] }

      case 'remove':
        this.ents.delete(op.id)
        return { ok: true, cmds: [{ k: 'rm', id: op.id }] }

      case 'say':
        return { ok: true, cmds: [{ k: 'say', id: op.id, text: cleanText(op.text) }] }

      case 'scene': {
        const cmds: Command[] = []
        const bg = op.background.toLowerCase()
        if (op.clear) {
          cmds.push({ k: 'page', title: op.title })
          for (const id of [...this.ents.keys()]) if (!op.keep.includes(id)) this.ents.delete(id)
          if (bg !== DEFAULT_BACKGROUND) cmds.push({ k: 'bg', sky: op.background, ground: undefined })
          for (const id of op.keep) cmds.push({ k: 'recall', id })
        } else {
          if (op.title) cmds.push({ k: 'title', title: op.title })
          if (bg !== (this.scene.page.sky ?? DEFAULT_BACKGROUND).toLowerCase()) cmds.push({ k: 'bg', sky: op.background, ground: undefined })
        }
        return { ok: true, cmds }
      }
    }
  }
}

export const PAPER = { w: PAPER_W, h: PAPER_H, ground: PAPER_GROUND }
