/**
 * End-to-end smoke test for the money + share paths. Run against a live dev server:
 *   cd apps/web && bun run dev            # in one shell (needs a reachable DATABASE_URL)
 *   cd apps/web && bun scripts/smoke-money.ts
 * Mints a gift straight through Prisma, redeems it over HTTP, then publishes and takes down a share.
 */
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { prisma } from '../server/prisma'
import { mintCode } from '../server/gifts'
import { packById } from '../../../packages/shared/src/packs'
import type { SharedRecord } from '../../../packages/shared/src/api'

const BASE = process.env.SMOKE_BASE ?? 'http://localhost:7720'

let failures = 0
function pass(step: string, detail = ''): void {
  console.log(`PASS ${step}${detail ? ` — ${detail}` : ''}`)
}
function fail(step: string, detail: string): void {
  failures += 1
  console.log(`FAIL ${step} — ${detail}`)
}

async function appCall(name: string, input: unknown, token?: string): Promise<unknown> {
  const res = await fetch(`${BASE}/api/app/${name}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { 'x-device-token': token } : {}),
    },
    body: JSON.stringify(input),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`${name} -> ${res.status}: ${text}`)
  return text ? JSON.parse(text) : {}
}

const registerSchema = z.object({
  deviceToken: z.string(),
  code: z.string(),
  balanceSec: z.number(),
})
const redeemSchema = z.object({ seconds: z.number(), balanceSec: z.number(), packId: z.string() })
const stateSchema = z.object({ balanceSec: z.number() })
const shareSchema = z.object({ id: z.string(), url: z.string(), expiresAt: z.string() })

async function main(): Promise<void> {
  const packId = 'pack_40' as const
  const pack = packById(packId)

  // 1. Register a device.
  let token = ''
  let deviceCode = ''
  try {
    const raw = await appCall('device.register', {
      installId: `smoke-${randomUUID()}`,
      platform: 'web',
      appVersion: '0.0.0',
      storefront: null,
    })
    const reg = registerSchema.parse(raw)
    token = reg.deviceToken
    deviceCode = reg.code
    pass('device.register', `code ${deviceCode}, balance ${reg.balanceSec}s`)
  } catch (err) {
    fail('device.register', err instanceof Error ? err.message : String(err))
    return // nothing else can run without a device
  }

  // 2. Mint a gift code directly through Prisma (as the Stripe webhook would).
  let code = ''
  try {
    code = await mintCode({
      packId,
      stripeSessionId: `smoke_${randomUUID()}`,
      grossCents: pack.priceCents,
      feeCents: Math.round(pack.priceCents * 0.029) + 30,
    })
    pass('mintCode', code)
  } catch (err) {
    fail('mintCode', err instanceof Error ? err.message : String(err))
    return
  }

  // 3. Redeem the gift over HTTP.
  let balanceAfterRedeem = 0
  try {
    const redeem = redeemSchema.parse(await appCall('gift.redeem', { code }, token))
    balanceAfterRedeem = redeem.balanceSec
    if (redeem.seconds !== pack.seconds) throw new Error(`credited ${redeem.seconds}, expected ${pack.seconds}`)
    pass('gift.redeem', `+${redeem.seconds}s, balance ${redeem.balanceSec}s`)
  } catch (err) {
    fail('gift.redeem', err instanceof Error ? err.message : String(err))
  }

  // 4. Balance reflects the redemption.
  try {
    const state = stateSchema.parse(await appCall('device.state', {}, token))
    if (state.balanceSec < pack.seconds) throw new Error(`balance ${state.balanceSec} < ${pack.seconds}`)
    if (state.balanceSec !== balanceAfterRedeem) {
      throw new Error(`state ${state.balanceSec} != redeem ${balanceAfterRedeem}`)
    }
    pass('device.state', `balance ${state.balanceSec}s`)
  } catch (err) {
    fail('device.state', err instanceof Error ? err.message : String(err))
  }

  // 5. Create a share (no voice — free path).
  const record: SharedRecord = {
    id: `smoke-story-${randomUUID().slice(0, 8)}`,
    title: 'The brave little crayon',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    seed: 42,
    cover: null,
    events: [
      { k: 'words', t: 0, text: 'once upon a time' },
      { k: 'cmd', t: 100, line: 'draw sun' },
      { k: 'end', t: 2000 },
    ],
  }
  let shareId = ''
  try {
    const share = shareSchema.parse(
      await appCall('share.create', { record, childName: null, voice: null, coverPng: null }, token)
    )
    shareId = share.id
    pass('share.create', share.url)
  } catch (err) {
    fail('share.create', err instanceof Error ? err.message : String(err))
  }

  // 6. Public fetch of the share.
  if (shareId) {
    try {
      const res = await fetch(`${BASE}/api/share/${shareId}`)
      if (res.status !== 200) throw new Error(`status ${res.status}`)
      pass('GET /api/share/:id', 'public replay available')
    } catch (err) {
      fail('GET /api/share/:id', err instanceof Error ? err.message : String(err))
    }
  }

  // 7. Unpublish.
  if (shareId) {
    try {
      await appCall('share.unpublish', { id: shareId }, token)
      pass('share.unpublish')
    } catch (err) {
      fail('share.unpublish', err instanceof Error ? err.message : String(err))
    }
  }

  // 8. The link is now dead (404).
  if (shareId) {
    try {
      const res = await fetch(`${BASE}/api/share/${shareId}`)
      if (res.status !== 404) throw new Error(`expected 404, got ${res.status}`)
      pass('GET /api/share/:id after unpublish', '404 as expected')
    } catch (err) {
      fail('GET /api/share/:id after unpublish', err instanceof Error ? err.message : String(err))
    }
  }
}

main()
  .catch((err) => {
    fail('smoke', err instanceof Error ? err.message : String(err))
  })
  .finally(async () => {
    await prisma.$disconnect()
    console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILED`)
    process.exit(failures === 0 ? 0 : 1)
  })
