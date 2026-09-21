import { z } from 'zod'
import { faceShapes } from '~/engine/face'
import type { Scene } from '~/engine/scene'
import { BG_ID } from '~/engine/scene'
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
const DEFAULT_BACKGROUND = '#faf5ec'

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
type PathCmd = z.infer<typeof pathCmdSchema>

const shapeSchema = z.object({
  id: idSchema,
  entity: idSchema,
  color: colorSchema,
  fill: colorSchema.optional(),
  width: z.number().min(1).max(24).optional(),
  path: z.array(pathCmdSchema).min(2).max(80),
  motion: z.enum(['none', 'flap', 'wag', 'blink', 'sway']).optional(),
  pivot: z.tuple([num, num]).optional(),
})

const IDLE = ['none', 'breathe', 'float', 'sway'] as const
const MOVE_STYLE = ['glide', 'walk', 'hop'] as const
const POSE = ['shake', 'jump', 'spin', 'celebrate'] as const
const EFFECT = ['burst', 'smoke', 'sparkles', 'rain'] as const

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
    facing: z.enum(['front', 'left', 'right']).default('right'),
    expression: z.enum(['happy', 'surprised', 'sad']).default('happy'),
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
  z.object({ op: z.literal('effect'), kind: z.enum(EFFECT), x: num, y: num, color: colorSchema.optional(), size: z.number().min(10).max(250).default(70) }),
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

const IDLE_ANIM: Record<(typeof IDLE)[number], AnimKind> = { none: 'none', breathe: 'bob', float: 'fly', sway: 'wobble' }
const POSE_ANIM: Record<(typeof POSE)[number], AnimKind> = { shake: 'shake', jump: 'bounce', spin: 'spin', celebrate: 'bounce' }
const EFFECT_FX: Record<(typeof EFFECT)[number], FxKind> = { burst: 'explode', smoke: 'smoke', sparkles: 'sparkle', rain: 'rain' }

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
 */
export class JsonDialect implements Dialect {
  readonly id = 'json' as const
  readonly system: string
  readonly maxTokens = 2600
  later: ((cmds: Command[]) => void) | null = null
  private ents = new Map<string, EntityMeta>()
  private timers: number[] = []

  constructor(
    private scene: Scene,
    opts: DialectOptions
  ) {
    this.system = opts.moderation ? JSON_SYSTEM_PROMPT : JSON_SYSTEM_PROMPT_UNMODERATED
  }

  buildUser(input: DialectInput): PromptBlock[] {
    return buildJsonUserBlocks({ storyChunks: input.storyChunks, sceneJson: this.snapshot(), newWords: input.newWords })
  }

  isSkip(line: string): boolean {
    return /"op"\s*:\s*"skip"/.test(line)
  }

  reset(): void {
    this.ents.clear()
    for (const t of this.timers) clearTimeout(t)
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
    const res = operationSchema.safeParse(raw)
    if (!res.success) {
      const issue = res.error.issues[0]
      return { ok: false, error: `${issue ? `${issue.path.join('.')}: ${issue.message}` : 'invalid operation'} in ${text.slice(0, 80)}` }
    }
    return this.translate(res.data)
  }

  /** The scene as JSON for the model: paper coordinates, entity names, shape ids and colors. */
  snapshot(): string {
    const p = this.scene.page
    const entities: unknown[] = []
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
    return JSON.stringify({ page: p.index, title: p.title, background: p.sky ?? DEFAULT_BACKGROUND, entities })
  }

  private schedule(ms: number, cmds: Command[]): void {
    const t = window.setTimeout(() => {
      this.timers = this.timers.filter((x) => x !== t)
      this.later?.(cmds)
    }, ms)
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

  private translate(op: Operation): DialectParse {
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
        const d = pathToSvg(s.path)
        const shapes: Shape[] = []
        if (s.fill) shapes.push({ k: 'path', d, color: s.fill, fill: true })
        if (!s.fill || s.fill.toLowerCase() !== s.color.toLowerCase()) shapes.push({ k: 'path', d, color: s.color, fill: false })
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
