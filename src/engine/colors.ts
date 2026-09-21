// The crayon box. Names are 1 token each for the model; values tuned to look like wax on cream paper.
export const CRAYONS: Record<string, string> = {
  red: '#e63b2e',
  orange: '#f4832a',
  yellow: '#f7c531',
  green: '#3faa4a',
  darkgreen: '#237a37',
  lime: '#9ccf3c',
  blue: '#2f6fd6',
  skyblue: '#63b5ec',
  navy: '#22407a',
  teal: '#2aa8a0',
  purple: '#7d4fc4',
  pink: '#f27bb4',
  magenta: '#d63a9a',
  brown: '#8a5a33',
  tan: '#d9b27c',
  peach: '#f6b48f',
  gold: '#e6a924',
  black: '#2b2626',
  gray: '#8b8b8b',
  grey: '#8b8b8b',
  white: '#fdfcf8',
  silver: '#c0c4c9',
}

export const CRAYON_NAMES = Object.keys(CRAYONS).filter((n) => n !== 'grey')

const HEX_RE = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i

/** Resolve a color token from the DSL to a hex string. Unknown names fall back to black. */
export function resolveColor(token: string): string {
  const t = token.toLowerCase()
  const named = CRAYONS[t]
  if (named) return named
  if (HEX_RE.test(t)) {
    if (t.length === 4) {
      const r = t[1] ?? '0'
      const g = t[2] ?? '0'
      const b = t[3] ?? '0'
      return `#${r}${r}${g}${g}${b}${b}`
    }
    return t
  }
  return '#2b2626'
}

export function isColorToken(token: string): boolean {
  return token.toLowerCase() in CRAYONS || HEX_RE.test(token)
}

/** Reverse lookup for the scene summary sent back to the model. */
export function colorName(hex: string): string {
  for (const [name, value] of Object.entries(CRAYONS)) {
    if (value === hex && name !== 'grey') return name
  }
  return hex
}

export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const n = parseInt(hex.slice(1), 16)
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }
}

export function darken(hex: string, amt: number): string {
  const { r, g, b } = hexToRgb(hex)
  const f = (v: number) => Math.max(0, Math.min(255, Math.round(v * (1 - amt))))
  return `rgb(${f(r)},${f(g)},${f(b)})`
}
