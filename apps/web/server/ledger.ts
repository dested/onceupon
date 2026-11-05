import { Prisma } from '@prisma/client'
import type { Device } from '@prisma/client'
import { prisma } from './prisma'
import type { Flags } from './flags'

/** Every ledger row kind. `seconds` is signed on the row: grants/credits +, debits -. */
export const LEDGER_KINDS = [
  'grant_first',
  'grant_weekly',
  'purchase',
  'redeem',
  'debit',
  'refund',
  'refund_failed_draw',
  'admin',
] as const

type CreditKind = 'grant_first' | 'grant_weekly' | 'purchase' | 'redeem' | 'refund' | 'refund_failed_draw' | 'admin'
type DebitKind = 'debit' | 'refund' | 'admin'

const WEEK_MS = 7 * 24 * 60 * 60 * 1000

/** The most recent `refillDay` (0..6 UTC) at 00:00 UTC on or before `now`. */
function weeklyBoundary(refillDay: number, now: Date): Date {
  const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  const delta = (day.getUTCDay() - refillDay + 7) % 7
  day.setUTCDate(day.getUTCDate() - delta)
  return day
}

/** Add seconds and append a ledger row. Runs in `tx` if given, else its own transaction. */
export async function credit(
  deviceId: string,
  kind: CreditKind,
  seconds: number,
  ref: string | null,
  note: string | null,
  actor?: string,
  tx?: Prisma.TransactionClient
): Promise<{ balanceSec: number }> {
  if (seconds <= 0) throw new Error('credit seconds must be > 0')
  const run = async (db: Prisma.TransactionClient): Promise<{ balanceSec: number }> => {
    const d = await db.device.update({
      where: { id: deviceId },
      data: { balanceSec: { increment: seconds } },
    })
    await db.ledgerEntry.create({
      data: { deviceId, kind, seconds, balanceAfter: d.balanceSec, ref, note, actor: actor ?? null },
    })
    return { balanceSec: d.balanceSec }
  }
  return tx ? run(tx) : prisma.$transaction(run)
}

/** Remove seconds, clamped to the current balance (never negative). The row's `seconds` is negative. */
export async function debit(
  deviceId: string,
  kind: DebitKind,
  seconds: number,
  ref: string | null,
  note: string | null,
  actor?: string,
  tx?: Prisma.TransactionClient
): Promise<{ charged: number; balanceSec: number }> {
  if (seconds <= 0) throw new Error('debit seconds must be > 0')
  const run = async (db: Prisma.TransactionClient): Promise<{ charged: number; balanceSec: number }> => {
    // Conditional update (V-04): the decrement only lands while the balance still covers it, so two
    // parallel debits can never drive it negative. A lost race re-reads and tries again.
    for (let attempt = 0; attempt < 5; attempt++) {
      const current = await db.device.findUniqueOrThrow({ where: { id: deviceId } })
      const charged = Math.min(seconds, current.balanceSec)
      if (charged <= 0) return { charged: 0, balanceSec: current.balanceSec }
      const res = await db.device.updateMany({
        where: { id: deviceId, balanceSec: { gte: charged } },
        data: { balanceSec: { decrement: charged } },
      })
      if (res.count === 0) continue
      const d = await db.device.findUniqueOrThrow({ where: { id: deviceId }, select: { balanceSec: true } })
      await db.ledgerEntry.create({
        data: { deviceId, kind, seconds: -charged, balanceAfter: d.balanceSec, ref, note, actor: actor ?? null },
      })
      return { charged, balanceSec: d.balanceSec }
    }
    const d = await db.device.findUniqueOrThrow({ where: { id: deviceId }, select: { balanceSec: true } })
    return { charged: 0, balanceSec: d.balanceSec }
  }
  return tx ? run(tx) : prisma.$transaction(run)
}

/**
 * Weekly free top-up. If the device has not been granted since the most recent refill boundary AND
 * its balance is below the weekly allowance, top it up to the allowance (never accumulating). Returns
 * the fresh device (unchanged when not due). A device never granted counts from its registration, so
 * its first top-up is the first refill day after it arrived, not day one (decision 1: the free first
 * story, then a Saturday story each week).
 */
export async function applyWeeklyGrant(device: Device, flags: Flags): Promise<Device> {
  const now = new Date()
  const boundary = weeklyBoundary(flags.weeklyRefillDay, now)
  const due = (device.weeklyGrantAt ?? device.createdAt) < boundary
  if (!due || device.balanceSec >= flags.weeklyFreeSec) return device
  return prisma.$transaction(async (tx) => {
    // Claim this week's grant with a guarded update (V-04): a parallel call finds it already claimed.
    const claim = await tx.device.updateMany({
      where: {
        id: device.id,
        balanceSec: { lt: flags.weeklyFreeSec },
        OR: [{ weeklyGrantAt: null, createdAt: { lt: boundary } }, { weeklyGrantAt: { lt: boundary } }],
      },
      data: { weeklyGrantAt: now },
    })
    const fresh = await tx.device.findUniqueOrThrow({ where: { id: device.id } })
    if (claim.count === 0) return fresh
    const top = flags.weeklyFreeSec - fresh.balanceSec
    if (top <= 0) return fresh
    await credit(device.id, 'grant_weekly', top, null, 'weekly top-up', undefined, tx)
    return tx.device.findUniqueOrThrow({ where: { id: device.id } })
  })
}

/** ISO time of the next weekly boundary strictly after max(weeklyGrantAt, now - 7d). */
export function nextWeeklyAt(device: Device, flags: Flags): string | null {
  // The next refill boundary strictly in the future; a device already topped up this week waits for the next one.
  const now = new Date()
  const anchor = device.weeklyGrantAt && device.weeklyGrantAt > now ? device.weeklyGrantAt : now
  let boundary = weeklyBoundary(flags.weeklyRefillDay, anchor)
  while (boundary <= anchor) boundary = new Date(boundary.getTime() + WEEK_MS)
  return boundary.toISOString()
}
