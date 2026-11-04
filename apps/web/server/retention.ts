import { prisma } from './prisma'

const DAY_MS = 24 * 60 * 60 * 1000

/** What the privacy policy promises (V-22). */
export const RETENTION = {
  /** Masked words the crayon refused to draw. */
  skipWordsDays: 30,
  /** Model call logs and story sessions (no words). */
  callLogDays: 180,
  sessionDays: 180,
  /** App Store notification payloads. */
  appleNotificationDays: 180,
  /** A device with no minutes left, not comped, unseen this long, is deleted with everything on it. */
  idleDeviceDays: 548,
} as const

export interface RetentionResult {
  skipWordsCleared: number
  callLogsDeleted: number
  sessionsDeleted: number
  appleNotificationsDeleted: number
  devicesDeleted: number
}

/** One pass of the daily retention job. `now` is injectable for the tests. */
export async function runRetention(now = new Date()): Promise<RetentionResult> {
  const ago = (days: number): Date => new Date(now.getTime() - days * DAY_MS)

  const skip = await prisma.callLog.updateMany({
    where: { skipWords: { not: null }, createdAt: { lt: ago(RETENTION.skipWordsDays) } },
    data: { skipWords: null },
  })
  const calls = await prisma.callLog.deleteMany({ where: { createdAt: { lt: ago(RETENTION.callLogDays) } } })
  const sessions = await prisma.storySession.deleteMany({
    where: { startedAt: { lt: ago(RETENTION.sessionDays) }, status: { not: 'open' } },
  })
  const apple = await prisma.appleNotification.deleteMany({
    where: { createdAt: { lt: ago(RETENTION.appleNotificationDays) } },
  })
  const devices = await prisma.device.deleteMany({
    where: { balanceSec: { lte: 0 }, comped: false, lastSeenAt: { lt: ago(RETENTION.idleDeviceDays) } },
  })

  return {
    skipWordsCleared: skip.count,
    callLogsDeleted: calls.count,
    sessionsDeleted: sessions.count,
    appleNotificationsDeleted: apple.count,
    devicesDeleted: devices.count,
  }
}
