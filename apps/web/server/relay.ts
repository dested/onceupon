import Anthropic from '@anthropic-ai/sdk'
import type { Request, Response } from 'express'
import { z } from 'zod'
import type { Device } from '@prisma/client'
import { env } from './env'
import { log } from './logger'
import { getFlags } from './flags'
import { ApiError } from './app-api-types'
import { deviceOf } from './app-api'
import * as sessions from './sessions'
import { requireAiConsent } from './device'
import { prisma } from './prisma'
import { estimateCost, usdToMicros } from './pricing'
import { maskText } from './mask'
import { fastThinking } from './anthropic-thinking'
import { raiseAlert } from './alerts'
import { dialectOfSystem } from './prompt-allowlist'
import type { DrawChunk, DrawUsage } from '../../../packages/shared/src/api'

/** Studio limits (V-03, V-06): ≤ 92 blocks in practice (STORY_DROP_AT 90 + 2); kit 1200 / sketch 1600 tokens. */
const MAX_USER_BLOCKS = 100
const MAX_USER_CHARS = 40_000
const MAX_TOKENS = 1600
/** No first token this long after the call starts: end it as `upstream` / `slow` (V-10). */
const FIRST_TOKEN_DEADLINE_MS = 6_000
/** Calls a session may make per charged minute, plus a grace for the start of a story (V-01). */
const CALLS_PER_CHARGED_MINUTE = 12
const CALL_GRACE = 3
/** The day's total spend is re-read at most this often for the global stop (V-08). */
const SPEND_CACHE_MS = 60_000

const drawSchema = z.object({
  sessionId: z.string(),
  system: z.string().max(60000),
  user: z
    .array(z.object({ text: z.string().max(30000), cache: z.boolean().optional() }))
    .min(1)
    .max(MAX_USER_BLOCKS)
    .refine((blocks) => blocks.reduce((n, b) => n + b.text.length, 0) <= MAX_USER_CHARS, {
      message: `Too long (over ${MAX_USER_CHARS} characters)`,
    }),
  maxTokens: z.number().int().min(100).max(MAX_TOKENS),
  dialect: z.string().max(16),
  restart: z.boolean(),
})

type DrawBody = z.infer<typeof drawSchema>

const utcMidnight = (): Date => {
  const now = new Date()
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
}

const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e))

// One client for the process: a shared keep-alive pool, one retry, a 20 s timeout (V-10, V-13).
// The SDK reads ANTHROPIC_BASE_URL itself, which is how the tests point it at a local fake.
let client: { key: string; anthropic: Anthropic } | null = null
function anthropic(apiKey: string): Anthropic {
  if (!client || client.key !== apiKey) {
    client = { key: apiKey, anthropic: new Anthropic({ apiKey, maxRetries: 1, timeout: 20_000 }) }
  }
  return client.anthropic
}

// ---------------------------------------------------------------- global spend stop (V-08)

let spendCache: { day: number; at: number; micros: number } | null = null
let spendStopAlertDay: number | null = null

/** Today's (UTC) model spend across every device, cached for a minute. */
async function spentTodayMicros(): Promise<number> {
  const day = utcMidnight().getTime()
  if (spendCache && spendCache.day === day && Date.now() - spendCache.at < SPEND_CACHE_MS) {
    return spendCache.micros
  }
  const agg = await prisma.callLog.aggregate({
    where: { createdAt: { gte: new Date(day) } },
    _sum: { costMicros: true },
  })
  spendCache = { day, at: Date.now(), micros: agg._sum.costMicros ?? 0 }
  return spendCache.micros
}

/** Tests: forget the cached day total and the alert-sent marker. */
export function resetSpendCacheForTests(): void {
  spendCache = null
  spendStopAlertDay = null
}

/** One alert per UTC day when the stop line is crossed. */
async function alertSpendStop(micros: number, stopMicros: number): Promise<void> {
  const day = utcMidnight()
  if (spendStopAlertDay === day.getTime()) return
  spendStopAlertDay = day.getTime()
  const already = await prisma.alert.findFirst({
    where: { kind: 'spend_stop', createdAt: { gte: day } },
    select: { id: true },
  })
  if (already) return
  await raiseAlert(
    'spend_stop',
    `Model spend today is $${(micros / 1e6).toFixed(2)}, over the $${(stopMicros / 1e6).toFixed(2)} stop line: free devices cannot draw until 00:00 UTC`,
    { micros, stopMicros, day: day.toISOString().slice(0, 10) }
  )
}

// ---------------------------------------------------------------- the handler

/** `POST /api/app/draw` — device auth is done by requireDevice; the device is on res.locals. */
export async function drawHandler(req: Request, res: Response): Promise<void> {
  const device = deviceOf(res)
  const rawSession: unknown =
    typeof req.body === 'object' && req.body !== null ? Reflect.get(req.body, 'sessionId') : undefined
  const sessionKey = typeof rawSession === 'string' ? rawSession.slice(0, 64) : null
  try {
    await checkAndStream(res, device, req.body)
  } catch (e) {
    // A refused draw is drawing that failed: the session's beat window must not charge for it.
    if (e instanceof ApiError && sessionKey) sessions.recordRefusal(device.id, sessionKey)
    throw e
  }
}

async function checkAndStream(res: Response, device: Device, rawBody: unknown): Promise<void> {
  const flags = await getFlags()
  if (flags.relayPaused) throw new ApiError(503, 'paused', 'drawing is paused right now')
  if (flags.readOnly) throw new ApiError(503, 'read_only', 'the app is read-only right now')
  requireAiConsent(device)

  const parsed = drawSchema.safeParse(rawBody)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    throw new ApiError(400, 'bad_request', issue ? `${issue.path.join('.')}: ${issue.message}` : 'bad request')
  }
  const body = parsed.data

  // The server owns the prompt: only the studio's own kid-safe system prompts are relayed (V-06).
  const dialect = await dialectOfSystem(body.system)
  if (!dialect) throw new ApiError(400, 'bad_request', 'unknown prompt')

  const session = await sessions.sessionOpenForRelay(device, body.sessionId)
  if (!session) throw new ApiError(409, 'exhausted', 'session is over')

  // Global stop for free devices once today's spend passes the line (V-08).
  if (!device.paying && !device.comped && flags.dailySpendStopCents > 0) {
    const stopMicros = flags.dailySpendStopCents * 10_000
    const total = await spentTodayMicros()
    if (total >= stopMicros) {
      void alertSpendStop(total, stopMicros).catch((e: unknown) =>
        log.error(`[relay] spend-stop alert: ${errText(e)}`)
      )
      throw new ApiError(503, 'paused', 'drawing is resting for today')
    }
  }

  // Calls are tied to charged time (V-01). Comped devices are never charged, so they skip this; they
  // keep the per-device daily cap. Upstream failures do not count (an outage must not lock a story out).
  if (!device.comped) {
    const made = await prisma.callLog.count({
      where: { sessionId: session.id, OR: [{ error: null }, { error: { in: ['aborted', 'refusal'] } }] },
    })
    const allowed = Math.floor((CALLS_PER_CHARGED_MINUTE * session.chargedSec) / 60) + CALL_GRACE
    if (made + 1 > allowed) throw new ApiError(429, 'cap', 'too many drawings for the time used')
  }

  // The per-device daily cap reserves this call's worst-case output before it runs (V-07).
  const spent = await prisma.callLog.aggregate({
    where: { deviceId: device.id, createdAt: { gte: utcMidnight() } },
    _sum: { costMicros: true },
  })
  const spentMicros = spent._sum.costMicros ?? 0
  const reserveUsd = estimateCost(flags.model, {
    input: 0,
    cacheRead: 0,
    cacheWrite: 0,
    output: body.maxTokens,
    costUsd: null,
  })
  const reserveMicros = reserveUsd !== null ? usdToMicros(reserveUsd) : 0
  if (spentMicros + reserveMicros > flags.dailyDeviceCostCapCents * 10_000) {
    throw new ApiError(429, 'cap', 'daily limit reached')
  }

  const apiKey = env.ANTHROPIC_API_KEY
  if (!apiKey) throw new ApiError(503, 'upstream', 'drawing is unavailable right now')

  // One call in flight per device (V-07; the studio never has two).
  if (!sessions.beginDraw(device.id, session.id)) {
    throw new ApiError(429, 'cap', 'a drawing is already in progress')
  }
  try {
    await streamDraw(res, device, session.id, body, dialect, flags.model, apiKey)
  } finally {
    sessions.endDraw(device.id)
  }
}

async function streamDraw(
  res: Response,
  device: Device,
  sessionId: string,
  body: DrawBody,
  dialect: string,
  model: string,
  apiKey: string
): Promise<void> {
  const controller = new AbortController()
  let clientGone = false
  let slow = false
  // `res` closes when the client goes away (or after we end it): abort the upstream only in the first
  // case. `req.on('close')` fires once the body is read, not on disconnect (V-11).
  res.on('close', () => {
    if (!res.writableFinished) {
      clientGone = true
      controller.abort()
    }
  })

  const t0 = Date.now()
  const usage: DrawUsage = { input: 0, cacheRead: 0, cacheWrite: 0, output: 0 }
  let firstTokenMs: number | null = null
  let acc = ''
  let stopReason: string | null = null
  let errored: string | null = null

  // The stream object is created synchronously; the network work happens while iterating. A synchronous
  // failure here is a config error before any headers went out -> 502.
  let stream: ReturnType<Anthropic['messages']['stream']>
  try {
    stream = anthropic(apiKey).messages.stream(
      {
        model,
        max_tokens: body.maxTokens,
        system: [{ type: 'text', text: body.system, cache_control: { type: 'ephemeral' } }],
        messages: [
          {
            role: 'user',
            content: body.user.map((b) =>
              b.cache
                ? { type: 'text', text: b.text, cache_control: { type: 'ephemeral' } }
                : { type: 'text', text: b.text }
            ),
          },
        ],
        ...fastThinking(model),
      },
      { signal: controller.signal }
    )
  } catch {
    throw new ApiError(502, 'upstream', 'drawing is unavailable right now')
  }

  res
    .status(200)
    .set({ 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no' })
  res.flushHeaders()

  const write = (chunk: DrawChunk): void => {
    if (!res.writableEnded && !res.destroyed) res.write(JSON.stringify(chunk) + '\n')
  }

  // A slow or overloaded upstream ends the call instead of leaving a stuck "thinking" crayon.
  const deadline = setTimeout(() => {
    if (firstTokenMs === null) {
      slow = true
      controller.abort()
    }
  }, FIRST_TOKEN_DEADLINE_MS)

  try {
    for await (const event of stream) {
      if (event.type === 'message_start') {
        usage.input = event.message.usage.input_tokens
        usage.cacheRead = event.message.usage.cache_read_input_tokens ?? 0
        usage.cacheWrite = event.message.usage.cache_creation_input_tokens ?? 0
      } else if (event.type === 'content_block_delta') {
        if (firstTokenMs === null) firstTokenMs = Date.now() - t0
        if (event.delta.type === 'text_delta') {
          acc += event.delta.text
          write({ k: 'text', text: event.delta.text })
        }
      } else if (event.type === 'message_delta') {
        usage.output = event.usage.output_tokens
        if (event.delta.stop_reason) stopReason = event.delta.stop_reason
      }
    }
    if (stopReason === 'refusal') {
      write({ k: 'error', code: 'upstream', message: 'model refused' })
      errored = 'refusal'
    }
  } catch (e) {
    if (slow) {
      errored = 'slow'
      write({ k: 'error', code: 'upstream', message: 'slow' })
    } else if (clientGone || controller.signal.aborted) {
      errored = 'aborted'
    } else {
      errored = errText(e)
      write({ k: 'error', code: 'upstream', message: 'drawing stopped' })
    }
  } finally {
    clearTimeout(deadline)
  }

  // Output tokens arrive only in the final message_delta: a cut-short call estimates them (V-07).
  if (errored !== null && usage.output === 0 && acc.length > 0) usage.output = Math.ceil(acc.length / 3)

  const costUsd = estimateCost(model, { ...usage, costUsd: null })
  if (errored === null || errored === 'refusal') write({ k: 'usage', usage, costUsd })

  // A relayed line is one non-empty streamed line; `skip` means the model judged the words unfit.
  const lines = acc
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
  const skip = lines.some((l) => l === 'skip')
  const lastText = body.user[body.user.length - 1]?.text ?? ''

  // The row lands before the stream ends, so the next beat, typed settle or call count already sees it.
  try {
    const skipWords = skip ? await maskText(lastText.slice(0, 300)) : null
    await prisma.callLog.create({
      data: {
        deviceId: device.id,
        sessionId,
        model,
        dialect,
        inputTokens: usage.input,
        cachedTokens: usage.cacheRead,
        cacheWrite: usage.cacheWrite,
        outputTokens: usage.output,
        costMicros: costUsd !== null ? usdToMicros(costUsd) : 0,
        firstTokenMs,
        totalMs: Date.now() - t0,
        lines: lines.length,
        restart: body.restart,
        skip,
        skipWords,
        error: errored ? errored.slice(0, 300) : null,
      },
    })
    if (errored === null && !device.freeStoryUsed) await sessions.markDrawSucceeded(device.id)
  } catch (e) {
    log.error(`[relay] call log failed: ${errText(e)}`)
  }
  if (!res.writableEnded && !res.destroyed) res.end()
}
