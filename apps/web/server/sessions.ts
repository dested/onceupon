import type { Device, StorySession } from '@prisma/client'
import { prisma } from './prisma'
import { ApiError } from './app-api-types'
import * as ledger from './ledger'
import { getFlags } from './flags'
import { mintEarsToken, pickEarsVendor } from './ears'
import type { AppApi, EarsToken, EndReason, SessionStart } from '../../../packages/shared/src/api'

const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, n))

const utcMidnight = (): Date => {
  const now = new Date()
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
}

// Ears TTL covers the balance plus a small margin, clamped to the vendor limits.
// A leaked token is worth at most the paid balance (plus a 30 s grace for the last beat), never more.
const earsTtl = (balanceSec: number): number => clamp(balanceSec + 30, 30, 3600)

/**
 * Open a story session. Gated by the read-only / paused flags, the per-day session cap, and a
 * positive balance (after applying any due weekly grant). Mints an ears token when the client asked
 * for a streaming vendor and one is configured.
 */
export async function startSession(
  device: Device,
  input: AppApi['session.start']['input']
): Promise<SessionStart> {
  const flags = await getFlags()
  if (flags.readOnly) throw new ApiError(503, 'read_only', 'the app is read-only right now')
  if (flags.relayPaused) throw new ApiError(503, 'paused', 'stories are paused right now')

  const todayCount = await prisma.storySession.count({
    where: { deviceId: device.id, startedAt: { gte: utcMidnight() } },
  })
  if (todayCount >= flags.maxSessionsPerDeviceDay) {
    throw new ApiError(429, 'cap', 'too many stories today')
  }

  const fresh = await ledger.applyWeeklyGrant(device, flags)
  if (fresh.balanceSec <= 0) throw new ApiError(402, 'exhausted', 'out of minutes')

  const session = await prisma.storySession.create({
    data: { deviceId: fresh.id, storyId: input.storyId, earsVendor: input.ears },
  })

  let ears: EarsToken | null = null
  if (fresh.balanceSec > 0 && input.ears !== 'browser') {
    const vendor = pickEarsVendor(flags)
    if (vendor) ears = await mintEarsToken(vendor, earsTtl(fresh.balanceSec))
  }

  if (!fresh.freeStoryUsed) {
    await prisma.device.update({ where: { id: fresh.id }, data: { freeStoryUsed: true } })
  }

  return {
    sessionId: session.id,
    remainingSec: fresh.balanceSec,
    ears,
    model: flags.model,
    dialect: flags.dialect,
  }
}

async function ownedOpenSession(device: Device, sessionId: string): Promise<StorySession> {
  const session = await prisma.storySession.findUnique({ where: { id: sessionId } })
  if (!session || session.deviceId !== device.id || session.status !== 'open') {
    throw new ApiError(404, 'not_found', 'session not found')
  }
  return session
}

/** Meter one beat: charge the listened seconds (clamped), advance the session, report the balance. */
export async function beat(
  device: Device,
  sessionId: string,
  listeningMs: number
): Promise<{ remainingSec: number; exhausted: boolean }> {
  await ownedOpenSession(device, sessionId)
  const ms = clamp(listeningMs, 0, 90_000)
  const seconds = Math.ceil(ms / 1000)
  const balanceSec =
    seconds > 0
      ? (await ledger.debit(device.id, 'debit', seconds, sessionId, null)).balanceSec
      : (await prisma.device.findUniqueOrThrow({ where: { id: device.id } })).balanceSec
  const exhausted = balanceSec <= 0
  await prisma.storySession.update({
    where: { id: sessionId },
    data: {
      chargedSec: { increment: seconds },
      listenedMs: { increment: ms },
      lastBeatAt: new Date(),
      ...(exhausted ? { status: 'exhausted' } : {}),
    },
  })
  return { remainingSec: balanceSec, exhausted }
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
    return { remainingSec: d.balanceSec }
  }
  const ms = clamp(listeningMs, 0, 90_000)
  const seconds = Math.ceil(ms / 1000)
  const balanceSec =
    seconds > 0
      ? (await ledger.debit(device.id, 'debit', seconds, sessionId, null)).balanceSec
      : (await prisma.device.findUniqueOrThrow({ where: { id: device.id } })).balanceSec
  await prisma.storySession.update({
    where: { id: sessionId },
    data: {
      chargedSec: { increment: seconds },
      listenedMs: { increment: ms },
      status: balanceSec <= 0 ? 'exhausted' : 'closed',
      endedAt: new Date(),
      endReason: ended,
    },
  })
  return { remainingSec: balanceSec }
}

/** A fresh ears token mid-session (the previous one expired). */
export async function earsTokenFor(device: Device, sessionId: string): Promise<EarsToken> {
  const flags = await getFlags()
  await ownedOpenSession(device, sessionId)
  const d = await prisma.device.findUniqueOrThrow({ where: { id: device.id } })
  if (d.balanceSec <= 0) throw new ApiError(402, 'exhausted', 'out of minutes')
  const vendor = pickEarsVendor(flags)
  const token = vendor ? await mintEarsToken(vendor, earsTtl(d.balanceSec)) : null
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
