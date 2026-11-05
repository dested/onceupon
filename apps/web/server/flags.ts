import { z } from 'zod'
import { prisma } from './prisma'
import { log } from './logger'

/** Runtime feature flags. Defaults live here; the admin portal overrides individual keys in the DB. */
export const FLAG_DEFAULTS = {
  freeFirstStorySec: 300,
  weeklyFreeSec: 180,
  weeklyRefillDay: 6,
  earsVendor: 'deepgram' as 'deepgram' | 'openai',
  /** iPad shells use the on-device recognizer (free) instead of minting cloud ears. */
  onDeviceEars: true,
  /** The paid model: devices that bought minutes (pack, gift) or are comped draw with it. */
  model: 'claude-sonnet-5-5',
  /** Every other device (free minutes, the first story included) draws with this one (decision 4b; Haiku 5.5 passed the kit safety bench 2026-11-04). */
  freeModel: 'claude-haiku-5-5',
  dialect: 'kit' as 'kit' | 'sketch' | 'ops' | 'json' | 'lines',
  purchasesPaused: false,
  relayPaused: false,
  readOnly: false,
  shareLifetimeDays: 90,
  /** Off for 1.0: the app sends no AdServices token (decisions.md 2026-11-04). */
  attributionOn: false,
  dailyDeviceCostCapCents: 300,
  dailySpendAlertCents: 10000,
  /** Above today's (UTC) model spend the relay refuses non-paying, non-comped devices (503 paused). 0 = off. */
  dailySpendStopCents: 7500,
  /** Mint Deepgram/OpenAI ears tokens (never for iOS). Off for 1.0: ears are on the device. */
  cloudEars: false,
  silenceNudgeMs: 30000,
  silenceEndMs: 60000,
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
  onDeviceEars: z.boolean(),
  model: z.string().min(1),
  freeModel: z.string().min(1),
  dialect: z.enum(['kit', 'sketch', 'ops', 'json', 'lines']),
  purchasesPaused: z.boolean(),
  relayPaused: z.boolean(),
  readOnly: z.boolean(),
  shareLifetimeDays: int0,
  attributionOn: z.boolean(),
  dailyDeviceCostCapCents: int0,
  dailySpendAlertCents: int0,
  dailySpendStopCents: int0,
  cloudEars: z.boolean(),
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
