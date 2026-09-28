import { CRAYONS, hexToRgb } from '~/engine/colors'

/**
 * The sketch crayon box: the app's crayons plus softer picture-book tones, one token each. The model
 * names ONE color per shape (the fill); the outline is derived from it by `inkFor`.
 */
export const SKETCH_COLORS: Record<string, string> = {
  ...CRAYONS,
  cream: '#fff1d2',
  lemon: '#ffe45c',
  coral: '#ff7a63',
  rose: '#f7a3b7',
  lavender: '#b89ae6',
  plum: '#7b3f78',
  mint: '#9ee3c0',
  grass: '#6cc24a',
  forest: '#2f7d3b',
  olive: '#8a9a3a',
  sky: '#a8d8f6',
  sand: '#efd9a2',
  rust: '#bf5a2c',
  chocolate: '#5e3a22',
  beige: '#e9d3b4',
  skin: '#f6c7a1',
  cocoa: '#9a6440',
  ink: '#2b2626',
  snow: '#ffffff',
}

const HEX_RE = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i

export function isSketchColor(token: string): boolean {
  return token.toLowerCase() in SKETCH_COLORS || HEX_RE.test(token)
}

export function sketchColor(token: string): string {
  const t = token.toLowerCase()
  const named = SKETCH_COLORS[t]
  if (named) return named
  if (HEX_RE.test(t)) {
    if (t.length === 4) return `#${t[1]}${t[1]}${t[2]}${t[2]}${t[3]}${t[3]}`
    return t
  }
  return '#2b2626'
}

/** Reverse lookup for describing the page back; crayon names win over aliases. */
export function sketchColorName(hex: string): string {
  const h = hex.toLowerCase()
  for (const [name, value] of Object.entries(SKETCH_COLORS)) {
    if (value.toLowerCase() === h && name !== 'grey' && name !== 'snow' && name !== 'ink') return name
  }
  return hex
}

function toHsl(hex: string): { h: number; s: number; l: number } {
  const { r, g, b } = hexToRgb(hex)
  const rn = r / 255
  const gn = g / 255
  const bn = b / 255
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const l = (max + min) / 2
  if (max === min) return { h: 0, s: 0, l }
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h: number
  if (max === rn) h = (gn - bn) / d + (gn < bn ? 6 : 0)
  else if (max === gn) h = (bn - rn) / d + 2
  else h = (rn - gn) / d + 4
  return { h: h / 6, s, l }
}

function fromHsl(h: number, s: number, l: number): string {
  const hue = (p: number, q: number, t0: number): number => {
    let t = t0
    if (t < 0) t += 1
    if (t > 1) t -= 1
    if (t < 1 / 6) return p + (q - p) * 6 * t
    if (t < 1 / 2) return q
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
    return p
  }
  let r: number
  let g: number
  let b: number
  if (s === 0) {
    r = g = b = l
  } else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s
    const p = 2 * l - q
    r = hue(p, q, h + 1 / 3)
    g = hue(p, q, h)
    b = hue(p, q, h - 1 / 3)
  }
  const x = (v: number): string =>
    Math.round(Math.max(0, Math.min(1, v)) * 255)
      .toString(16)
      .padStart(2, '0')
  return `#${x(r)}${x(g)}${x(b)}`
}

/**
 * The outline crayon for a fill: the same hue, much darker and a little richer, the way a child
 * outlines a pink pig in a deeper pink. Near-white fills get a warm gray; near-black stays black.
 */
export function inkFor(fill: string): string {
  const { h, s, l } = toHsl(fill)
  const { r, g, b } = hexToRgb(fill)
  // Chroma, not HSL saturation: near white, HSL calls a faint cream "56% saturated".
  const chroma = (Math.max(r, g, b) - Math.min(r, g, b)) / 255
  if (l < 0.22) return '#1f1a1a'
  if (chroma < 0.1 && l > 0.75) return '#8f8578'
  if (chroma < 0.1) return fromHsl(h, s, l * 0.45)
  return fromHsl(h, Math.min(1, s * 1.05 + 0.08), Math.max(0.16, l * 0.48))
}
