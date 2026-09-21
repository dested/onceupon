import {
  ANIM_KINDS,
  FX_KINDS,
  type AnimKind,
  type Command,
  type FxKind,
  type ParseResult,
  type Vec,
} from './types'
import { isColorToken, resolveColor } from './colors'
import { STAMP_NAMES, isStampName } from './stamps'
import { cleanText } from '~/story/clean'

const isAnim = (s: string): s is AnimKind => (ANIM_KINDS as readonly string[]).includes(s)
const isFx = (s: string): s is FxKind => (FX_KINDS as readonly string[]).includes(s)

function num(tok: string | undefined): number | null {
  if (tok === undefined) return null
  const n = Number(tok)
  return Number.isFinite(n) ? n : null
}

function nums(toks: string[], count: number): number[] | null {
  if (toks.length < count) return null
  const out: number[] = []
  for (let i = 0; i < count; i++) {
    const n = num(toks[i])
    if (n === null) return null
    out.push(n)
  }
  return out
}

/** Strips a trailing `o` (outline-only) token. */
function takeOutline(toks: string[]): { toks: string[]; fill: boolean } {
  if (toks.length > 0 && toks[toks.length - 1] === 'o') return { toks: toks.slice(0, -1), fill: false }
  return { toks, fill: true }
}

function err(error: string): ParseResult {
  return { ok: false, error }
}
function ok(cmd: Command): ParseResult {
  return { ok: true, cmd }
}
function unquote(s: string): string {
  return s.replace(/^["']|["']$/g, '')
}

const ID_RE = /^[a-z][a-z0-9_-]*$/i

/** Parse one line of crayon DSL. Blank lines and `#` comments parse to a null command. */
export function parseLine(raw: string): ParseResult {
  const line = raw.replace(/[`,;]/g, ' ').trim()
  if (line === '' || line.startsWith('#') || line.startsWith('//')) return { ok: true, cmd: null }
  const toks = line.split(/\s+/)
  const verb = (toks[0] ?? '').toLowerCase()
  const rest = toks.slice(1)

  switch (verb) {
    case 'obj': {
      const id = rest[0]
      const xy = nums(rest.slice(1), 2)
      if (!id || !ID_RE.test(id) || !xy) return err(`obj needs: obj <id> <x> <y> - got "${line}"`)
      return ok({ k: 'obj', id: id.toLowerCase(), x: xy[0] ?? 0, y: xy[1] ?? 0 })
    }
    case 'end':
      return ok({ k: 'end' })

    case 'c': {
      const { toks: t, fill } = takeOutline(rest)
      const n = nums(t, 3)
      const color = t[3]
      if (!n || !color) return err(`c needs: c <cx> <cy> <r> <color> [o] - got "${line}"`)
      return ok({
        k: 'shape',
        shape: { k: 'circle', cx: n[0] ?? 0, cy: n[1] ?? 0, r: Math.abs(n[2] ?? 1), color: resolveColor(color), fill },
      })
    }
    case 'e': {
      const { toks: t, fill } = takeOutline(rest)
      const n = nums(t, 4)
      const color = t[4]
      if (!n || !color) return err(`e needs: e <cx> <cy> <rx> <ry> <color> [o] - got "${line}"`)
      return ok({
        k: 'shape',
        shape: {
          k: 'ellipse',
          cx: n[0] ?? 0,
          cy: n[1] ?? 0,
          rx: Math.abs(n[2] ?? 1),
          ry: Math.abs(n[3] ?? 1),
          color: resolveColor(color),
          fill,
        },
      })
    }
    case 'r': {
      const { toks: t, fill } = takeOutline(rest)
      const n = nums(t, 4)
      const color = t[4]
      if (!n || !color) return err(`r needs: r <x> <y> <w> <h> <color> [o] - got "${line}"`)
      return ok({
        k: 'shape',
        shape: { k: 'rect', x: n[0] ?? 0, y: n[1] ?? 0, w: n[2] ?? 1, h: n[3] ?? 1, color: resolveColor(color), fill },
      })
    }
    case 'l': {
      const n = nums(rest, 4)
      const color = rest[4]
      if (!n || !color) return err(`l needs: l <x1> <y1> <x2> <y2> <color> - got "${line}"`)
      return ok({
        k: 'shape',
        shape: { k: 'line', x1: n[0] ?? 0, y1: n[1] ?? 0, x2: n[2] ?? 0, y2: n[3] ?? 0, color: resolveColor(color) },
      })
    }
    case 'p':
    case 'pl': {
      const color = rest[0]
      if (!color) return err(`${verb} needs a color first - got "${line}"`)
      let t = rest.slice(1)
      let fill = verb === 'p'
      if (t[0] === 'o') {
        fill = false
        t = t.slice(1)
      }
      const flat = nums(t, t.length)
      if (!flat || flat.length < 4 || flat.length % 2 !== 0) {
        return err(`${verb} needs an even list of at least 2 points - got "${line}"`)
      }
      const pts: Vec[] = []
      for (let i = 0; i < flat.length; i += 2) pts.push({ x: flat[i] ?? 0, y: flat[i + 1] ?? 0 })
      return ok({ k: 'shape', shape: { k: 'poly', pts, color: resolveColor(color), fill, closed: verb === 'p' } })
    }
    case 'path': {
      const color = rest[0]
      if (!color) return err(`path needs a color first - got "${line}"`)
      let t = rest.slice(1)
      let fill = true
      if (t[0] === 'o') {
        fill = false
        t = t.slice(1)
      }
      const d = t.join(' ')
      if (!/^[mM]/.test(d)) return err(`path data must start with M - got "${line}"`)
      return ok({ k: 'shape', shape: { k: 'path', d, color: resolveColor(color), fill } })
    }
    case 't': {
      const n = nums(rest, 3)
      const color = rest[3]
      const text = cleanText(unquote(rest.slice(4).join(' ')))
      if (!n || !color || !text) return err(`t needs: t <x> <y> <size> <color> <text> - got "${line}"`)
      return ok({
        k: 'shape',
        shape: { k: 'text', x: n[0] ?? 0, y: n[1] ?? 0, size: n[2] ?? 6, color: resolveColor(color), text },
      })
    }
    case 's': {
      const name = (rest[0] ?? '').toLowerCase()
      const n = nums(rest.slice(1), 3)
      const colorTok = rest[4]
      // Models sometimes stamp an effect name ("s stars 30 25 8"); treat that as fx.
      if (isFx(name) && n) return ok({ k: 'fx', kind: name, x: n[0] ?? 0, y: n[1] ?? 0, size: n[2] ?? 12 })
      if (!isStampName(name) || !n) {
        return err(`s needs: s <${STAMP_NAMES.join('|')}> <x> <y> <size> [color] - got "${line}"`)
      }
      return ok({
        k: 'stamp',
        name,
        x: n[0] ?? 0,
        y: n[1] ?? 0,
        size: Math.abs(n[2] ?? 10),
        color: colorTok && isColorToken(colorTok) ? resolveColor(colorTok) : undefined,
      })
    }

    case 'mv': {
      const id = rest[0]
      if (!id) return err(`mv needs an id - got "${line}"`)
      const target = rest[1]
      if (target && target.startsWith('@')) {
        const ref = target.slice(1).toLowerCase()
        const n = nums(rest.slice(2), rest.length - 2) ?? []
        // `mv a @b 2` = next to b over 2s. `mv a @b 20 0 2` = offset (20,0) from b over 2s.
        if (n.length >= 2) {
          return ok({ k: 'mv', id: id.toLowerCase(), to: { kind: 'ref', ref, dx: n[0] ?? 0, dy: n[1] ?? 0 }, secs: n[2] ?? 1.5 })
        }
        return ok({ k: 'mv', id: id.toLowerCase(), to: { kind: 'ref', ref, dx: 0, dy: 0 }, secs: n[0] ?? 1.5 })
      }
      const n = nums(rest.slice(1), 2)
      if (!n) return err(`mv needs: mv <id> <x> <y> [secs] or mv <id> @<other> [dx dy] [secs] - got "${line}"`)
      const secs = num(rest[3]) ?? 1.5
      return ok({ k: 'mv', id: id.toLowerCase(), to: { kind: 'abs', x: n[0] ?? 0, y: n[1] ?? 0 }, secs })
    }
    case 'sc': {
      const id = rest[0]
      const factor = num(rest[1])
      if (!id || factor === null) return err(`sc needs: sc <id> <factor> [secs] - got "${line}"`)
      return ok({ k: 'sc', id: id.toLowerCase(), factor: Math.max(0.05, factor), secs: num(rest[2]) ?? 1 })
    }
    case 'flip': {
      const id = rest[0]
      if (!id) return err('flip needs an id')
      return ok({ k: 'flip', id: id.toLowerCase() })
    }
    case 'rm': {
      const id = rest[0]
      if (!id) return err('rm needs an id')
      return ok({ k: 'rm', id: id.toLowerCase() })
    }
    case 'anim': {
      const id = rest[0]
      const kind = (rest[1] ?? '').toLowerCase()
      if (!id || !isAnim(kind)) return err(`anim needs: anim <id> <${ANIM_KINDS.join('|')}> - got "${line}"`)
      return ok({ k: 'anim', id: id.toLowerCase(), kind })
    }
    case 'fx': {
      const kind = (rest[0] ?? '').toLowerCase()
      const n = nums(rest.slice(1), 2)
      if (!isFx(kind) || !n) return err(`fx needs: fx <${FX_KINDS.join('|')}> <x> <y> [size] - got "${line}"`)
      return ok({ k: 'fx', kind, x: n[0] ?? 0, y: n[1] ?? 0, size: num(rest[3]) ?? 12 })
    }
    case 'say': {
      const id = rest[0]
      const text = cleanText(unquote(rest.slice(1).join(' ')))
      if (!id || !text) return err(`say needs: say <id> <text> - got "${line}"`)
      return ok({ k: 'say', id: id.toLowerCase(), text })
    }
    case 'bg': {
      const sky = rest[0]
      if (!sky) return err('bg needs: bg <sky> [ground]')
      const ground = rest[1]
      return ok({ k: 'bg', sky: resolveColor(sky), ground: ground ? resolveColor(ground) : undefined })
    }
    case 'page':
      return ok({ k: 'page', title: unquote(rest.join(' ')) })
    case 'skip':
      return ok({ k: 'skip' })
    default:
      return err(`unknown verb "${verb}" in "${line}"`)
  }
}
