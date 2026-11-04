import type { Device, StorySession } from '@prisma/client'
import { prisma } from './prisma'
import { ApiError } from './app-api-types'
import * as ledger from './ledger'
import { getFlags, type Flags } from './flags'
import { log } from './logger'
import { mintEarsWithFallback } from './ears'
import { drawModelFor, requireAiConsent } from './device'
import type { AppApi, EarsToken, EndReason, SessionStart } from '../../../packages/shared/src/api'
import { typedChargeSec } from '../../../packages/shared/src/typed'

const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, n))

const utcMidnight = (): Date => {
  const now = new Date()
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
}

// Ears TTL covers the balance plus a small margin, clamped to the vendor limits.
// A leaked token is worth at most the paid balance (plus a 30 s grace for the last beat), never more.
const earsTtl = (balanceSec: number): number => clamp(balanceSec + 30, 30, 3600)

/**
 * What a comped device is told it has left. Comped stories are never debited; reporting a large
 * constant keeps every client (including shells built before `comped` existed) out of the sleepy path.
 */
export const COMPED_REMAINING_SEC = 100 * 3600

/** Seconds left as the client should see them: the balance, or the comped constant. */
const remainingFor = (device: Device, balanceSec: number): number =>
  device.comped ? COMPED_REMAINING_SEC : balanceSec

/**
 * Open a story session. Gated by the read-only / paused flags, the per-day session cap, and a
 * positive balance (after applying any due weekly grant; comped devices skip the balance). Mints an ears token when the client asked
 * for a streaming vendor and one is configured.
 */
export async function startSession(
  device: Device,
  input: AppApi['session.start']['input']
): Promise<SessionStart> {
  const flags = await getFlags()
  if (flags.readOnly) throw new ApiError(503, 'read_only', 'the app is read-only right now')
  if (flags.relayPaused) throw new ApiError(503, 'paused', 'stories are paused right now')
  requireAiConsent(device)

  const fresh = await ledger.applyWeeklyGrant(device, flags)
  if (!fresh.comped && fresh.balanceSec <= 0) throw new ApiError(402, 'exhausted', 'out of minutes')
  const remainingSec = remainingFor(fresh, fresh.balanceSec)

  // Count and create under the device's row lock so parallel starts cannot pass the daily cap (V-04).
  const session = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM device WHERE id = ${fresh.id} FOR UPDATE`
    const todayCount = await tx.storySession.count({
      where: { deviceId: fresh.id, startedAt: { gte: utcMidnight() } },
    })
    if (todayCount >= flags.maxSessionsPerDeviceDay) {
      throw new ApiError(429, 'cap', 'too many stories today')
    }
    return tx.storySession.create({
      data: { deviceId: fresh.id, storyId: input.storyId, earsVendor: input.ears },
    })
  })

  let ears: EarsToken | null = null
  // On-device (apple) and browser ears need no cloud credential. Cloud ears are off unless the
  // `cloudEars` flag is on, and never for iOS (child audio stays on the device).
  if ((input.ears === 'deepgram' || input.ears === 'openai') && cloudEarsAllowed(fresh, flags)) {
    ears = await mintEarsWithFallback(flags, earsTtl(remainingSec))
  }
  // freeStoryUsed flips on the first successful draw (markDrawSucceeded), not here.

  return {
    sessionId: session.id,
    remainingSec,
    ears,
    model: drawModelFor(fresh, flags),
    dialect: flags.dialect,
  }
}

/** Cloud ears (Deepgram / OpenAI tokens) only when the flag is on, and never on iOS. */
function cloudEarsAllowed(device: Device, flags: Flags): boolean {
  return flags.cloudEars && device.platform !== 'ios'
}

// ---------------------------------------------------------------- draw outcomes (no charge for failed drawing)

/** One relay call in flight per device (the studio never has two). */
const inFlight = new Map<string, { sessionId: string; startedAt: number }>()

/** Claim the device's draw slot; false when a call is already in flight. */
export function beginDraw(deviceId: string, sessionId: string): boolean {
  if (inFlight.has(deviceId)) return false
  inFlight.set(deviceId, { sessionId, startedAt: Date.now() })
  return true
}

export function endDraw(deviceId: string): void {
  inFlight.delete(deviceId)
}

/** Draws in flight across every device (tests wait for 0 between cases). */
export function drawsInFlight(): number {
  return inFlight.size
}

/**
 * Draw requests the relay refused before streaming (cap, paused, unknown prompt...), per device+session,
 * in memory. They never reach CallLog but they are drawing that failed, so the beat window counts them.
 */
const refusals = new Map<string, number[]>()
const REFUSAL_KEEP_MS = 10 * 60_000

const refusalKey = (deviceId: string, sessionId: string): string => `${deviceId}:${sessionId}`

export function recordRefusal(deviceId: string, sessionId: string): void {
  const key = refusalKey(deviceId, sessionId)
  const now = Date.now()
  const kept = (refusals.get(key) ?? []).filter((t) => now - t < REFUSAL_KEEP_MS)
  kept.push(now)
  refusals.set(key, kept)
  if (refusals.size > 5000) {
    for (const [k, ts] of refusals) if (ts.every((t) => now - t >= REFUSAL_KEEP_MS)) refusals.delete(k)
  }
}

function refusalsSince(deviceId: string, sessionId: string, since: Date): number {
  return (refusals.get(refusalKey(deviceId, sessionId)) ?? []).filter((t) => t >= since.getTime()).length
}

/**
 * Did drawing fail for the whole window? True when the session tried to draw in it (a finished call
 * or a refused request) and nothing was drawn. A client abort (the studio restarting with more words)
 * is neutral. A window with no attempt at all (the child was quiet or thinking) is metered as usual.
 */
async function drawingFailedSince(deviceId: string, sessionId: string, since: Date): Promise<boolean> {
  const calls = await prisma.callLog.findMany({
    where: { sessionId, createdAt: { gte: since } },
    select: { error: true },
  })
  const counted = calls.filter((c) => c.error !== 'aborted')
  const refused = refusalsSince(deviceId, sessionId, since)
  if (counted.length + refused === 0) return false
  return counted.every((c) => c.error !== null)
}

/** The first successful draw uses up the free first story (not the session start). */
export async function markDrawSucceeded(deviceId: string): Promise<void> {
  await prisma.device.updateMany({ where: { id: deviceId, freeStoryUsed: false }, data: { freeStoryUsed: true } })
}

/** How long after a typed charge its drawing has to land. */
export const TYPED_SETTLE_MS = 20_000
let typedSettleMs = TYPED_SETTLE_MS
/** Tests shorten the settle delay. */
export function setTypedSettleMsForTests(ms: number): void {
  typedSettleMs = ms
}

/**
 * Settle one typed charge: if no call for the session finished cleanly within the settle window after
 * the charge, credit the seconds back (`refund_failed_draw`). A call still in flight gets one more
 * window. Returns the seconds refunded.
 */
export async function settleTypedCharge(
  deviceId: string,
  sessionId: string,
  seconds: number,
  chargedAt: Date,
  retried = false
): Promise<number> {
  if (seconds <= 0) return 0
  const until = new Date(chargedAt.getTime() + typedSettleMs * (retried ? 2 : 1))
  const ok = await prisma.callLog.count({
    where: { sessionId, createdAt: { gte: chargedAt, lte: until }, error: null },
  })
  if (ok > 0) return 0
  if (!retried && inFlight.get(deviceId)?.sessionId === sessionId) {
    await new Promise((r) => setTimeout(r, typedSettleMs))
    return settleTypedCharge(deviceId, sessionId, seconds, chargedAt, true)
  }
  await prisma.$transaction(async (tx) => {
    await ledger.credit(deviceId, 'refund_failed_draw', seconds, sessionId, 'typed message, drawing failed', undefined, tx)
    await tx.storySession.update({
      where: { id: sessionId },
      data: { chargedSec: { decrement: seconds }, typedSec: { decrement: seconds } },
    })
  })
  return seconds
}

function scheduleTypedSettle(deviceId: string, sessionId: string, seconds: number, chargedAt: Date): void {
  if (seconds <= 0) return
  setTimeout(() => {
    settleTypedCharge(deviceId, sessionId, seconds, chargedAt).catch((e: unknown) =>
      log.error(`[sessions] typed refund failed: ${e instanceof Error ? e.message : String(e)}`)
    )
  }, typedSettleMs)
}

async function ownedOpenSession(device: Device, sessionId: string): Promise<StorySession> {
  const session = await prisma.storySession.findUnique({ where: { id: sessionId } })
  if (!session || session.deviceId !== device.id || session.status !== 'open') {
    throw new ApiError(404, 'not_found', 'session not found')
  }
  return session
}

/**
 * Charge `seconds` of a session to the device, or nothing when it is comped. Returns what was charged
 * and the balance afterwards.
 */
async function charge(
  device: Device,
  sessionId: string,
  seconds: number,
  note: string | null
): Promise<{ charged: number; balanceSec: number }> {
  if (seconds > 0 && !device.comped) return ledger.debit(device.id, 'debit', seconds, sessionId, note)
  const d = await prisma.device.findUniqueOrThrow({ where: { id: device.id } })
  return { charged: 0, balanceSec: d.balanceSec }
}

/** Meter one beat: charge the listened seconds (clamped), advance the session, report the balance. */
export async function beat(
  device: Device,
  sessionId: string,
  listeningMs: number
): Promise<{ remainingSec: number; exhausted: boolean }> {
  const session = await ownedOpenSession(device, sessionId)
  const ms = clamp(listeningMs, 0, 90_000)
  // No charge for a window in which every drawing attempt failed.
  const failed = await drawingFailedSince(device.id, sessionId, session.lastBeatAt)
  const seconds = failed ? 0 : Math.ceil(ms / 1000)
  const { charged, balanceSec } = await charge(device, sessionId, seconds, null)
  const exhausted = !device.comped && balanceSec <= 0
  await prisma.storySession.update({
    where: { id: sessionId },
    data: {
      chargedSec: { increment: charged },
      listenedMs: { increment: ms },
      lastBeatAt: new Date(),
      ...(exhausted ? { status: 'exhausted' } : {}),
    },
  })
  return { remainingSec: remainingFor(device, balanceSec), exhausted }
}

/**
 * Meter one typed message as talking time, computed here from the text (never from a client-reported
 * duration): `typedChargeSec` = max(3, ceil(words / 2.5)). A session that never opens the mic and types
 * forever pays for every message and ends sleepy like a spoken one. listenedMs stays mic time only.
 */
export async function typed(
  device: Device,
  sessionId: string,
  text: string
): Promise<{ remainingSec: number; exhausted: boolean; chargedSec: number }> {
  requireAiConsent(device)
  await ownedOpenSession(device, sessionId)
  const chargedAt = new Date()
  const { charged, balanceSec } = await charge(device, sessionId, typedChargeSec(text), 'typed')
  // Refunded if its drawing never lands (settleTypedCharge).
  scheduleTypedSettle(device.id, sessionId, charged, chargedAt)
  const exhausted = !device.comped && balanceSec <= 0
  await prisma.storySession.update({
    where: { id: sessionId },
    data: {
      chargedSec: { increment: charged },
      typedSec: { increment: charged },
      lastBeatAt: new Date(),
      ...(exhausted ? { status: 'exhausted' } : {}),
    },
  })
  return { remainingSec: remainingFor(device, balanceSec), exhausted, chargedSec: charged }
}

/** Close a session (idempotent). Charges the final span, marks the end, reports the balance. */
export async function stopSession(
  device: Device,
  sessionId: string,
  listeningMs: number,
  ended: EndReason | null
): Promise<{ remainingSec: number }> {
  const session = await prisma.storySession.findUnique({ where: { id: sessionId } })
  if (!session || session.deviceId !== device.id) {
    throw new ApiError(404, 'not_found', 'session not found')
  }
  if (session.status !== 'open') {
    const d = await prisma.device.findUniqueOrThrow({ where: { id: device.id } })
    return { remainingSec: remainingFor(device, d.balanceSec) }
  }
  const ms = clamp(listeningMs, 0, 90_000)
  const failed = await drawingFailedSince(device.id, sessionId, session.lastBeatAt)
  const { charged, balanceSec } = await charge(device, sessionId, failed ? 0 : Math.ceil(ms / 1000), null)
  await prisma.storySession.update({
    where: { id: sessionId },
    data: {
      chargedSec: { increment: charged },
      listenedMs: { increment: ms },
      status: !device.comped && balanceSec <= 0 ? 'exhausted' : 'closed',
      endedAt: new Date(),
      endReason: ended,
    },
  })
  return { remainingSec: remainingFor(device, balanceSec) }
}

/** A fresh ears token mid-session (the previous one expired). */
export async function earsTokenFor(device: Device, sessionId: string): Promise<EarsToken> {
  const flags = await getFlags()
  if (!cloudEarsAllowed(device, flags)) throw new ApiError(403, 'blocked', 'cloud ears are off')
  await ownedOpenSession(device, sessionId)
  const d = await prisma.device.findUniqueOrThrow({ where: { id: device.id } })
  if (!d.comped && d.balanceSec <= 0) throw new ApiError(402, 'exhausted', 'out of minutes')
  const token = await mintEarsWithFallback(flags, earsTtl(remainingFor(d, d.balanceSec)))
  if (!token) throw new ApiError(503, 'upstream', 'could not get an ears token')
  return token
}

/**
 * The relay accepts calls for an open session, and for a short grace window after it closed or ran
 * out (a call already in flight when the last beat landed). Returns the session or null.
 */
export async function sessionOpenForRelay(
  device: Device,
  sessionId: string
): Promise<StorySession | null> {
  const session = await prisma.storySession.findUnique({ where: { id: sessionId } })
  if (!session || session.deviceId !== device.id) return null
  if (session.status === 'open') return session
  if (session.status === 'closed' || session.status === 'exhausted') {
    const at = session.endedAt ?? session.lastBeatAt
    if (Date.now() - at.getTime() <= 120_000) return session
  }
  return null
}
