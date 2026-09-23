import { z } from 'zod'
import { prisma } from './prisma'
import { log } from './logger'

/** Runtime feature flags. Defaults live here; the admin portal overrides individual keys in the DB. */
export const FLAG_DEFAULTS = {
  freeFirstStorySec: 120,
  weeklyFreeSec: 60,
  weeklyRefillDay: 6,
  earsVendor: 'deepgram' as 'deepgram' | 'openai',
  model: 'claude-sonnet-5',
  dialect: 'ops' as 'ops' | 'json' | 'lines',
  purchasesPaused: false,
  relayPaused: false,
  readOnly: false,
  shareLifetimeDays: 90,
  attributionOn: true,
  dailyDeviceCostCapCents: 300,
  dailySpendAlertCents: 10000,
  silenceNudgeMs: 90000,
  silenceEndMs: 210000,
  maxSessionsPerDeviceDay: 40,
}

export type Flags = typeof FLAG_DEFAULTS

const int0 = z.number().int().min(0)

// Per-key schemas live on this object so setFlag/getFlags can validate one key at a time.
const flagsObject = z.object({
  freeFirstStorySec: int0,
  weeklyFreeSec: int0,
  weeklyRefillDay: z.number().int().min(0).max(6),
  earsVendor: z.enum(['deepgram', 'openai']),
  model: z.string().min(1),
  dialect: z.enum(['ops', 'json', 'lines']),
  purchasesPaused: z.boolean(),
  relayPaused: z.boolean(),
  readOnly: z.boolean(),
  shareLifetimeDays: int0,
  attributionOn: z.boolean(),
  dailyDeviceCostCapCents: int0,
  dailySpendAlertCents: int0,
  silenceNudgeMs: int0,
  silenceEndMs: int0,
  maxSessionsPerDeviceDay: int0,
})

export const flagsSchema: z.ZodType<Flags> = flagsObject

/** Narrow a runtime string (e.g. an admin request body) to a flag key before calling setFlag. */
export function isFlagKey(key: string): key is keyof Flags {
  return Object.prototype.hasOwnProperty.call(FLAG_DEFAULTS, key)
}

const CACHE_MS = 30_000
let cache: { at: number; flags: Flags } | null = null

/**
 * All flags, defaults overlaid with valid DB rows. Cached 30 s; a bad row logs and keeps its default.
 * Values are validated per key into an untyped merge, then the whole object is parsed once so the
 * result is a real Flags without any per-key casting.
 */
export async function getFlags(): Promise<Flags> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.flags
  const rows = await prisma.flag.findMany()
  const byKey = new Map(rows.map((r) => [r.key, r.value]))
  const merged: Record<string, unknown> = { ...FLAG_DEFAULTS }
  for (const key of Object.keys(FLAG_DEFAULTS) as Array<keyof Flags>) {
    if (!byKey.has(key)) continue
    const parsed = flagsObject.shape[key].safeParse(byKey.get(key))
    if (parsed.success) merged[key] = parsed.data
    else log.warn(`flag ${String(key)} has an invalid stored value; using default`)
  }
  const flags = flagsObject.parse(merged)
  cache = { at: Date.now(), flags }
  return flags
}

/** Validate one key, upsert it, record an audit entry, bust the cache, and return the fresh flags. */
export async function setFlag<K extends keyof Flags>(
  key: K,
  value: Flags[K],
  actor: string
): Promise<Flags> {
  const parsed = flagsObject.shape[key].safeParse(value)
  if (!parsed.success) throw new Error(`invalid value for flag ${String(key)}`)
  const stored = parsed.data
  await prisma.$transaction([
    prisma.flag.upsert({
      where: { key },
      create: { key, value: stored, updatedBy: actor },
      update: { value: stored, updatedBy: actor, updatedAt: new Date() },
    }),
    prisma.auditLog.create({
      data: { actor, action: 'flag.set', target: key, detail: { value: stored } },
    }),
  ])
  invalidateFlags()
  return getFlags()
}

export function invalidateFlags(): void {
  cache = null
}
