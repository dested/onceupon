import './test/setup'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { Environment, Type } from '@apple/app-store-server-library'
import { balanceOf, call, field, newDevice, resetDb, startApp, stopApp } from './test/harness'
import { prisma } from './prisma'
import { checkProductionVerifier, setTransactionDecoderForTests } from './apple'
import { processStripeEvent, type StripeEventInput } from './stripe'
import { applyWeeklyGrant, debit } from './ledger'
import { getFlags } from './flags'
import { mintCode } from './gifts'

beforeAll(async () => {
  await startApp()
})

afterAll(async () => {
  await stopApp()
})

beforeEach(async () => {
  await resetDb()
})

afterEach(() => {
  setTransactionDecoderForTests(null)
})

describe('Apple (V-14, mocked verifier)', () => {
  test('boot check: no APPLE_APP_APPLE_ID logs, alerts and returns false; with it, true', async () => {
    expect(await checkProductionVerifier(undefined)).toBe(false)
    expect(await prisma.alert.count({ where: { kind: 'apple_verifier' } })).toBe(1)
    expect(await checkProductionVerifier(1234567890)).toBe(true)
  })

  test('the same transaction verified twice at once credits once', async () => {
    setTransactionDecoderForTests(async (jws) => ({
      productId: 'com.quickgame.squiggletale.pack40',
      transactionId: jws,
      originalTransactionId: jws,
      type: Type.CONSUMABLE,
      environment: Environment.SANDBOX,
      currency: 'USD',
    }))
    const d = await newDevice()
    const before = await balanceOf(d.id)
    const [a, b] = await Promise.all([
      call('iap.verify', { jws: 'tx-1' }, d.token),
      call('iap.verify', { jws: 'tx-1' }, d.token),
    ])
    expect([a.status, b.status]).toEqual([200, 200])
    const credited = [field(a.body, 'credited'), field(b.body, 'credited')].filter((c) => c === true)
    expect(credited.length).toBe(1)
    expect(await balanceOf(d.id)).toBe(before + 2400)
    // A sandbox purchase is stored with its environment (revenue leaves it out, V-18).
    const p = await prisma.purchase.findFirstOrThrow({ where: { deviceId: d.id } })
    expect(p.environment).toBe('Sandbox')
  })
})

describe('Stripe (V-15)', () => {
  const packEvent = (deviceCode: string): StripeEventInput => ({
    id: 'evt_test_1',
    type: 'checkout.session.completed',
    checkout: {
      id: 'cs_test_1',
      amountTotal: 999,
      paymentStatus: 'paid',
      customerEmail: null,
      metadata: { kind: 'pack', packId: 'pack_40', deviceCode },
    },
  })

  test('a failed fulfillment records nothing; the retry credits once; a third delivery is a duplicate', async () => {
    await expect(processStripeEvent(packEvent('ZZZZ2222'))).rejects.toThrow()
    expect(await prisma.stripeEvent.count()).toBe(0)

    const d = await newDevice()
    await prisma.device.update({ where: { id: d.id }, data: { code: 'ZZZZ2222' } })
    const before = await balanceOf(d.id)
    expect(await processStripeEvent(packEvent('ZZZZ2222'))).toBe('checkout.session.completed')
    expect(await processStripeEvent(packEvent('ZZZZ2222'))).toBe('duplicate')
    expect(await balanceOf(d.id)).toBe(before + 2400)
    expect(await prisma.stripeEvent.count()).toBe(1)
  })

  test('a gift checkout mints one code with the event', async () => {
    const ev: StripeEventInput = {
      id: 'evt_gift_1',
      type: 'checkout.session.completed',
      checkout: {
        id: 'cs_gift_1',
        amountTotal: 1999,
        paymentStatus: 'paid',
        customerEmail: 'buyer@example.com',
        metadata: { kind: 'gift', packId: 'pack_120' },
      },
    }
    await processStripeEvent(ev)
    expect(await processStripeEvent(ev)).toBe('duplicate')
    expect(await prisma.giftCode.count()).toBe(1)
    expect(await prisma.stripeEvent.count()).toBe(1)
  })
})

describe('Ledger races (V-04)', () => {
  test('parallel debits never drive the balance negative', async () => {
    const d = await newDevice()
    await prisma.device.update({ where: { id: d.id }, data: { balanceSec: 10 } })
    const results = await Promise.all(Array.from({ length: 6 }, () => debit(d.id, 'debit', 5, null, null)))
    const charged = results.reduce((n, r) => n + r.charged, 0)
    expect(charged).toBe(10)
    expect(await balanceOf(d.id)).toBe(0)
  })

  test('parallel weekly grants apply once', async () => {
    const d = await newDevice()
    // Registered and never granted a fortnight ago: the top-up is due.
    const longAgo = new Date(Date.now() - 14 * 24 * 3600_000)
    await prisma.device.update({ where: { id: d.id }, data: { balanceSec: 0, weeklyGrantAt: null, createdAt: longAgo } })
    const device = await prisma.device.findUniqueOrThrow({ where: { id: d.id } })
    const flags = await getFlags()
    await Promise.all(Array.from({ length: 4 }, () => applyWeeklyGrant(device, flags)))
    expect(await balanceOf(d.id)).toBe(flags.weeklyFreeSec)
    expect(await prisma.ledgerEntry.count({ where: { deviceId: d.id, kind: 'grant_weekly' } })).toBe(1)
  })

  test('a new device waits for its first refill day (no weekly top-up on day one)', async () => {
    const d = await newDevice()
    await prisma.device.update({ where: { id: d.id }, data: { balanceSec: 0, weeklyGrantAt: null } })
    const device = await prisma.device.findUniqueOrThrow({ where: { id: d.id } })
    const flags = await getFlags()
    await applyWeeklyGrant(device, flags)
    expect(await balanceOf(d.id)).toBe(0)
    expect(await prisma.ledgerEntry.count({ where: { deviceId: d.id, kind: 'grant_weekly' } })).toBe(0)
  })

  test('a gift code redeemed twice at once credits once', async () => {
    const code = await mintCode({ packId: 'pack_40', stripeSessionId: 'cs_x', grossCents: 999, feeCents: 0 })
    const d = await newDevice()
    const before = await balanceOf(d.id)
    const [a, b] = await Promise.all([
      call('gift.redeem', { code }, d.token),
      call('gift.redeem', { code }, d.token),
    ])
    expect([a.status, b.status].sort()).toEqual([200, 409])
    expect(await balanceOf(d.id)).toBe(before + 2400)
  })
})

describe('Gift codes in the iOS app (V-17)', () => {
  test('an iOS device cannot redeem in the app', async () => {
    const code = await mintCode({ packId: 'pack_40', stripeSessionId: 'cs_y', grossCents: 999, feeCents: 0 })
    const reg = await call('device.register', {
      installId: 'ios-install-1',
      platform: 'ios',
      appVersion: '1.0',
      storefront: 'USA',
    })
    const token = field(reg.body, 'deviceToken')
    if (typeof token !== 'string') throw new Error('no token')
    const r = await call('gift.redeem', { code }, token)
    expect(r.status).toBe(403)
    expect(field(r.body, 'error', 'code')).toBe('blocked')
  })
})
