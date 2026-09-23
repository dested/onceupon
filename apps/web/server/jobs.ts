import { prisma } from './prisma'
import { expireShares } from './shares'
import { runAlertChecks } from './alerts'
import { log } from './logger'

const INTERVAL_MS = 10 * 60 * 1000
const ALERT_EVERY_MS = 60 * 60 * 1000
const STALE_SESSION_MS = 2 * 60 * 1000

let started = false
let lastAlertCheck = 0

function msg(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** A session whose heartbeat stopped (backgrounded, crashed) is closed with no extra charge. */
async function closeStaleSessions(): Promise<number> {
  const cutoff = new Date(Date.now() - STALE_SESSION_MS)
  const res = await prisma.storySession.updateMany({
    where: { status: 'open', lastBeatAt: { lt: cutoff } },
    data: { status: 'closed', endedAt: new Date() },
  })
  return res.count
}

async function tick(): Promise<void> {
  try {
    const expired = await expireShares()
    if (expired > 0) log.info(`[jobs] expired ${expired} shares`)
  } catch (err) {
    log.error(`[jobs] expireShares: ${msg(err)}`)
  }
  try {
    const closed = await closeStaleSessions()
    if (closed > 0) log.info(`[jobs] closed ${closed} stale sessions`)
  } catch (err) {
    log.error(`[jobs] closeStaleSessions: ${msg(err)}`)
  }
  if (Date.now() - lastAlertCheck >= ALERT_EVERY_MS) {
    lastAlertCheck = Date.now()
    try {
      await runAlertChecks()
    } catch (err) {
      log.error(`[jobs] runAlertChecks: ${msg(err)}`)
    }
  }
}

/** Start the 10-minute maintenance loop once. Alert checks run at most hourly inside the loop. */
export function startJobs(): void {
  if (started) return
  started = true
  setTimeout(() => {
    void tick()
  }, 30_000)
  setInterval(() => {
    void tick()
  }, INTERVAL_MS)
  log.info('[jobs] background jobs started')
}
