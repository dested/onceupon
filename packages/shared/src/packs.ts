/** Minute packs: the only things for sale. Prices are in US cents; Apple prices are set in App Store Connect to match. */
export type PackId = 'pack_40' | 'pack_120' | 'pack_400'

export interface Pack {
  id: PackId
  name: string
  blurb: string
  minutes: number
  seconds: number
  priceCents: number
  appleProductId: string
  /** The visual default on the paywall. */
  featured: boolean
}

export const PACKS: readonly Pack[] = [
  {
    id: 'pack_40',
    name: 'Story pack',
    blurb: 'About eight stories',
    minutes: 40,
    seconds: 2400,
    priceCents: 999,
    appleProductId: 'com.quickgame.squiggletale.pack40',
    featured: false,
  },
  {
    id: 'pack_120',
    name: 'Big pack',
    blurb: 'For a house full of storytellers',
    minutes: 120,
    seconds: 7200,
    priceCents: 1999,
    appleProductId: 'com.quickgame.squiggletale.pack120',
    featured: true,
  },
  {
    id: 'pack_400',
    name: 'Family pack',
    blurb: 'Road trips and gifts',
    minutes: 400,
    seconds: 24000,
    priceCents: 3999,
    appleProductId: 'com.quickgame.squiggletale.pack400',
    featured: false,
  },
]

export const PACK_IDS: readonly PackId[] = ['pack_40', 'pack_120', 'pack_400']

export function isPackId(s: string): s is PackId {
  return (PACK_IDS as readonly string[]).includes(s)
}

export function packById(id: PackId): Pack {
  const p = PACKS.find((x) => x.id === id)
  if (!p) throw new Error(`unknown pack ${id}`)
  return p
}

export function packByAppleProductId(productId: string): Pack | null {
  return PACKS.find((x) => x.appleProductId === productId) ?? null
}

/** "17¢ a minute" */
export function centsPerMinute(p: Pack): number {
  return Math.round(p.priceCents / p.minutes)
}

export function formatUsd(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`
}

/** Server flag defaults for the free allowance; the admin portal can change them without a deploy. */
export const FREE_DEFAULTS = {
  /** The first story is free, once: mic seconds granted at device registration. */
  firstStorySec: 120,
  /** Refilled once a week (top-up to this many seconds, never accumulating). */
  weeklySec: 60,
  /** 0 = Sunday ... 6 = Saturday: the "Saturday story". */
  weeklyRefillDay: 6,
} as const

/** Below this many remaining seconds the crayon "gets sleepy" (a soft warning). */
export const SLEEPY_AT_SEC = 60
