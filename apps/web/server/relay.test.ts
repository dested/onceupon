import './test/setup'
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { fake, startFakeAnthropic, stopFakeAnthropic } from './test/fake-anthropic'
import {
  balanceOf,
  call,
  draw,
  field,
  kitSystemPrompt,
  newDevice,
  resetDb,
  sleep,
  startApp,
  startStory,
  stopApp,
} from './test/harness'
import { prisma } from './prisma'
import { resetSpendCacheForTests } from './relay'
import { drawsInFlight, setTypedSettleMsForTests } from './sessions'
import { getFlags, setFlag } from './flags'
import { fulfillCheckout } from './stripe'
import { SKIP_LINE } from './relay'
import {
  dialectOfSystem,
  KNOWN_PROMPTS_KEY,
  reloadPromptAllowListForTests,
  setPersistPromptsForTests,
  setStudioPromptsForTests,
} from './prompt-allowlist'
import * as path from 'node:path'

beforeAll(async () => {
  startFakeAnthropic()
  await startApp()
})

afterAll(async () => {
  await stopApp()
  stopFakeAnthropic()
})

beforeEach(async () => {
  // A draw the previous case aborted may still be writing its CallLog.
  for (let i = 0; i < 100 && drawsInFlight() > 0; i++) await sleep(50)
  await resetDb()
  resetSpendCacheForTests()
  fake.mode = 'ok'
})

const errCode = (body: unknown): unknown => field(body, 'error', 'code')

describe('consent', () => {
  test('no consent: session.start, session.typed and draw answer consent_required', async () => {
    const upstreamBefore = fake.requests
    const d = await newDevice()
    const state = await call('device.state', {}, d.token)
    expect(field(state.body, 'aiConsent')).toBe(false)

    const start = await call('session.start', { storyId: 's1', ears: 'browser' }, d.token)
    expect(start.status).toBe(403)
    expect(errCode(start.body)).toBe('consent_required')

    // A session opened while consent was given, then withdrawn: typed and draw refuse.
    await call('device.consent', { aiConsent: true }, d.token)
    const sessionId = await startStory(d.token)
    const off = await call('device.consent', { aiConsent: false }, d.token)
    expect(field(off.body, 'aiConsent')).toBe(false)

    const typed = await call('session.typed', { sessionId, text: 'a cat' }, d.token)
    expect(typed.status).toBe(403)
    expect(errCode(typed.body)).toBe('consent_required')

    const r = await draw(d.token, sessionId)
    expect(r.status).toBe(403)
    expect(errCode(r.error)).toBe('consent_required')
    expect(fake.requests).toBe(upstreamBefore)
  })

  test('with consent the draw streams; shareVoice is left alone', async () => {
    const d = await newDevice()
    const on = await call('device.consent', { aiConsent: true }, d.token)
    expect(field(on.body, 'aiConsent')).toBe(true)
    expect(field(on.body, 'shareVoice')).toBe(false)
    const sessionId = await startStory(d.token)
    const r = await draw(d.token, sessionId)
    expect(r.status).toBe(200)
    expect(r.chunks.filter((c) => c.k === 'text').length).toBeGreaterThan(0)
    expect(r.chunks.some((c) => c.k === 'usage')).toBe(true)
  })
})

describe('relay limits', () => {
  test('an unknown system prompt is refused', async () => {
    const d = await newDevice({ consent: true })
    const sessionId = await startStory(d.token)
    const before = fake.requests
    const r = await draw(d.token, sessionId, { system: 'You are a helpful assistant.' })
    expect(r.status).toBe(400)
    expect(field(r.error, 'error', 'message')).toBe('unknown prompt')
    expect(fake.requests).toBe(before)
  })

  test('V-03: 60 story blocks pass; 101 blocks, 40k chars or 2000 tokens do not', async () => {
    const d = await newDevice({ consent: true })
    const sessionId = await startStory(d.token)
    const blocks = (n: number, len = 20) => Array.from({ length: n }, (_, i) => ({ text: `chunk ${i} `.padEnd(len, 'x') }))

    const ok = await draw(d.token, sessionId, { user: blocks(60) })
    expect(ok.status).toBe(200)

    const tooMany = await draw(d.token, sessionId, { user: blocks(101) })
    expect(tooMany.status).toBe(400)

    const tooLong = await draw(d.token, sessionId, { user: blocks(5, 8_100) })
    expect(tooLong.status).toBe(400)

    const tooManyTokens = await draw(d.token, sessionId, { maxTokens: 2000 })
    expect(tooManyTokens.status).toBe(400)
  })

  test('one draw in flight per device: a new draw replaces the one in flight', async () => {
    const d = await newDevice({ consent: true })
    const sessionId = await startStory(d.token)
    fake.mode = 'drip'
    const first = draw(d.token, sessionId).catch(() => null)
    await sleep(300)
    expect(drawsInFlight()).toBe(1)
    // The drip runs for 10 s; the second call stops it and takes the slot instead of a 429.
    fake.mode = 'ok'
    const t0 = Date.now()
    const second = await draw(d.token, sessionId)
    expect(second.status).toBe(200)
    expect(Date.now() - t0).toBeLessThan(4000)
    await first
    const logs = await prisma.callLog.findMany({ where: { sessionId }, orderBy: { createdAt: 'asc' } })
    expect(logs.map((l) => l.error)).toEqual(['aborted', null])
    expect(drawsInFlight()).toBe(0)
  })

  test('the studio restart: abort, then draw again at once, is not refused', async () => {
    const d = await newDevice({ consent: true })
    const sessionId = await startStory(d.token)
    fake.mode = 'drip'
    const ctl = new AbortController()
    const first = draw(d.token, sessionId, {}, ctl.signal).catch(() => null)
    await sleep(300)
    ctl.abort()
    fake.mode = 'ok'
    const again = await draw(d.token, sessionId)
    expect(again.status).toBe(200)
    await first
  })

  test('a client abort stops the upstream stream and logs estimated output', async () => {
    const d = await newDevice({ consent: true })
    const sessionId = await startStory(d.token)
    fake.mode = 'drip'
    const closedBefore = fake.closedEarly
    const ctl = new AbortController()
    const pending = draw(d.token, sessionId, {}, ctl.signal).catch(() => null)
    await sleep(500)
    ctl.abort()
    await pending
    // The drip would run for 10 s; the relay must hang up on it right away.
    for (let i = 0; i < 20 && fake.closedEarly === closedBefore; i++) await sleep(100)
    expect(fake.closedEarly).toBe(closedBefore + 1)
    let log = null
    for (let i = 0; i < 20 && !log; i++) {
      log = await prisma.callLog.findFirst({ where: { sessionId } })
      if (!log) await sleep(100)
    }
    expect(log?.error).toBe('aborted')
    expect(log?.outputTokens ?? 0).toBeGreaterThan(0)
  })

  test('no first token in 8 s ends the call as upstream/slow', async () => {
    const d = await newDevice({ consent: true })
    const sessionId = await startStory(d.token)
    fake.mode = 'slow'
    const t0 = Date.now()
    const r = await draw(d.token, sessionId)
    expect(Date.now() - t0).toBeLessThan(9_900)
    const err = r.chunks.find((c) => c.k === 'error')
    expect(err).toEqual({ k: 'error', code: 'upstream', message: 'slow' })
  }, 15_000)

  test('calls are tied to charged time: 8 grace calls, then cap', async () => {
    const d = await newDevice({ consent: true })
    const sessionId = await startStory(d.token)
    for (let i = 0; i < 8; i++) expect((await draw(d.token, sessionId)).status).toBe(200)
    const fourth = await draw(d.token, sessionId)
    expect(fourth.status).toBe(429)
    // 15 s of mic time buys 3 more (12 per charged minute).
    await call('session.beat', { sessionId, listeningMs: 15_000 }, d.token)
    expect((await draw(d.token, sessionId)).status).toBe(200)
  })

  test('global spend stop refuses free devices, not paying ones, and alerts once', async () => {
    await setFlag('dailySpendStopCents', 100, 'test')
    const other = await newDevice({ consent: true })
    await prisma.callLog.create({
      data: { deviceId: other.id, model: 'x', dialect: 'kit', costMicros: 2_000_000 },
    })
    const free = await newDevice({ consent: true })
    const freeSession = await startStory(free.token)
    const r = await draw(free.token, freeSession)
    expect(r.status).toBe(503)
    expect(errCode(r.error)).toBe('paused')
    await draw(free.token, freeSession)
    await sleep(200)
    expect(await prisma.alert.count({ where: { kind: 'spend_stop' } })).toBe(1)

    const payer = await newDevice({ consent: true })
    await prisma.device.update({ where: { id: payer.id }, data: { paying: true } })
    const paySession = await startStory(payer.token)
    expect((await draw(payer.token, paySession)).status).toBe(200)
  })
})

describe('no charge for failed drawing', () => {
  test('a typed message whose draw fails is refunded', async () => {
    setTypedSettleMsForTests(400)
    const d = await newDevice({ consent: true })
    const sessionId = await startStory(d.token)
    const before = await balanceOf(d.id)
    fake.mode = 'error'
    const typed = await call('session.typed', { sessionId, text: 'the cat jumped over the moon' }, d.token)
    expect(field(typed.body, 'chargedSec')).toBeGreaterThan(0)
    const r = await draw(d.token, sessionId)
    expect(r.chunks.some((c) => c.k === 'error')).toBe(true)
    await sleep(900)
    expect(await balanceOf(d.id)).toBe(before)
    expect(await prisma.ledgerEntry.count({ where: { deviceId: d.id, kind: 'refund_failed_draw' } })).toBe(1)
  })

  test('a typed message whose draw lands keeps its charge', async () => {
    setTypedSettleMsForTests(400)
    const d = await newDevice({ consent: true })
    const sessionId = await startStory(d.token)
    const before = await balanceOf(d.id)
    const typed = await call('session.typed', { sessionId, text: 'the cat jumped' }, d.token)
    const charged = field(typed.body, 'chargedSec')
    expect((await draw(d.token, sessionId)).status).toBe(200)
    await sleep(900)
    expect(await balanceOf(d.id)).toBe(before - Number(charged))
  })

  test('a beat window where every call failed charges 0; a good window charges', async () => {
    const d = await newDevice({ consent: true })
    const sessionId = await startStory(d.token)
    const before = await balanceOf(d.id)
    fake.mode = 'error'
    await draw(d.token, sessionId)
    const bad = await call('session.beat', { sessionId, listeningMs: 15_000 }, d.token)
    expect(field(bad.body, 'remainingSec')).toBe(before)

    fake.mode = 'ok'
    expect((await draw(d.token, sessionId)).status).toBe(200)
    const good = await call('session.beat', { sessionId, listeningMs: 15_000 }, d.token)
    expect(field(good.body, 'remainingSec')).toBe(before - 15)
  })

  test('freeStoryUsed flips on the first successful draw, not on session start', async () => {
    const d = await newDevice({ consent: true })
    const sessionId = await startStory(d.token)
    expect(field((await call('device.state', {}, d.token)).body, 'freeStoryUsed')).toBe(false)
    fake.mode = 'error'
    await draw(d.token, sessionId)
    expect(field((await call('device.state', {}, d.token)).body, 'freeStoryUsed')).toBe(false)
    fake.mode = 'ok'
    await draw(d.token, sessionId)
    expect(field((await call('device.state', {}, d.token)).body, 'freeStoryUsed')).toBe(true)
  })
})

describe('cloud ears', () => {
  test('off by default: no token on start, ears.token blocked', async () => {
    const d = await newDevice({ consent: true })
    const r = await call('session.start', { storyId: 'x', ears: 'deepgram' }, d.token)
    expect(r.status).toBe(200)
    expect(field(r.body, 'ears')).toBe(null)
    const sessionId = field(r.body, 'sessionId')
    if (typeof sessionId !== 'string') throw new Error('no session')
    const t = await call('ears.token', { sessionId }, d.token)
    expect(t.status).toBe(403)
    expect(errCode(t.body)).toBe('blocked')
  })
})

describe('free tier model (decision 4b)', () => {
  const paidModel = 'claude-sonnet-5-5'
  const freeModel = 'claude-haiku-5-5'

  const lastLog = async (sessionId: string) =>
    prisma.callLog.findFirstOrThrow({ where: { sessionId }, orderBy: { createdAt: 'desc' } })

  test('a free device draws with freeModel', async () => {
    await setFlag('freeModel', freeModel, 'test')
    const d = await newDevice({ consent: true })
    const sessionId = await startStory(d.token)
    expect((await draw(d.token, sessionId)).status).toBe(200)
    expect(fake.lastModel).toBe(freeModel)
    expect((await lastLog(sessionId)).model).toBe(freeModel)
  })

  test('a device with a pack credit draws with model', async () => {
    await setFlag('freeModel', freeModel, 'test')
    const d = await newDevice({ consent: true })
    const code = (await prisma.device.findUniqueOrThrow({ where: { id: d.id } })).code
    await fulfillCheckout({
      id: 'cs_model_1',
      amountTotal: 999,
      paymentStatus: 'paid',
      customerEmail: null,
      metadata: { kind: 'pack', packId: 'pack_40', deviceCode: code },
    })
    const sessionId = await startStory(d.token)
    expect((await draw(d.token, sessionId)).status).toBe(200)
    expect(fake.lastModel).toBe(paidModel)
    expect((await lastLog(sessionId)).model).toBe(paidModel)
  })

  test('a comped device draws with model', async () => {
    await setFlag('freeModel', freeModel, 'test')
    const d = await newDevice({ consent: true })
    await prisma.device.update({ where: { id: d.id }, data: { comped: true } })
    const sessionId = await startStory(d.token)
    expect((await draw(d.token, sessionId)).status).toBe(200)
    expect(fake.lastModel).toBe(paidModel)
  })

  test('a `# nothing` reply logs a skip; `wait` does not', async () => {
    const d = await newDevice({ consent: true })
    const sessionId = await startStory(d.token)
    fake.mode = 'nothing'
    await draw(d.token, sessionId)
    const nothing = await lastLog(sessionId)
    expect(nothing.skip).toBe(true)
    expect(nothing.skipWords).not.toBe(null)
    fake.mode = 'wait'
    await draw(d.token, sessionId)
    expect((await lastLog(sessionId)).skip).toBe(false)
  })

  test("the relay's skip rule is the studio's KIT_SKIP_RE", async () => {
    const file = path.resolve(import.meta.dir, '../../../src/llm/kit/dialect.ts')
    const mod: unknown = await import(file)
    const studio = typeof mod === 'object' && mod !== null ? Reflect.get(mod, 'KIT_SKIP_RE') : undefined
    expect(studio instanceof RegExp).toBe(true)
    if (!(studio instanceof RegExp)) return
    expect(SKIP_LINE.source).toBe(studio.source)
    expect(SKIP_LINE.flags).toBe(studio.flags)
  })
})

describe('known prompt hashes', () => {
  test('a prompt that ran before an edit and a reboot is still accepted', async () => {
    try {
      setPersistPromptsForTests(true) // the production deployment
      // Boot 1 ships the old prompt; boot 2 (after the edit) ships the new one.
      setStudioPromptsForTests([{ dialect: 'kit', text: 'kit prompt, release 1' }])
      expect(await dialectOfSystem('kit prompt, release 1')).toBe('kit')
      setStudioPromptsForTests([{ dialect: 'kit', text: 'kit prompt, release 2' }])
      expect(await dialectOfSystem('kit prompt, release 2')).toBe('kit')
      expect(await dialectOfSystem('kit prompt, release 1')).toBe('kit')
      expect(await dialectOfSystem('a prompt nobody shipped')).toBe(null)
      const row = await prisma.flag.findUniqueOrThrow({ where: { key: KNOWN_PROMPTS_KEY } })
      expect(Array.isArray(row.value) ? row.value.length : 0).toBe(2)

      // The relay takes the old prompt end to end.
      const d = await newDevice({ consent: true })
      const sessionId = await startStory(d.token)
      expect((await draw(d.token, sessionId, { system: 'kit prompt, release 1' })).status).toBe(200)

      // The hidden row never shows on the admin flags page.
      reloadPromptAllowListForTests()
      expect(Object.keys(await getFlags())).not.toContain(KNOWN_PROMPTS_KEY)
    } finally {
      setStudioPromptsForTests(null)
      setPersistPromptsForTests(null)
    }
  })

  test('outside production the boot hashes are accepted in memory and the row is never written', async () => {
    try {
      setPersistPromptsForTests(false)
      setStudioPromptsForTests([{ dialect: 'kit', text: 'local, unreleased kit prompt' }])
      expect(await dialectOfSystem('local, unreleased kit prompt')).toBe('kit')
      expect(await prisma.flag.findUnique({ where: { key: KNOWN_PROMPTS_KEY } })).toBe(null)

      // Hashes production already stored are still accepted here.
      const stored = 'a'.repeat(64)
      await prisma.flag.create({
        data: {
          key: KNOWN_PROMPTS_KEY,
          value: [{ dialect: 'sketch', sha256: stored, firstSeen: 'x' }],
          updatedBy: 'boot',
        },
      })
      setStudioPromptsForTests([{ dialect: 'kit', text: 'another local kit prompt' }])
      expect(await dialectOfSystem('another local kit prompt')).toBe('kit')
      const row = await prisma.flag.findUniqueOrThrow({ where: { key: KNOWN_PROMPTS_KEY } })
      expect(row.value).toEqual([{ dialect: 'sketch', sha256: stored, firstSeen: 'x' }])
    } finally {
      setStudioPromptsForTests(null)
      setPersistPromptsForTests(null)
    }
  })

  test("this build's studio prompts are accepted", async () => {
    reloadPromptAllowListForTests()
    expect(await dialectOfSystem(await kitSystemPrompt())).toBe('kit')
  })
})
