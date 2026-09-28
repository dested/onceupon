/**
 * The kit dialect: the model is the art director. A subject line names WHAT (kind, colors, mood,
 * facing, size, accessories, container) and the offline-authored library draws HOW. A place line
 * paints a full designed backdrop and is the page turn. Everything else is the ops dialect
 * unchanged (move/pose/say/fx/rm/recolor/scene/ent/draw/face), so freeform drawing covers the
 * long tail, and kit drawings live in the same JSON-contract tables (recolor, replace, describe).
 */
import { realClock, type Clock } from '~/engine/clock'
import type { Scene } from '~/engine/scene'
import { BG_ID } from '~/engine/scene'
import type { Command } from '~/engine/types'
import type { DialectInput, DialectOptions, DialectParse } from '~/llm/dialect'
import { describeScene, parseOpsLine } from '~/llm/ops-dsl'
import { JsonDialect } from '~/llm/json-dsl'
import { storyBlocks } from '~/llm/prompt'
import type { PromptBlock } from '~/llm/providers'
import type { Dialect } from '~/llm/dialect'
import { colorName } from '~/engine/colors'
import { extent, rngFor, xform, type KitShape, type PathCmd } from './geom'
import { kitColor } from './palette'
import { findKit } from './library'
import { findPlace, type PlaceDrawing } from './library/places'
import { roleWear } from './library/people'
import { wearName, wearParts, type Wear } from './library/wear'
import { KIT_SYSTEM_PROMPT, KIT_SYSTEM_PROMPT_UNMODERATED } from './prompt'
import { faceShapes } from '~/engine/face'
import type { Shape } from '~/engine/types'
import { MOODS, POSES, type HeadAnchor, type KitDef, type KitDrawing, type Mood, type Pose } from './types'

const SIZE_WORDS: Record<string, number> = { tiny: 0.45, small: 0.7, big: 1.3, huge: 1.65, giant: 1.9 }

interface Spec {
  colors: string[]
  wear: Wear[]
  mood: Mood
  pose: Pose
  facing: 'left' | 'right' | 'front' | null
  size: number
  inside: string | null
  eyes: number
  name: string
}
const DEFAULT_SPEC: Spec = { colors: [], wear: [], mood: 'happy', pose: 'stand', facing: null, size: 1, inside: null, eyes: 2, name: '' }

interface KitEnt {
  id: string
  kind: string
  def: KitDef
  spec: Spec
  companions: string[]
  seat?: { x: number; y: number }
  /** What the page shows (moves turn a character to face the way it goes). */
  flipped: boolean
  headFacing: 'front' | 'right'
  mouth?: { x: number; y: number }
  /** Local y of the surface things stand on (table top), negative. */
  surface: number
  hidden: boolean
}

type Tok = { text: string; quoted: boolean }
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
const NUM = /^[-+]?\d+(\.\d+)?$/
const isKeyword = (s: string): boolean => isMood(s) || isPose(s) || s in SIZE_WORDS || s in MOOD_ALIAS || s in POSE_ALIAS || s === 'left' || s === 'right' || s === 'front' || kitColor(s) !== null || wearName(s) !== null
const isMood = (s: string): s is Mood => (MOODS as readonly string[]).includes(s)
const isPose = (s: string): s is Pose => (POSES as readonly string[]).includes(s)
const POSE_ALIAS: Record<string, Pose> = { sitting: 'sit', sits: 'sit', sleeping: 'sleep', asleep: 'sleep', lying: 'sleep', flying: 'fly', swimming: 'swim' }
const MOOD_ALIAS: Record<string, Mood> = { scared: 'surprised', shocked: 'surprised', crying: 'sad', mad: 'angry', tired: 'sleepy', smiling: 'happy', excited: 'happy' }

export class KitDialect implements Dialect {
  readonly id = 'kit'
  readonly system: string
  readonly maxTokens = 1200
  private inner: JsonDialect
  private clock: Clock
  private kits = new Map<string, KitEnt>()
  private place: { preset: string; desc: string } | null = null
  private pageNo = 0
  private standY = 525
  private backdrop = new Set<string>()

  constructor(
    private scene: Scene,
    opts: DialectOptions
  ) {
    this.inner = new JsonDialect(scene, opts)
    this.clock = opts.clock ?? realClock
    this.system = opts.moderation ? KIT_SYSTEM_PROMPT : KIT_SYSTEM_PROMPT_UNMODERATED
  }

  get later(): ((cmds: Command[]) => void) | null {
    return this.inner.later
  }
  set later(fn: ((cmds: Command[]) => void) | null) {
    this.inner.later = fn
  }

  isSkip(line: string): boolean {
    return /^skip\b/i.test(line.trim())
  }

  reset(): void {
    this.inner.reset()
    this.kits.clear()
    this.place = null
  }

  buildUser(input: DialectInput): PromptBlock[] {
    return [
      ...storyBlocks('STORY SO FAR:', input.storyChunks),
      { text: ['CURRENT PAGE:', this.snapshot(), '', 'NEW STORY (illustrate only this):', input.newWords.trim()].join('\n') },
    ]
  }

  parse(raw: string): DialectParse {
    const line = raw.trim().replace(/^```\w*/, '').replace(/```$/, '').trim()
    if (!line || line.startsWith('#') || line.startsWith('//')) return { ok: true, cmds: [] }
    const toks = tokenize(line)
    const verb = toks[0]?.text.toLowerCase() ?? ''
    try {
      if (verb === 'place') return this.placeLine(toks.slice(1))
      if (verb === 'hide') return this.hideLine(toks.slice(1), line)
      const def = findKit(verb)
      if (def) return this.subjectLine(def, toks.slice(1), line)
      // ops verbs; containers carry their front along on move/rm/pose
      const res = parseOpsLine(line)
      if (!res.ok) return res
      if (res.op === null) return { ok: true, cmds: [] }
      const pre = verb === 'move' || verb === 'mv' ? this.beforeMove(toks) : []
      const out = this.inner.applyRaw(res.op, line)
      if (!out.ok) return out
      const extra = this.companionEcho(verb, toks)
      return { ok: true, cmds: [...pre, ...out.cmds, ...extra] }
    } catch (e) {
      return { ok: false, error: `${e instanceof Error ? e.message : String(e)} in ${line.slice(0, 80)}` }
    }
  }

  /** move/rm/pose on a container also moves/removes its front part. rm drops the kit record. */
  private companionEcho(verb: string, toks: Tok[]): Command[] {
    const id = toks[1]?.text
    if (!id) return []
    const k = this.kits.get(id)
    if (verb === 'rm' || verb === 'remove') this.kits.delete(id)
    if (!k || k.companions.length === 0) return []
    const cmds: Command[] = []
    for (const c of k.companions) {
      const line = [verb === 'mv' ? 'move' : verb, c, ...toks.slice(2).map((t) => t.text)].join(' ')
      const res = parseOpsLine(line)
      if (!res.ok || res.op === null) continue
      const out = this.inner.applyRaw(res.op, line)
      if (out.ok) cmds.push(...out.cmds)
    }
    return cmds
  }

  /** A move line on a kit subject: it comes out of hiding and turns the way it walks. */
  private beforeMove(toks: Tok[]): Command[] {
    const id = toks[1]?.text ?? ''
    const k = this.kits.get(id)
    const tx = Number(toks[2]?.text)
    if (!k) return []
    const cmds: Command[] = []
    if (k.hidden) {
      cmds.push({ k: 'layer', id, z: k.def.layer ?? 0 })
      k.hidden = false
    }
    const snap = this.inner.snapshotData().entities.find((e) => e.id === id)
    if (snap && Number.isFinite(tx) && Math.abs(tx - snap.x) > 4) k.flipped = tx < snap.x
    return cmds
  }

  /* ---------- hide <id> [<behind-id>] ---------- */

  private hideLine(rest: Tok[], source: string): DialectParse {
    const id = rest[0]?.text ?? ''
    const k = this.kits.get(id)
    if (!k || !this.scene.objects.has(id)) throw new Error(`hide: no "${id}" on the page`)
    const behind = rest[1]?.text
    const cmds: Command[] = []
    let z = -1
    if (behind) {
      const target = this.inner.snapshotData().entities.find((e) => e.id === behind)
      if (!target) throw new Error(`hide: no "${behind}" on the page`)
      const snap = this.inner.snapshotData().entities.find((e) => e.id === id)
      if (snap && Math.abs(target.x - snap.x) > 4) k.flipped = target.x < snap.x
      this.run({ op: 'move', id, x: target.x, y: target.y, duration: 1.2, style: 'hop' }, source, cmds)
      z = target.layer - 1
    }
    cmds.push({ k: 'layer', id, z })
    k.hidden = true
    return { ok: true, cmds }
  }

  private run(op: unknown, source: string, cmds: Command[]): void {
    const r = this.inner.applyRaw(op, source)
    if (!r.ok) throw new Error(r.error)
    cmds.push(...r.cmds)
  }

  private drawShapes(entity: string, shapes: KitShape[], cmds: Command[]): void {
    for (const s of shapes) this.run({ op: 'draw', shape: { ...s, entity } }, `${entity}.${s.id}`, cmds)
  }

  private pageBusy(): boolean {
    for (const id of this.scene.objects.keys()) if (id !== BG_ID) return true
    return this.place !== null
  }

  /* ---------- place <preset> [day|sunset|night] [rain|snow] ["title"] [keep=a,b] ---------- */

  private placeLine(rest: Tok[]): DialectParse {
    const name = rest[0]?.text.toLowerCase() ?? ''
    const preset = findPlace(name)
    if (!preset) throw new Error(`place: unknown place "${name}"`)
    let time = 'day'
    let weather = ''
    let title = ''
    let keep: string[] = []
    for (const t of rest.slice(1)) {
      const w = t.text.toLowerCase()
      if (t.quoted) title = t.text
      else if (w === 'day' || w === 'sunset' || w === 'night' || w === 'morning' || w === 'evening') time = w === 'morning' ? 'day' : w === 'evening' ? 'sunset' : w
      else if (w === 'rain' || w === 'snow' || w === 'rainy' || w === 'snowy') weather = w.startsWith('rain') ? 'rain' : 'snow'
      else if (w.startsWith('keep=')) keep = w.slice(5).split(',').filter(Boolean)
      else title = title || t.text
    }
    const d: PlaceDrawing = preset.build({ time, weather, rng: rngFor(`${name}:${time}:${weather}`) })
    const cmds: Command[] = []
    const keepAll: string[] = []
    for (const k of keep) {
      if (!this.scene.objects.has(k) && !this.kits.has(k)) continue
      keepAll.push(k)
      for (const c of this.kits.get(k)?.companions ?? []) keepAll.push(c)
    }
    const clear = this.pageBusy()
    this.run({ op: 'scene', background: d.sky, clear, keep: keepAll, title: title || preset.title }, 'place', cmds)
    // The stage recreates a recalled character's view without its scale, facing or idle motion
    // (Stage.handle objectCreated ignores them), so restate them for kept kit subjects.
    if (clear) {
      for (const id of keepAll) {
        const k = this.kits.get(id) ?? [...this.kits.values()].find((e) => e.companions.includes(id))
        if (!k) continue
        if (k.spec.size !== 1) cmds.push({ k: 'sc', id, factor: k.spec.size, secs: 0 })
        if (k.flipped) cmds.push({ k: 'flip', id })
        if (k.id === id) {
          const idle = k.spec.pose === 'fly' || k.def.air ? 'float' : k.def.idle
          if (idle !== 'none') cmds.push({ k: 'anim', id, kind: idle === 'breathe' ? 'bob' : idle === 'float' ? 'fly' : 'wobble' })
        }
      }
    }
    if (d.back.length > 0) {
      const sid = `sky${++this.pageNo}`
      this.backdrop.add(sid)
      this.run({ op: 'entity', id: sid, name: 'sky', x: 600, y: 525, layer: -3 }, 'place sky', cmds)
      this.drawShapes(sid, d.back, cmds)
    }
    const lid = `land${++this.pageNo}`
    this.backdrop.add(lid)
    this.run({ op: 'entity', id: lid, name: preset.title, x: 600, y: 525, layer: -2 }, 'place land', cmds)
    this.drawShapes(lid, d.land, cmds)
    this.standY = d.standY ?? 525
    this.place = { preset: name, desc: `place ${name} ${time}${weather ? ` ${weather}` : ''}${title ? ` "${title}"` : ''} (stand at y=${d.standY ?? 525}${d.note ? `; ${d.note}` : ''})` }
    return { ok: true, cmds }
  }

  /* ---------- <kind> [id] <x> [y] [colors...] [mood] [left|right] [size] [pose] [wear=a,b] [in=container] ---------- */

  private subjectLine(def: KitDef, rest: Tok[], source: string): DialectParse {
    let i = 0
    let id = def.kind
    const first = rest[0]
    if (first && !first.quoted && !NUM.test(first.text) && !first.text.includes('=') && !isKeyword(first.text.toLowerCase())) {
      id = first.text
      i = 1
    }
    if (!/^[a-zA-Z][a-zA-Z0-9_-]{0,40}$/.test(id)) throw new Error(`bad id "${id}"`)
    const nums: number[] = []
    let at: string | null = null
    let on: string | null = null
    const given: Partial<Spec> = {}
    const colors: string[] = []
    const wear: Wear[] = []
    for (const t of rest.slice(i)) {
      const w = t.text.toLowerCase()
      if (t.quoted) given.name = t.text
      else if (NUM.test(w)) nums.push(Number(w))
      else if (w.includes('=')) {
        const [k = '', v = ''] = w.split('=')
        if (k === 's' || k === 'size') given.size = sizeWord(v, def) ?? Number(v)
        else if (k === 'wear' || k === 'w') {
          for (const x of v.split(',')) {
            const wn = wearName(x)
            if (wn) wear.push(wn)
          }
        } else if (k === 'in') given.inside = t.text.slice(t.text.indexOf('=') + 1)
        else if (k === 'on') on = t.text.slice(t.text.indexOf('=') + 1)
        else if (k === 'at') at = t.text.slice(t.text.indexOf('=') + 1)
        else if (k === 'c' || k === 'color') {
          const c = kitColor(v)
          if (c) colors.push(c)
        } else if (k === 'eyes') given.eyes = Math.max(1, Math.min(6, Math.round(Number(v)) || 2))
        else if (k === 'mood') given.mood = isMood(v) ? v : (MOOD_ALIAS[v] ?? 'happy')
        else if (k === 'pose') given.pose = isPose(v) ? v : (POSE_ALIAS[v] ?? 'stand')
      } else if (isMood(w)) given.mood = w
      else if (MOOD_ALIAS[w]) given.mood = MOOD_ALIAS[w]
      else if (isPose(w)) given.pose = w
      else if (POSE_ALIAS[w]) given.pose = POSE_ALIAS[w]
      else if (w === 'stand' || w === 'standing' || w === 'awake') given.pose = 'stand'
      else if (w === 'left' || w === 'right' || w === 'front') given.facing = w
      else if (sizeWord(w, def) !== null) given.size = sizeWord(w, def) ?? 1
      else if (kitColor(w)) colors.push(kitColor(w) ?? '')
      else {
        const wn = wearName(w)
        if (wn) wear.push(wn)
      }
    }
    if (colors.length > 0) given.colors = colors
    if (wear.length > 0) given.wear = wear
    if (given.size !== undefined) given.size = Number.isFinite(given.size) && given.size > 0 ? Math.max(0.3, Math.min(2.6, given.size)) : 1

    // Already on the page: an update (walk there, new mood, pose or outfit), never a second copy.
    const existing = this.kits.get(id)
    if (existing && this.scene.objects.has(id)) return this.updateExisting(existing, given, nums, source)

    const spec: Spec = { ...DEFAULT_SPEC, ...given }
    // A rider in a car, boat or bed sits unless the line says otherwise.
    if (spec.inside && given.pose === undefined) spec.pose = 'sit'
    let x = nums[0] ?? 600
    let y = nums[1] ?? (def.air || spec.pose === 'fly' ? 330 : this.standY)
    const seat = spec.inside ? this.seatOf(spec.inside) : null
    if (seat) {
      x = seat.x
      y = seat.y
    }
    const top = on ? this.topOf(on) : null
    if (top) {
      x = nums[0] ?? top.x
      y = top.y
    }
    const mouth = at ? this.mouthOf(at) : null
    if (mouth) {
      x = mouth.x
      y = mouth.y
      if (mouth.left && given.facing === undefined) spec.facing = 'left'
    }
    const art = this.art(def, id, spec)
    const layer = def.layer ?? 0
    const idle = spec.pose === 'fly' || def.air ? 'float' : spec.pose === 'sleep' ? 'breathe' : def.idle
    const cmds: Command[] = []
    this.run({ op: 'entity', id, name: spec.name || def.kind, x, y, scale: spec.size, idle, layer }, source, cmds)
    this.drawShapes(id, art.shapes, cmds)
    const companions: string[] = []
    if (art.front.length > 0) {
      const fid = `${id}_f`
      this.run({ op: 'entity', id: fid, name: `${def.kind} front`, x, y, scale: spec.size, idle: 'none', layer: Math.max(1, layer + 1) }, source, cmds)
      this.drawShapes(fid, art.front, cmds)
      companions.push(fid)
    }
    const flipped = spec.facing === 'left'
    if (flipped) for (const e of [id, ...companions]) cmds.push({ k: 'flip', id: e })
    const ent: KitEnt = { id, kind: def.kind, def, spec, companions, flipped, headFacing: art.headFacing, surface: art.surface ?? -def.height, hidden: false }
    if (art.seat) ent.seat = art.seat
    if (art.mouth) ent.mouth = art.mouth
    this.kits.set(id, ent)
    return { ok: true, cmds }
  }

  /** Paper point on top of `target` (a table top, a rock), or null. */
  private topOf(target: string): { x: number; y: number } | null {
    const snap = this.inner.snapshotData().entities.find((e) => e.id === target)
    if (!snap) return null
    const k = this.kits.get(target)
    const surface = k ? (k.seat?.y ?? k.surface) * k.spec.size : -120
    return { x: snap.x, y: Math.round(snap.y + surface) }
  }

  /** Paper point at `target`'s mouth (fire, a bite), and whether it faces left. */
  private mouthOf(target: string): { x: number; y: number; left: boolean } | null {
    const snap = this.inner.snapshotData().entities.find((e) => e.id === target)
    if (!snap) return null
    const k = this.kits.get(target)
    const m = k?.mouth ?? (k?.headFacing === 'right' ? { x: 80, y: -(k.def.height * 0.6) } : { x: 0, y: -((k?.def.height ?? 200) * 0.6) })
    const size = k?.spec.size ?? 1
    const left = k?.flipped ?? false
    return { x: Math.round(snap.x + (left ? -m.x : m.x) * size), y: Math.round(snap.y + m.y * size), left }
  }

  /** Paper point where an occupant of `container` stands, or null. */
  private seatOf(container: string): { x: number; y: number } | null {
    const c = this.kits.get(container)
    if (!c?.seat) return null
    const snap = this.inner.snapshotData().entities.find((e) => e.id === container)
    if (!snap) return null
    const sx = c.flipped ? -c.seat.x : c.seat.x
    return { x: Math.round(snap.x + sx * c.spec.size), y: Math.round(snap.y + c.seat.y * c.spec.size) }
  }

  /** Every shape of a subject in draw order (wear back, body, wear front, face, wear over) + container front. */
  private art(def: KitDef, id: string, spec: Spec): Art {
    const rng = rngFor(`${def.kind}:${id}`)
    let d: KitDrawing = def.build({ kind: def.kind, colors: spec.colors, mood: spec.mood, pose: spec.pose, wear: spec.wear, rng, eyes: spec.eyes })
    if (def.character && spec.pose === 'sleep' && d.head?.facing === 'front' && isUpright(def)) d = lieDown(d)
    const allWear = [...new Set([...roleWear(def.kind).map((w) => wearName(w)).filter((w): w is Wear => w !== null), ...spec.wear])]
    const wp = wearParts(allWear, d, spec.colors[3])
    const face = d.head && !d.noFace ? faceParts(d.head, spec.mood, spec.eyes) : []
    const out: Art = {
      shapes: [...wp.back, ...d.shapes, ...wp.front, ...face, ...wp.over],
      front: d.front ?? [],
      headFacing: d.head?.facing ?? 'front',
    }
    if (d.seat) out.seat = d.seat
    if (d.mouth) out.mouth = d.mouth
    if (d.surface !== undefined) out.surface = d.surface
    return out
  }

  private updateExisting(k: KitEnt, given: Partial<Spec>, nums: number[], source: string): DialectParse {
    const cmds: Command[] = []
    const prev = k.spec
    const spec: Spec = { ...prev, ...given }
    // Landing: a flier sent back to the ground stands up again.
    if (given.pose === undefined && prev.pose === 'fly' && nums[1] !== undefined && nums[1] >= this.standY - 5) spec.pose = 'stand'
    if (given.inside && given.pose === undefined) spec.pose = 'sit'
    k.spec = spec
    const snap = this.inner.snapshotData().entities.find((e) => e.id === k.id)
    let to: { x: number; y: number } | null = null
    if (given.inside && given.inside !== prev.inside) to = this.seatOf(given.inside)
    else if (snap && nums[0] !== undefined && Math.abs(nums[0] - snap.x) > 5) to = { x: nums[0], y: nums[1] ?? snap.y }
    else if (snap && nums[1] !== undefined && Math.abs(nums[1] - snap.y) > 5) to = { x: snap.x, y: nums[1] }
    const looks = JSON.stringify([prev.colors, prev.wear, prev.mood, prev.pose, prev.eyes]) !== JSON.stringify([spec.colors, spec.wear, spec.mood, spec.pose, spec.eyes])
    if (looks) {
      const art = this.art(k.def, k.id, spec)
      const res = this.inner.redrawRaw(k.id, art.shapes.map((s) => ({ ...s, entity: k.id })), source)
      if (!res.ok) return res
      cmds.push(...res.cmds)
    }
    if (to && k.hidden) {
      cmds.push({ k: 'layer', id: k.id, z: k.def.layer ?? 0 })
      k.hidden = false
    }
    let wait = 0
    if (to) {
      const style = spec.pose === 'fly' || to.y < 480 ? 'glide' : 'walk'
      this.run({ op: 'move', id: k.id, x: to.x, y: to.y, duration: 1.5, style }, source, cmds)
      for (const c of k.companions) this.run({ op: 'move', id: c, x: to.x, y: to.y, duration: 1.5, style: 'glide' }, source, cmds)
      // the stage turns a walker to face the way it goes
      if (snap && Math.abs(to.x - snap.x) > 4) k.flipped = to.x < snap.x
      wait = 1600
    }
    const wantLeft = given.facing === 'left' ? true : given.facing === 'right' ? false : k.flipped
    if (wantLeft !== k.flipped) {
      const flips: Command[] = [k.id, ...k.companions].map((e) => ({ k: 'flip', id: e }))
      if (wait > 0) this.clock.after(wait, () => this.inner.later?.(flips))
      else cmds.push(...flips)
      k.flipped = wantLeft
    }
    return { ok: true, cmds }
  }

  /* ---------- CURRENT PAGE ---------- */

  snapshot(): string {
    const snap = this.inner.snapshotData()
    const lines: string[] = [this.place ? this.place.desc : `(no place yet) bg ${colorName(snap.background)}`]
    const others = { ...snap, entities: [] as typeof snap.entities }
    for (const e of snap.entities) {
      if (this.backdrop.has(e.id)) continue
      const k = this.kits.get(e.id)
      if (k) {
        const sp = k.spec
        const top = Math.round(e.y - k.def.height * sp.size)
        const desc = [
          k.kind,
          k.id === k.kind ? '' : k.id,
          `${e.x} ${e.y}`,
          sp.colors.map((c) => colorName(c)).join(' '),
          sp.mood !== 'happy' ? sp.mood : '',
          sp.pose !== 'stand' ? sp.pose : '',
          k.flipped ? 'left' : '',
          sp.size !== 1 ? `s=${Math.round(sp.size * 100) / 100}` : '',
          sp.wear.length ? `wear=${sp.wear.join(',')}` : '',
          sp.inside ? `in=${sp.inside}` : '',
          sp.eyes !== 2 ? `eyes=${sp.eyes}` : '',
          sp.name ? `"${sp.name}"` : '',
        ]
        const m = k.mouth ? this.mouthOf(k.id) : null
        lines.push(`${desc.filter(Boolean).join(' ')} (top y=${top}${m ? `, mouth ${m.x} ${m.y}` : ''}${k.hidden ? ', hiding' : ''})`)
      } else if (!this.isCompanion(e.id)) others.entities.push(e)
    }
    if (others.entities.length > 0) lines.push(...describeScene(others).split('\n').slice(1))
    if (lines.length === 1) lines.push('(nothing drawn yet)')
    return lines.join('\n')
  }

  private isCompanion(id: string): boolean {
    for (const k of this.kits.values()) if (k.companions.includes(id)) return true
    return false
  }
}

const r1 = (n: number): number => Math.round(n * 10) / 10

const INK = '#3a2a24'

interface Art {
  shapes: KitShape[]
  front: KitShape[]
  seat?: { x: number; y: number }
  mouth?: { x: number; y: number }
  surface?: number
  headFacing: 'front' | 'right'
}

/** Eyes and mouth for a head (same layout and ids as src/engine/face.ts), any eye count, any mood. */
function faceParts(h: HeadAnchor, mood: Mood, eyes: number): KitShape[] {
  const w = h.r * 2
  const minX = h.cx - h.r
  const front = h.facing === 'front'
  const xs =
    eyes === 2
      ? front
        ? [minX + w * 0.35, minX + w * 0.65]
        : [minX + w * 0.5, minX + w * 0.74]
      : eyes === 1
        ? [front ? h.cx : minX + w * 0.62]
        : Array.from({ length: eyes }, (_, i) => minX + w * ((front ? 0.22 : 0.42) + ((front ? 0.56 : 0.44) * i) / (eyes - 1)))
  const out: KitShape[] = []
  if (mood === 'sleepy') {
    const ey = h.cy - h.r + w * 0.45
    const er = Math.max(5, w * 0.1)
    xs.forEach((ex, i) => out.push({ id: `${h.id}_eye${i}`, color: INK, path: [['M', r1(ex - er), r1(ey)], ['Q', r1(ex), r1(ey + er * 0.9), r1(ex + er), r1(ey)]] }))
    const mx = front ? h.cx : minX + w * 0.62
    out.push({ id: `${h.id}_mouth`, color: INK, circle: [r1(mx), r1(h.cy - h.r + w * 0.72), Math.max(3, r1(w * 0.05))] })
    return out
  }
  const ey = h.cy - h.r + w * 0.42
  const er = Math.max(4, w * 0.09) * (eyes > 2 ? 0.85 : 1)
  // Picture-book dot eyes: a solid dark oval and a white catchlight (the crayon line is too wide
  // for an outlined white eye at character scale; it closes up into a smudge).
  const big = mood === 'surprised' ? 1.2 : 1
  const look = h.facing === 'right' ? er * 0.25 : 0
  xs.forEach((ex, i) => {
    const cx = ex + look
    out.push({ id: `${h.id}_eye${i}`, color: '#2a2024', fill: '#2a2024', oval: [r1(cx), r1(ey), r1(er * 0.62 * big), r1(er * 0.8 * big)] })
    out.push({ id: `${h.id}_eye${i}_pupil`, color: '#ffffff', circle: [r1(cx + er * 0.22), r1(ey - er * 0.3), r1(Math.max(1, er * 0.08))] })
  })
  const expression = mood === 'angry' ? 'sad' : mood
  const mouth = faceShapes(h.id, { k: 'circle', cx: h.cx, cy: h.cy, r: h.r, color: INK, fill: false }, h.facing, expression, INK).find((p) => p.id.endsWith('_mouth'))
  const m = mouth ? engineToKit(mouth.id, mouth.shape) : null
  if (m) out.push(m)
  if (mood === 'angry') {
    const a = xs[0] ?? h.cx
    const b = xs[xs.length - 1] ?? h.cx
    out.push({ id: `${h.id}_brow0`, color: INK, path: [['M', r1(a - er * 1.4), r1(ey - er * 2.2)], ['L', r1(a + er * 1.2), r1(ey - er * 1.3)]] })
    out.push({ id: `${h.id}_brow1`, color: INK, path: [['M', r1(b + er * 1.4), r1(ey - er * 2.2)], ['L', r1(b - er * 1.2), r1(ey - er * 1.3)]] })
  }
  return out
}

/** big / huge scale to the page, not to the kind: a lone apple and a lone giraffe both fill it. */
function sizeWord(w: string, def: KitDef): number | null {
  const cap = 460 / def.height
  const fill = Math.min(cap, Math.max(1.15, Math.min(2.4, 340 / def.height)))
  if (w === 'big') return fill
  if (w === 'huge' || w === 'giant') return Math.min(2.6, cap * 1.1, fill * 1.25)
  return SIZE_WORDS[w] ?? null
}

/** People-like kinds lie down to sleep; animals curl up in their own builder. */
const isUpright = (def: KitDef): boolean => def.doc.includes('[skin]') || def.kind === 'alien' || def.kind === 'robot'

/** A face part from the engine helper (circle or simple path) as a kit shape. */
function engineToKit(id: string, s: Shape): KitShape | null {
  if (s.k === 'circle') return s.fill ? { id, color: s.color, fill: s.color, circle: [r1(s.cx), r1(s.cy), r1(s.r)] } : { id, color: s.color, circle: [r1(s.cx), r1(s.cy), r1(s.r)] }
  if (s.k !== 'path') return null
  const toks = s.d.match(/[MLQC]|-?\d*\.?\d+/g) ?? []
  const out: PathCmd[] = []
  let i = 0
  const n = (): number => Number(toks[i++] ?? 0)
  while (i < toks.length) {
    const c = toks[i++]
    if (c === 'M' || c === 'L') out.push([c, n(), n()])
    else if (c === 'Q') out.push(['Q', n(), n(), n(), n()])
    else if (c === 'C') out.push(['C', n(), n(), n(), n(), n(), n()])
  }
  return out.length >= 2 ? { id, color: s.color, path: out } : null
}

/** A front-facing character lying down (head to the left), resting on y=0, centered. */
function lieDown(d: KitDrawing): KitDrawing {
  const rot = -Math.PI / 2
  const shapes = xform(d.shapes, { rot })
  const e = extent(shapes)
  const dx = -(e.minX + e.maxX) / 2
  const dy = -e.maxY
  const t = { rot, dx, dy }
  const out: KitDrawing = { ...d, shapes: xform(d.shapes, t) }
  if (d.head) {
    const c = xform([{ id: 'h', color: '#000000', circle: [d.head.cx, d.head.cy, d.head.r] }], t)[0]
    if (c?.circle) out.head = { ...d.head, cx: c.circle[0], cy: c.circle[1] }
  }
  if (d.neck) {
    const n = xform([{ id: 'n', color: '#000000', circle: [d.neck.x, d.neck.y, 1] }], t)[0]
    if (n?.circle) out.neck = { x: n.circle[0], y: n.circle[1], w: d.neck.w }
  }
  return out
}

