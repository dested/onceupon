import type { KitDef } from '../types'
import { ANIMALS } from './animals'
import { CREATURES } from './creatures'
import { CRITTER_KITS } from './critters'
import { OBJECTS } from './objects'
import { PEOPLE } from './people'

export const KITS: KitDef[] = [...PEOPLE, ...ANIMALS, ...CRITTER_KITS, ...CREATURES, ...OBJECTS]

const byName = new Map<string, KitDef>()
for (const k of KITS) byName.set(k.kind, k)
for (const k of KITS) for (const a of k.aliases ?? []) if (!byName.has(a)) byName.set(a, k)

/** A kit by name or alias (plural "-s" tolerated). */
export function findKit(word: string): KitDef | null {
  const w = word.toLowerCase().replace(/_/g, '')
  return byName.get(w) ?? (w.endsWith('s') ? (byName.get(w.slice(0, -1)) ?? null) : null)
}
