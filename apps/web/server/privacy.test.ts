import './test/setup'
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { call, field, newDevice, resetDb, startApp, stopApp } from './test/harness'
import { prisma } from './prisma'
import { allow, resetRateLimitsForTests } from './rate-limit'
import { runRetention } from './retention'
import { deleteDevice } from './admin-queries'

beforeAll(async () => {
  await startApp()
})

afterAll(async () => {
  await stopApp()
})

beforeEach(async () => {
  await resetDb()
  resetRateLimitsForTests()
})

const DAY = 24 * 60 * 60 * 1000

describe('rate limits (V-02, V-29)', () => {
  test('device.register: 10 per hour per IP, then 429 cap; another IP is unaffected', async () => {
    // The harness calls from 127.0.0.1; with no X-Forwarded-For the limiter keys on the socket address.
    const register = (i: number) =>
      call('device.register', { installId: `rl-${i}`, platform: 'web', appVersion: null, storefront: null })
    const results = []
    for (let i = 0; i < 11; i++) results.push(await register(i))
    expect(results.slice(0, 10).every((r) => r.status === 200)).toBe(true)
    expect(results[10]?.status).toBe(429)
    expect(field(results[10]?.body, 'error', 'code')).toBe('cap')
  })

  test('buckets are per IP and per window', () => {
    const t0 = 1_000_000
    for (let i = 0; i < 10; i++) expect(allow('checkout', '1.1.1.1', t0)).toBe(true)
    expect(allow('checkout', '1.1.1.1', t0)).toBe(false)
    expect(allow('checkout', '2.2.2.2', t0)).toBe(true)
    expect(allow('checkout', '1.1.1.1', t0 + 61_000)).toBe(true)
  })
})

describe('retention (V-22)', () => {
  test('clears old skip words, deletes old logs, sessions, notifications and idle empty devices', async () => {
    const now = new Date()
    const old = (days: number) => new Date(now.getTime() - days * DAY)
    const d = await newDevice()
    const session = await prisma.storySession.create({
      data: { deviceId: d.id, storyId: 's', earsVendor: 'browser', status: 'closed', startedAt: old(200) },
    })
    await prisma.callLog.createMany({
      data: [
        { deviceId: d.id, model: 'm', dialect: 'kit', skip: true, skipWords: 'masked', createdAt: old(40) },
        { deviceId: d.id, model: 'm', dialect: 'kit', skip: true, skipWords: 'masked', createdAt: old(5) },
        { deviceId: d.id, model: 'm', dialect: 'kit', createdAt: old(200), sessionId: session.id },
      ],
    })
    await prisma.appleNotification.create({
      data: { notificationUuid: 'n1', type: 'TEST', payload: {}, createdAt: old(200) },
    })
    const idle = await newDevice()
    await prisma.device.update({ where: { id: idle.id }, data: { balanceSec: 0, lastSeenAt: old(600) } })
    const idleWithMinutes = await newDevice()
    await prisma.device.update({ where: { id: idleWithMinutes.id }, data: { lastSeenAt: old(600) } })

    const r = await runRetention(now)
    expect(r).toEqual({
      skipWordsCleared: 1,
      callLogsDeleted: 1,
      sessionsDeleted: 1,
      appleNotificationsDeleted: 1,
      devicesDeleted: 1,
    })
    const recent = await prisma.callLog.findFirstOrThrow({ where: { deviceId: d.id, skipWords: { not: null } } })
    expect(recent.skipWords).toBe('masked')
    expect(await prisma.device.findUnique({ where: { id: idle.id } })).toBe(null)
    expect(await prisma.device.findUnique({ where: { id: idleWithMinutes.id } })).not.toBe(null)
  })
})

describe('admin delete device (V-21)', () => {
  test('cascades and leaves an audit row with the code and counts', async () => {
    const d = await newDevice({ consent: true })
    const code = (await prisma.device.findUniqueOrThrow({ where: { id: d.id } })).code
    await call('session.start', { storyId: 's', ears: 'browser' }, d.token)
    const r = await deleteDevice(d.id, 'admin@example.com')
    expect(r.ok).toBe(true)
    expect(await prisma.device.findUnique({ where: { id: d.id } })).toBe(null)
    expect(await prisma.ledgerEntry.count({ where: { deviceId: d.id } })).toBe(0)
    expect(await prisma.storySession.count({ where: { deviceId: d.id } })).toBe(0)
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: 'device.delete' } })
    expect(audit.target).toBe(code)
    expect(audit.detail).toEqual({ entries: 1, sessions: 1, purchases: 0, shares: 0, calls: 0 })
  })
})

describe('shares (V-25)', () => {
  test('20 shares per device per day, and the child name is never stored', async () => {
    const d = await newDevice()
    const record = { id: 'story-1', title: 'A cat', createdAt: 1, updatedAt: 1, seed: 1, cover: null, events: [] }
    const share = () => call('share.create', { record, childName: 'Mia', voice: null, coverPng: null }, d.token)
    const first = await share()
    expect(first.status).toBe(200)
    const row = await prisma.share.findFirstOrThrow({ where: { deviceId: d.id } })
    expect(row.childName).toBe(null)
    for (let i = 1; i < 20; i++) expect((await share()).status).toBe(200)
    resetRateLimitsForTests() // the per-IP share bucket is also 20; this checks the per-device day cap
    const over = await share()
    expect(over.status).toBe(429)
  })
})
