import { prisma } from './prisma'
import { expireShares } from './shares'
import { runAlertChecks } from './alerts'
import { log } from './logger'
import { runRetention } from './retention'

const TICK_MS = 60 * 1000
const SHARES_EVERY_MS = 10 * 60 * 1000
const ALERT_EVERY_MS = 10 * 60 * 1000
const STALE_SESSION_MS = 2 * 60 * 1000
const RETENTION_EVERY_MS = 24 * 60 * 60 * 1000

let started = false
let lastShares = 0
let lastAlertCheck = 0
let lastRetention = 0

function msg(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** A session whose heartbeat stopped (backgrounded, crashed) is closed with no extra charge. */
export async function closeStaleSessions(): Promise<number> {
  const cutoff = new Date(Date.now() - STALE_SESSION_MS)
  const res = await prisma.storySession.updateMany({
    where: { status: 'open', lastBeatAt: { lt: cutoff } },
    data: { status: 'closed', endedAt: new Date() },
  })
  return res.count
}

async function step(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn()
  } catch (err) {
    log.error(`[jobs] ${name}: ${msg(err)}`)
  }
}

async function tick(): Promise<void> {
  await step('closeStaleSessions', async () => {
    const closed = await closeStaleSessions()
    if (closed > 0) log.info(`[jobs] closed ${closed} stale sessions`)
  })
  if (Date.now() - lastShares >= SHARES_EVERY_MS) {
    lastShares = Date.now()
    await step('expireShares', async () => {
      const expired = await expireShares()
      if (expired > 0) log.info(`[jobs] expired ${expired} shares`)
    })
  }
  if (Date.now() - lastAlertCheck >= ALERT_EVERY_MS) {
    lastAlertCheck = Date.now()
    await step('runAlertChecks', runAlertChecks)
  }
  if (Date.now() - lastRetention >= RETENTION_EVERY_MS) {
    lastRetention = Date.now()
    await step('retention', async () => {
      const r = await runRetention()
      log.info(`[jobs] retention ${JSON.stringify(r)}`)
    })
  }
}

/**
 * Start the maintenance loop once: stale sessions every minute (the relay grace hangs off them),
 * shares and alert checks every 10 minutes, retention (V-22) once a day.
 */
export function startJobs(): void {
  if (started) return
  started = true
  let running = false
  const run = (): void => {
    if (running) return
    running = true
    void tick().finally(() => {
      running = false
    })
  }
  setTimeout(run, 30_000)
  setInterval(run, TICK_MS)
  log.info('[jobs] background jobs started')
}
