/**
 * The kit's crayon box: the engine's names plus softer picture-book tones. The model may name any
 * of these (or #hex); defaults are chosen per subject to be harmonious.
 */
import { CRAYONS } from '~/engine/colors'
import type { KitParams } from './types'

export const KIT_COLORS: Record<string, string> = {
  ...CRAYONS,
  red: '#e8453c',
  orange: '#f59331',
  yellow: '#ffd23f',
  green: '#5cbf4a',
  darkgreen: '#2f8a45',
  blue: '#3b7ddd',
  skyblue: '#8fd0f5',
  purple: '#8b5fd0',
  pink: '#f79ac0',
  brown: '#9a6538',
  tan: '#e2bd88',
  gray: '#9a9aa4',
  white: '#fbf8f2',
  black: '#3a3437',
  lavender: '#c3a8ec',
  mint: '#9fe3c4',
  cream: '#fff1cf',
  coral: '#ff8a70',
  rose: '#ee6a8c',
  beige: '#ecd7b0',
  maroon: '#8f2d3a',
  olive: '#8a9a3c',
  turquoise: '#3cc4c0',
  violet: '#a45fd6',
  indigo: '#4b4fb0',
  lightblue: '#b8e2fb',
  lightgreen: '#b5e38a',
  darkblue: '#27427e',
  darkbrown: '#6a4122',
  golden: '#f2b52b',
  blonde: '#f3cf6b',
  ginger: '#d9713a',
  sand: '#f1d9a0',
}

/** Skin tones (seeded per character unless the model names one). */
export const SKINS = ['#f7c9a3', '#e9b48a', '#c98f62', '#a8704a', '#7d5236', '#f3d2b8']

const HEX = /^#([0-9a-f]{6})$/i
const HEX3 = /^#([0-9a-f]{3})$/i

export function kitColor(token: string): string | null {
  const t = token.toLowerCase()
  const named = KIT_COLORS[t]
  if (named) return named
  if (HEX.test(t)) return t
  const m = HEX3.exec(t)
  if (m?.[1]) {
    const [r = '0', g = '0', b = '0'] = m[1].split('')
    return `#${r}${r}${g}${g}${b}${b}`
  }
  return null
}

/** Color slot i, or the default. */
export function slot(p: KitParams, i: number, fallback: string): string {
  return p.colors[i] ?? kitColor(fallback) ?? fallback
}

export const C = (name: string): string => KIT_COLORS[name] ?? name
