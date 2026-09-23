import { colorName, isColorToken, resolveColor } from '~/engine/colors'
import type { Scene } from '~/engine/scene'
import { isStampName } from '~/engine/stamps'
import type { Command } from '~/engine/types'
import type { Dialect, DialectInput, DialectOptions, DialectParse } from './dialect'
import {
  DEFAULT_BACKGROUND,
  JsonDialect,
  OPS_VOCAB,
  type PathCmd,
  type SceneSnapshot,
} from './json-dsl'
import { buildOpsUserBlocks, OPS_SYSTEM_PROMPT, OPS_SYSTEM_PROMPT_UNMODERATED } from './ops-prompt'
import type { PromptBlock } from './providers'

/*
 * The ops dialect: the JSON operations contract with a terse one-line-per-op syntax.
 *
 *   ent <id> <x> <y> ["name"] [idle=..] [layer=..] [scale=..]
 *   draw <ent>.<shape> <outline> [<fill>] [mirror] [w=..] <geometry>
 *     geometry: M .. L .. Q .. C .. Z | circle cx cy r | oval cx cy rx ry | rect x y w h | poly x y .. | stamp <name> x y size
 *   face <ent> [<head>] [front|left|right] [happy|surprised|sad]
 *   move <ent> <x> <y> [secs] [glide|walk|hop]
 *   pose <ent> <shake|jump|spin|celebrate> [secs]
 *   recolor <ent> [<from>] <to>
 *   fx <kind> <x> <y> [size] [color]
 *   rm <ent>
 *   say <ent> <words...>
 *   scene [<color>] [clear] [keep=a,b] ["title"]
 *   skip
 *
 * Every line becomes the same untyped operation the JSON dialect validates, so ranges, defaults
 * and behavior are identical; only the wire form differs.
 */

export type OpsLineParse = { ok: true; op: unknown | null } | { ok: false; error: string }

interface Tok {
  text: string
  quoted: boolean
}

/** Split a line on whitespace, keeping "quoted strings" as one token. */
function tokenize(line: string): Tok[] {
  const out: Tok[] = []
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(line)) !== null) {
    if (m[1] !== undefined) out.push({ text: m[1], quoted: true })
    else if (m[2] !== undefined) out.push({ text: m[2], quoted: true })
    else if (m[3] !== undefined) out.push({ text: m[3], quoted: false })
  }
  return out
}

const NUM_RE = /^[-+]?(\d+\.?\d*|\.\d+)$/
const isNum = (t: Tok): boolean => !t.quoted && NUM_RE.test(t.text)
const toNum = (t: Tok): number => Number(t.text)
const isColor = (t: Tok): boolean => !t.quoted && isColorToken(t.text)
const isKv = (t: Tok): boolean => !t.quoted && /^[a-z]+=/i.test(t.text)
const has = <T extends string>(list: readonly T[], s: string): s is T =>
  (list as readonly string[]).includes(s)

function splitKv(t: Tok): [string, string] {
  const i = t.text.indexOf('=')
  return [t.text.slice(0, i).toLowerCase(), t.text.slice(i + 1)]
}

function numKv(v: string, key: string): number {
  const n = Number(v)
  if (!Number.isFinite(n)) throw new Error(`${key} needs a number, got "${v}"`)
  return n
}

/* ---------- path text -> PathCmd[] ---------- */

const ARITY: Record<string, number> = { M: 2, L: 2, Q: 4, C: 6, Z: 0, H: 1, V: 1 }

/** SVG-ish path text (absolute or relative, commas or spaces) -> absolute M/L/Q/C/Z commands. */
function parsePath(text: string): PathCmd[] {
  const toks = text.match(/[MLQCZHVmlqczhv]|[-+]?(?:\d+\.?\d*|\.\d+)/g) ?? []
  const out: PathCmd[] = []
  let cmd = ''
  let i = 0
  let cx = 0
  let cy = 0
  let sx = 0
  let sy = 0
  const take = (): number => {
    const t = toks[i++]
    if (t === undefined || !NUM_RE.test(t)) throw new Error(`path: ${cmd} is missing numbers`)
    return Number(t)
  }
  while (i < toks.length) {
    const t = toks[i] ?? ''
    if (/^[A-Za-z]$/.test(t)) {
      cmd = t
      i++
    } else if (!cmd) {
      throw new Error('path must start with M')
    } else if (cmd === 'M') cmd = 'L'
    else if (cmd === 'm') cmd = 'l'
    const upper = cmd.toUpperCase()
    const rel = cmd !== upper
    const ox = rel ? cx : 0
    const oy = rel ? cy : 0
    if (!(upper in ARITY)) throw new Error(`path: unsupported command ${cmd} (use M L Q C Z)`)
    switch (upper) {
      case 'M':
      case 'L': {
        const x = take() + ox
        const y = take() + oy
        out.push([upper, x, y])
        cx = x
        cy = y
        if (upper === 'M') {
          sx = x
          sy = y
        }
        break
      }
      case 'H': {
        const x = take() + ox
        out.push(['L', x, cy])
        cx = x
        break
      }
      case 'V': {
        const y = take() + oy
        out.push(['L', cx, y])
        cy = y
        break
      }
      case 'Q': {
        const c1x = take() + ox
        const c1y = take() + oy
        const x = take() + ox
        const y = take() + oy
        out.push(['Q', c1x, c1y, x, y])
        cx = x
        cy = y
        break
      }
      case 'C': {
        const c1x = take() + ox
        const c1y = take() + oy
        const c2x = take() + ox
        const c2y = take() + oy
        const x = take() + ox
        const y = take() + oy
        out.push(['C', c1x, c1y, c2x, c2y, x, y])
        cx = x
        cy = y
        break
      }
      case 'Z':
        out.push(['Z'])
        cx = sx
        cy = sy
        cmd = ''
        break
    }
  }
  return out
}

/* ---------- one line -> untyped operation ---------- */

const GEOMETRY_WORDS = ['circle', 'oval', 'rect', 'poly', 'stamp'] as const
const isPathStart = (t: Tok | undefined): boolean =>
  t !== undefined && !t.quoted && /^[Mm]([-+.\d,]|$)/.test(t.text)

function parseDraw(rest: Tok[], line: string): unknown {
  const target = rest[0]
  if (!target) throw new Error('draw needs entity.shape')
  let entity: string
  let shapeId: string
  let i = 1
  const dot = target.text.indexOf('.')
  if (dot > 0) {
    entity = target.text.slice(0, dot)
    shapeId = target.text.slice(dot + 1)
  } else {
    const second = rest[1]
    if (!second || isColor(second)) throw new Error('draw needs entity.shape (bunny.head)')
    entity = target.text
    shapeId = second.text
    i = 2
  }
  const shape: Record<string, unknown> = { id: shapeId, entity }
  const outline = rest[i]
  if (!outline || !isColor(outline))
    throw new Error(`draw needs a color after ${entity}.${shapeId}`)
  shape.color = resolveColor(outline.text)
  i++
  const fillTok = rest[i]
  if (fillTok && isColor(fillTok)) {
    shape.fill = resolveColor(fillTok.text)
    i++
  }
  // flags and k=v until the geometry
  while (i < rest.length) {
    const t = rest[i]
    if (!t) break
    const word = t.text.toLowerCase()
    if (!t.quoted && word === 'mirror') {
      shape.mirror = true
      i++
      continue
    }
    if (isKv(t)) {
      const [k, v] = splitKv(t)
      if (k === 'w' || k === 'width') shape.width = numKv(v, 'width')
      else if (k === 'motion') shape.motion = v
      else if (k === 'pivot') shape.pivot = v.split(',').map((s) => numKv(s, 'pivot'))
      else if (k === 'fill') shape.fill = resolveColor(v)
      else if (k === 'mirror') shape.mirror = v !== 'false' && v !== '0'
      else throw new Error(`draw: unknown option ${k}`)
      i++
      continue
    }
    break
  }
  const g = rest[i]
  if (!g) throw new Error('draw needs a geometry: M.. path, circle, oval, rect, poly or stamp')
  const gw = g.text.toLowerCase()
  const nums = (from: number, count: number, what: string): number[] => {
    const out: number[] = []
    for (let k = 0; k < count; k++) {
      const t = rest[from + k]
      if (!t || !isNum(t)) throw new Error(`${what} needs ${count} numbers`)
      out.push(toNum(t))
    }
    return out
  }
  if (!g.quoted && has(GEOMETRY_WORDS, gw)) {
    switch (gw) {
      case 'circle':
        shape.circle = nums(i + 1, 3, 'circle cx cy r')
        break
      case 'oval':
        shape.oval = nums(i + 1, 4, 'oval cx cy rx ry')
        break
      case 'rect':
        shape.rect = nums(i + 1, 4, 'rect x y w h')
        break
      case 'poly': {
        const pts: number[] = []
        for (let k = i + 1; k < rest.length; k++) {
          const t = rest[k]
          // A poly is always closed; models sometimes end one with a path-style Z. Accept it.
          if (t && k === rest.length - 1 && /^z$/i.test(t.text)) break
          if (!t || !isNum(t)) throw new Error('poly takes only numbers')
          pts.push(toNum(t))
        }
        if (pts.length < 6 || pts.length % 2 !== 0)
          throw new Error('poly needs at least 3 x y pairs')
        shape.poly = pts
        break
      }
      case 'stamp': {
        const name = rest[i + 1]
        if (!name || !isStampName(name.text.toLowerCase()))
          throw new Error(`stamp needs a known name, got "${name?.text ?? ''}"`)
        const [x, y, size] = nums(i + 2, 3, 'stamp name x y size')
        shape.stamp = { name: name.text.toLowerCase(), x, y, size }
        break
      }
    }
    return { op: 'draw', shape }
  }
  if (!isPathStart(g))
    throw new Error(
      `draw: expected a path starting with M or circle/oval/rect/poly/stamp, got "${g.text}" in ${line.slice(0, 60)}`
    )
  shape.path = parsePath(
    rest
      .slice(i)
      .map((t) => t.text)
      .join(' ')
  )
  return { op: 'draw', shape }
}

/** Parse one line of the ops dialect into an untyped operation (validated by the JSON schema). */
export function parseOpsLine(raw: string): OpsLineParse {
  const line = raw
    .trim()
    .replace(/^```\w*/, '')
    .replace(/```$/, '')
    .trim()
  if (!line || line.startsWith('#') || line.startsWith('//')) return { ok: true, op: null }
  const toks = tokenize(line)
  const verbTok = toks[0]
  if (!verbTok) return { ok: true, op: null }
  const verb = verbTok.text.toLowerCase()
  const rest = toks.slice(1)
  const id = (i: number, what: string): string => {
    const t = rest[i]
    if (!t || t.quoted || isNum(t)) throw new Error(`${what} needs an entity id`)
    return t.text
  }
  try {
    switch (verb) {
      case 'skip':
        return { ok: true, op: { op: 'skip' } }

      case 'ent':
      case 'entity': {
        const eid = id(0, 'ent')
        const x = rest[1]
        const y = rest[2]
        if (!x || !y || !isNum(x) || !isNum(y)) throw new Error('ent needs: ent <id> <x> <y>')
        const op: Record<string, unknown> = { op: 'entity', id: eid, x: toNum(x), y: toNum(y) }
        const nameWords: string[] = []
        for (const t of rest.slice(3)) {
          if (isKv(t)) {
            const [k, v] = splitKv(t)
            if (k === 'idle') op.idle = v.toLowerCase()
            else if (k === 'layer') op.layer = numKv(v, 'layer')
            else if (k === 'scale') op.scale = numKv(v, 'scale')
            else if (k === 'name') op.name = v
            else throw new Error(`ent: unknown option ${k}`)
          } else nameWords.push(t.text)
        }
        if (op.name === undefined) op.name = nameWords.length > 0 ? nameWords.join(' ') : eid
        return { ok: true, op }
      }

      case 'draw':
        return { ok: true, op: parseDraw(rest, line) }

      case 'face': {
        const eid = id(0, 'face')
        const op: Record<string, unknown> = { op: 'face', id: eid, head: 'head' }
        for (const t of rest.slice(1)) {
          const w = t.text.toLowerCase()
          if (has(OPS_VOCAB.facing, w)) op.facing = w
          else if (has(OPS_VOCAB.expression, w)) op.expression = w
          else if (isKv(t)) {
            const [k, v] = splitKv(t)
            op[k] = v.toLowerCase()
          } else op.head = t.text
        }
        return { ok: true, op }
      }

      case 'move':
      case 'mv': {
        const eid = id(0, 'move')
        const x = rest[1]
        const y = rest[2]
        if (!x || !y || !isNum(x) || !isNum(y))
          throw new Error('move needs: move <id> <x> <y> [secs] [glide|walk|hop]')
        const op: Record<string, unknown> = { op: 'move', id: eid, x: toNum(x), y: toNum(y) }
        for (const t of rest.slice(3)) {
          const w = t.text.toLowerCase()
          if (isNum(t)) op.duration = toNum(t)
          else if (has(OPS_VOCAB.moveStyle, w)) op.style = w
          else throw new Error(`move: unexpected "${t.text}"`)
        }
        return { ok: true, op }
      }

      case 'pose': {
        const eid = id(0, 'pose')
        const action = rest[1]?.text.toLowerCase() ?? ''
        if (!has(OPS_VOCAB.pose, action))
          throw new Error(`pose needs one of ${OPS_VOCAB.pose.join('|')}`)
        const op: Record<string, unknown> = { op: 'pose', id: eid, action }
        const secs = rest[2]
        if (secs && isNum(secs)) op.duration = toNum(secs)
        return { ok: true, op }
      }

      case 'recolor':
      case 'color': {
        const eid = id(0, 'recolor')
        const a = rest[1]
        const b = rest[2]
        if (!a || !isColor(a)) throw new Error('recolor needs: recolor <id> [<from>] <to>')
        const op: Record<string, unknown> = { op: 'recolor', id: eid }
        if (b && isColor(b)) {
          op.from = resolveColor(a.text)
          op.color = resolveColor(b.text)
        } else op.color = resolveColor(a.text)
        return { ok: true, op }
      }

      case 'fx':
      case 'effect': {
        const kind = rest[0]?.text.toLowerCase() ?? ''
        if (!has(OPS_VOCAB.effect, kind))
          throw new Error(`fx needs one of ${OPS_VOCAB.effect.join('|')}`)
        const x = rest[1]
        const y = rest[2]
        if (!x || !y || !isNum(x) || !isNum(y))
          throw new Error('fx needs: fx <kind> <x> <y> [size] [color]')
        const op: Record<string, unknown> = { op: 'effect', kind, x: toNum(x), y: toNum(y) }
        for (const t of rest.slice(3)) {
          if (isNum(t)) op.size = toNum(t)
          else if (isColor(t)) op.color = resolveColor(t.text)
          else throw new Error(`fx: unexpected "${t.text}"`)
        }
        return { ok: true, op }
      }

      case 'rm':
      case 'remove':
        return { ok: true, op: { op: 'remove', id: id(0, 'rm') } }

      case 'say': {
        const eid = id(0, 'say')
        const after = line.slice(line.indexOf(eid) + eid.length).trim()
        const text = after.replace(/^["'](.*)["']$/, '$1').trim()
        if (!text) throw new Error('say needs words')
        return { ok: true, op: { op: 'say', id: eid, text } }
      }

      case 'scene':
      case 'page': {
        const op: Record<string, unknown> = { op: 'scene' }
        const titleWords: string[] = []
        for (const t of rest) {
          const w = t.text.toLowerCase()
          if (t.quoted) titleWords.push(t.text)
          else if (w === 'clear') op.clear = true
          else if (isColor(t)) op.background = resolveColor(t.text)
          else if (isKv(t)) {
            const [k, v] = splitKv(t)
            if (k === 'keep') op.keep = v.split(',').filter(Boolean)
            else if (k === 'bg' || k === 'background') op.background = resolveColor(v)
            else if (k === 'title') titleWords.push(v)
            else if (k === 'clear') op.clear = v !== 'false' && v !== '0'
            else throw new Error(`scene: unknown option ${k}`)
          } else titleWords.push(t.text)
        }
        if (titleWords.length > 0) op.title = titleWords.join(' ')
        return { ok: true, op }
      }

      default:
        return { ok: false, error: `unknown op "${verb}" in ${line.slice(0, 60)}` }
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { ok: false, error: `${msg} in ${line.slice(0, 80)}` }
  }
}

/* ---------- the scene, described back in the same syntax ---------- */

const FACE_PART_RE = /^(.+)_(eye\d+w?|eye\d+_pupil|mouth)$/

/** The page as ops-style lines: what exists, where, which shape ids and colors. */
export function describeScene(s: SceneSnapshot): string {
  const lines: string[] = [
    `page ${s.page}${s.title ? ` "${s.title}"` : ''} bg ${colorName(s.background)}`,
  ]
  for (const e of s.entities) {
    const bits = [`ent ${e.id} ${e.x} ${e.y}`]
    if (e.name !== e.id) bits.push(`"${e.name}"`)
    if (e.idle !== 'none') bits.push(`idle=${e.idle}`)
    if (e.layer !== 0) bits.push(`layer=${e.layer}`)
    if (e.scale !== 1) bits.push(`scale=${Math.round(e.scale * 100) / 100}`)
    if (e.facing === 'left') bits.push('facing=left')
    const parts: string[] = []
    const faces = new Set<string>()
    for (const sh of e.shapes) {
      const fm = FACE_PART_RE.exec(sh.id)
      if (fm?.[1]) {
        faces.add(fm[1])
        continue
      }
      parts.push(`${sh.id} ${colorName(sh.color)}${sh.fill ? `/${colorName(sh.fill)}` : ''}`)
    }
    for (const head of faces) parts.push(`face(${head})`)
    lines.push(parts.length > 0 ? `${bits.join(' ')} | ${parts.join(', ')}` : bits.join(' '))
  }
  if (s.entities.length === 0) lines.push('(empty page)')
  return lines.join('\n')
}

/** The terse ops dialect: same operations as JSON, one short line each. */
export class OpsDialect implements Dialect {
  readonly id = 'ops' as const
  readonly system: string
  readonly maxTokens = 1600
  private inner: JsonDialect

  constructor(scene: Scene, opts: DialectOptions) {
    this.inner = new JsonDialect(scene, opts)
    this.system = opts.moderation ? OPS_SYSTEM_PROMPT : OPS_SYSTEM_PROMPT_UNMODERATED
  }

  get later(): ((cmds: Command[]) => void) | null {
    return this.inner.later
  }
  set later(fn: ((cmds: Command[]) => void) | null) {
    this.inner.later = fn
  }

  buildUser(input: DialectInput): PromptBlock[] {
    return buildOpsUserBlocks({
      storyChunks: input.storyChunks,
      scene: this.snapshot(),
      newWords: input.newWords,
    })
  }

  parse(line: string): DialectParse {
    const res = parseOpsLine(line)
    if (!res.ok) return res
    if (res.op === null) return { ok: true, cmds: [] }
    return this.inner.applyRaw(res.op, line)
  }

  isSkip(line: string): boolean {
    return /^skip\b/i.test(line.trim())
  }

  reset(): void {
    this.inner.reset()
  }

  /** The scene in ops syntax, for the model and for the debug panel. */
  snapshot(): string {
    return describeScene(this.inner.snapshotData())
  }
}

export { DEFAULT_BACKGROUND }
