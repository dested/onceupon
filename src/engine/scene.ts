import { GROUND_Y, WORLD_H, WORLD_W, type AnimKind, type Command, type FxKind, type Shape } from './types'
import { colorName } from './colors'
import { shapeBounds, unionBounds, type Bounds } from './geometry'
import { stampShapes } from './stamps'

export interface SceneObject {
  id: string
  x: number
  y: number
  shapes: Shape[]
  /** Local bounds of all shapes (unscaled). */
  bounds: Bounds | null
  scale: number
  flipped: boolean
  anim: AnimKind
  colors: string[]
  /** Composite order; lower is further back. */
  layer: number
}

export interface ScenePage {
  index: number
  title: string
  sky: string | null
  ground: string | null
}

export type SceneEvent =
  | { k: 'objectCreated'; obj: SceneObject }
  | { k: 'shapesAdded'; id: string; shapes: Shape[] }
  /** Replace an object's shapes; the first `keep` shapes are unchanged and stay drawn. */
  | { k: 'shapesReset'; id: string; shapes: Shape[]; keep: number }
  | { k: 'layer'; id: string; z: number }
  | { k: 'move'; id: string; x: number; y: number; secs: number }
  | { k: 'scale'; id: string; factor: number; secs: number }
  | { k: 'flip'; id: string }
  | { k: 'remove'; id: string }
  | { k: 'anim'; id: string; kind: AnimKind }
  | { k: 'fx'; kind: FxKind; x: number; y: number; size: number }
  | { k: 'say'; id: string; text: string }
  | { k: 'bg'; sky: string; ground: string | null }
  | { k: 'page'; page: ScenePage }
  | { k: 'warn'; message: string }

export const BG_ID = '__bg'

function sameShape(a: Shape | undefined, b: Shape | undefined): boolean {
  return a !== undefined && b !== undefined && JSON.stringify(a) === JSON.stringify(b)
}

/** Pure model of what is on the page. Emits events the Stage renders. Serializes itself for the model prompt. */
export class Scene {
  objects = new Map<string, SceneObject>()
  pages: ScenePage[] = [{ index: 1, title: '', sky: null, ground: null }]
  private openId: string | null = null
  /** Characters from the previous page, so "mv dragon" right after a page turn can bring them along. */
  private carried = new Map<string, SceneObject>()

  get page(): ScenePage {
    const p = this.pages[this.pages.length - 1]
    if (!p) throw new Error('scene has no page')
    return p
  }

  private uniqueId(base: string): string {
    if (!this.objects.has(base)) return base
    let n = 2
    while (this.objects.has(`${base}${n}`)) n++
    return `${base}${n}`
  }

  private create(id: string, x: number, y: number, layer = 0): SceneObject {
    const obj: SceneObject = { id, x, y, shapes: [], bounds: null, scale: 1, flipped: false, anim: 'none', colors: [], layer }
    this.objects.set(id, obj)
    return obj
  }

  private addShapes(obj: SceneObject, shapes: Shape[]): void {
    for (const s of shapes) {
      obj.shapes.push(s)
      obj.bounds = unionBounds(obj.bounds, shapeBounds(s))
      const name = colorName(s.color)
      if (!obj.colors.includes(name)) obj.colors.push(name)
    }
  }

  apply(cmd: Command): SceneEvent[] {
    const out: SceneEvent[] = []
    const need = (id: string): SceneObject | null => {
      const o = this.objects.get(id)
      if (o) return o
      const prev = this.carried.get(id)
      if (prev) {
        // Bring the character onto the new page as it was, then let the verb act on it.
        const obj = this.create(id, prev.x, prev.y, prev.layer)
        obj.scale = prev.scale
        obj.flipped = prev.flipped
        obj.anim = prev.anim
        out.push({ k: 'objectCreated', obj })
        this.addShapes(obj, prev.shapes)
        out.push({ k: 'shapesAdded', id, shapes: [...prev.shapes] })
        this.carried.delete(id)
        return obj
      }
      out.push({ k: 'warn', message: `no object "${id}" on this page` })
      return null
    }

    switch (cmd.k) {
      case 'skip':
        break
      case 'layer': {
        const obj = need(cmd.id)
        if (!obj) break
        obj.layer = cmd.z
        out.push({ k: 'layer', id: cmd.id, z: cmd.z })
        break
      }
      case 'reset': {
        this.openId = null
        const obj = need(cmd.id)
        if (!obj) break
        let keep = 0
        while (keep < obj.shapes.length && keep < cmd.shapes.length && sameShape(obj.shapes[keep], cmd.shapes[keep])) keep++
        obj.shapes = []
        obj.bounds = null
        obj.colors = []
        this.addShapes(obj, cmd.shapes)
        out.push({ k: 'shapesReset', id: cmd.id, shapes: cmd.shapes, keep })
        break
      }
      case 'recall':
        this.openId = null
        if (this.carried.has(cmd.id) || this.objects.has(cmd.id)) need(cmd.id)
        break
      case 'title':
        this.page.title = cmd.title
        break
      case 'obj': {
        const existing = this.objects.get(cmd.id)
        if (existing) {
          this.openId = cmd.id
          if (Math.hypot(existing.x - cmd.x, existing.y - cmd.y) > 2) {
            existing.x = cmd.x
            existing.y = cmd.y
            out.push({ k: 'move', id: cmd.id, x: cmd.x, y: cmd.y, secs: 0.6 })
          }
          break
        }
        const obj = this.create(cmd.id, cmd.x, cmd.y)
        this.openId = cmd.id
        out.push({ k: 'objectCreated', obj })
        break
      }
      case 'end':
        this.openId = null
        break
      case 'shape': {
        let obj = this.openId ? this.objects.get(this.openId) : undefined
        if (!obj) {
          // Shape with no open object: give it a home so nothing is lost.
          const id = this.uniqueId('thing')
          obj = this.create(id, 0, 0)
          this.openId = id
          out.push({ k: 'objectCreated', obj })
        }
        this.addShapes(obj, [cmd.shape])
        out.push({ k: 'shapesAdded', id: obj.id, shapes: [cmd.shape] })
        break
      }
      case 'stamp': {
        const open = this.openId ? this.objects.get(this.openId) : undefined
        if (open) {
          // Models sometimes wrap a lone stamp in an obj and give it PAGE coordinates
          // (obj house 40 80 / s house 40 68 20). If the relative reading lands off the page
          // but the absolute one fits, read it as absolute.
          let { x, y } = cmd
          const offPage = open.y + y - cmd.size < 0 || open.y + y > WORLD_H + 2 || Math.abs(open.x + x) > WORLD_W * 1.5
          const absFits = y >= 0 && y <= WORLD_H && x >= 0 && x <= WORLD_W
          if (open.shapes.length === 0 && offPage && absFits) {
            x -= open.x
            y -= open.y
          }
          const shapes = stampShapes(cmd.name, x, y, cmd.size, cmd.color)
          this.addShapes(open, shapes)
          out.push({ k: 'shapesAdded', id: open.id, shapes })
        } else {
          const id = this.uniqueId(cmd.name)
          const obj = this.create(id, cmd.x, cmd.y)
          out.push({ k: 'objectCreated', obj })
          const shapes = stampShapes(cmd.name, 0, 0, cmd.size, cmd.color)
          this.addShapes(obj, shapes)
          out.push({ k: 'shapesAdded', id, shapes })
        }
        break
      }
      case 'mv': {
        this.openId = null
        const obj = need(cmd.id)
        if (!obj) break
        let tx: number
        let ty: number
        if (cmd.to.kind === 'abs') {
          tx = cmd.to.x
          ty = cmd.to.y
        } else {
          const ref = need(cmd.to.ref)
          if (!ref) break
          if (cmd.to.dx === 0 && cmd.to.dy === 0) {
            const halfRef = ref.bounds ? ((ref.bounds.maxX - ref.bounds.minX) / 2) * ref.scale : 5
            const halfMe = obj.bounds ? ((obj.bounds.maxX - obj.bounds.minX) / 2) * obj.scale : 5
            const gap = halfRef + halfMe + 3
            tx = obj.x < ref.x ? ref.x - gap : ref.x + gap
            ty = obj.y
          } else {
            tx = ref.x + cmd.to.dx
            ty = ref.y + cmd.to.dy
          }
        }
        tx = Math.max(-20, Math.min(WORLD_W + 20, tx))
        ty = Math.max(-20, Math.min(WORLD_H + 20, ty))
        obj.x = tx
        obj.y = ty
        out.push({ k: 'move', id: cmd.id, x: tx, y: ty, secs: Math.max(0, cmd.secs) })
        break
      }
      case 'sc': {
        this.openId = null
        const obj = need(cmd.id)
        if (!obj) break
        obj.scale = cmd.factor
        out.push({ k: 'scale', id: cmd.id, factor: cmd.factor, secs: cmd.secs })
        break
      }
      case 'flip': {
        this.openId = null
        const obj = need(cmd.id)
        if (!obj) break
        obj.flipped = !obj.flipped
        out.push({ k: 'flip', id: cmd.id })
        break
      }
      case 'rm': {
        this.openId = null
        if (!need(cmd.id)) break
        this.objects.delete(cmd.id)
        out.push({ k: 'remove', id: cmd.id })
        break
      }
      case 'anim': {
        this.openId = null
        const obj = need(cmd.id)
        if (!obj) break
        obj.anim = cmd.kind
        out.push({ k: 'anim', id: cmd.id, kind: cmd.kind })
        break
      }
      case 'fx':
        this.openId = null
        out.push({ k: 'fx', kind: cmd.kind, x: cmd.x, y: cmd.y, size: cmd.size })
        break
      case 'say': {
        this.openId = null
        if (!need(cmd.id)) break
        out.push({ k: 'say', id: cmd.id, text: cmd.text })
        break
      }
      case 'bg': {
        this.openId = null
        this.page.sky = cmd.sky
        this.page.ground = cmd.ground ?? this.page.ground
        out.push({ k: 'bg', sky: cmd.sky, ground: this.page.ground })
        break
      }
      case 'page': {
        this.openId = null
        this.carried = new Map(this.objects)
        this.carried.delete(BG_ID)
        this.objects.clear()
        const page: ScenePage = { index: this.pages.length + 1, title: cmd.title, sky: null, ground: null }
        this.pages.push(page)
        out.push({ k: 'page', page })
        break
      }
    }
    return out
  }

  /** Terse description of the current page for the model. */
  summary(): string {
    const p = this.page
    const lines: string[] = []
    const bg = p.sky ? ` bg ${colorName(p.sky)}${p.ground ? `/${colorName(p.ground)}` : ''}` : ''
    lines.push(`page ${p.index}${p.title ? ` "${p.title}"` : ''}${bg}`)
    if (this.pages.length > 1) {
      const prev = this.pages
        .slice(0, -1)
        .map((q) => `${q.index}${q.title ? `:${q.title}` : ''}`)
        .join(', ')
      lines.push(`earlier pages: ${prev}`)
    }
    let count = 0
    for (const o of this.objects.values()) {
      if (o.id === BG_ID) continue
      count++
      const w = o.bounds ? Math.round((o.bounds.maxX - o.bounds.minX) * o.scale) : 0
      const h = o.bounds ? Math.round((o.bounds.maxY - o.bounds.minY) * o.scale) : 0
      const extra = [o.anim !== 'none' ? o.anim : '', o.flipped ? 'faces-left' : ''].filter(Boolean).join(' ')
      lines.push(`${o.id} @${Math.round(o.x)},${Math.round(o.y)} ${w}x${h} ${o.colors.slice(0, 3).join(',')}${extra ? ` (${extra})` : ''}`)
    }
    if (count === 0) lines.push(`(empty page; ground is y=${GROUND_Y})`)
    return lines.join('\n')
  }
}
