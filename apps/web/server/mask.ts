import { prisma } from './prisma'

// Kept in sync with the BAD list in root src/story/clean.ts. The studio ships this list already, so
// mask.list only returns the extra DB words; maskText (used server-side on skip words) masks both.
export const BASE_MASK: string[] = [
  'fuck',
  'fucking',
  'fucked',
  'shit',
  'shitty',
  'bullshit',
  'bitch',
  'bitches',
  'asshole',
  'assholes',
  'dick',
  'dicks',
  'cock',
  'pussy',
  'cunt',
  'slut',
  'whore',
  'bastard',
  'damn',
  'goddamn',
  'crap',
  'piss',
  'pissed',
  'nigger',
  'nigga',
  'faggot',
  'fag',
  'retard',
  'retarded',
  'sex',
  'sexy',
  'porn',
  'penis',
  'vagina',
  'boobs',
  'tits',
  'nude',
  'naked',
]

const CACHE_MS = 60_000
let cache: { at: number; words: string[] } | null = null

/** Extra masked words added from the admin portal (DB only; cached 60 s). */
export async function getMaskWords(): Promise<string[]> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.words
  const rows = await prisma.maskWord.findMany()
  const words = rows.map((r) => r.word)
  cache = { at: Date.now(), words }
  return words
}

export function invalidateMask(): void {
  cache = null
}

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Mask BASE_MASK + DB words the way clean.ts does: first letter kept, the rest asterisks. */
export async function maskText(text: string): Promise<string> {
  const all = [...BASE_MASK, ...(await getMaskWords())]
  if (all.length === 0) return text
  const re = new RegExp(`\\b(${all.map(escapeRe).join('|')})\\b`, 'gi')
  return text.replace(re, (m) => (m[0] ?? '*') + '*'.repeat(Math.max(1, m.length - 1)))
}
