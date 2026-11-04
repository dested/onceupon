import type { Request } from 'express'

/**
 * In-memory per-IP limits (V-02, V-29). One instance serves production, so a process-local counter is
 * the whole picture. Fixed windows: simple, and a burst at a boundary is at most twice the limit.
 */
export interface Limit {
  /** Requests allowed per window. */
  max: number
  windowMs: number
}

const MINUTE = 60_000
const HOUR = 60 * MINUTE

/** The limits by bucket name. `app` covers every `/api/app/*` call except the ones with their own bucket and draw. */
export const LIMITS = {
  register: { max: 10, windowMs: HOUR },
  app: { max: 300, windowMs: MINUTE },
  share: { max: 20, windowMs: HOUR },
  checkout: { max: 10, windowMs: MINUTE },
} as const satisfies Record<string, Limit>

export type Bucket = keyof typeof LIMITS

const windows = new Map<string, { start: number; count: number }>()
let lastSweep = Date.now()

/** Count one request for `ip` in `bucket`; false when it is over the limit. */
export function allow(bucket: Bucket, ip: string, now = Date.now()): boolean {
  const limit = LIMITS[bucket]
  if (now - lastSweep > 5 * MINUTE) {
    for (const [k, w] of windows) if (now - w.start >= HOUR) windows.delete(k)
    lastSweep = now
  }
  const key = `${bucket}:${ip}`
  const w = windows.get(key)
  if (!w || now - w.start >= limit.windowMs) {
    windows.set(key, { start: now, count: 1 })
    return true
  }
  w.count++
  return w.count <= limit.max
}

/** Tests start from empty counters. */
export function resetRateLimitsForTests(): void {
  windows.clear()
}

/** The client IP: the first `X-Forwarded-For` hop (Caddy sets it), else the socket address. */
export function clientIp(req: Pick<Request, 'headers' | 'socket'>): string {
  const fwd = req.headers['x-forwarded-for']
  const first = (Array.isArray(fwd) ? fwd[0] : fwd)?.split(',')[0]?.trim()
  if (first) return first
  return req.socket.remoteAddress ?? 'unknown'
}
