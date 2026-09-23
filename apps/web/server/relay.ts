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
import { prisma } from './prisma'
import { estimateCost, usdToMicros } from './pricing'
import { maskText } from './mask'
import type { DrawChunk, DrawUsage } from '../../../packages/shared/src/api'

const drawSchema = z.object({
  sessionId: z.string(),
  system: z.string().max(60000),
  user: z
    .array(z.object({ text: z.string().max(30000), cache: z.boolean().optional() }))
    .min(1)
    .max(20),
  maxTokens: z.number().int().min(100).max(4000),
  dialect: z.string().max(16),
  restart: z.boolean(),
})

type DrawBody = z.infer<typeof drawSchema>

// Sonnet 5 / Opus 5 run adaptive thinking by default; the studio wants first tokens fast (see
// root src/llm/providers.ts, which uses the same regex).
const THINKING_OFF = /fable-5|mythos-5|sonnet-5|opus-5|opus-4-8|opus-4-7|sonnet-4-6|opus-4-6/

const utcMidnight = (): Date => {
  const now = new Date()
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
}

/** `POST /api/app/draw` — device auth is done by requireDevice; the device is on res.locals. */
export async function drawHandler(req: Request, res: Response): Promise<void> {
  const device = deviceOf(res)
  const flags = await getFlags()
  if (flags.relayPaused) throw new ApiError(503, 'paused', 'drawing is paused right now')
  if (flags.readOnly) throw new ApiError(503, 'read_only', 'the app is read-only right now')

  const parsed = drawSchema.safeParse(req.body)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    throw new ApiError(400, 'bad_request', issue ? `${issue.path.join('.')}: ${issue.message}` : 'bad request')
  }
  const body = parsed.data

  const session = await sessions.sessionOpenForRelay(device, body.sessionId)
  if (!session) throw new ApiError(409, 'exhausted', 'session is over')

  const spent = await prisma.callLog.aggregate({
    where: { deviceId: device.id, createdAt: { gte: utcMidnight() } },
    _sum: { costMicros: true },
  })
  const spentMicros = spent._sum.costMicros ?? 0
  if (spentMicros >= flags.dailyDeviceCostCapCents * 10000) {
    throw new ApiError(429, 'cap', 'daily limit reached')
  }

  const apiKey = env.ANTHROPIC_API_KEY
  if (!apiKey) throw new ApiError(503, 'upstream', 'drawing is unavailable right now')

  await streamDraw(req, res, device, session.id, body, flags.model, apiKey)
}

async function streamDraw(
  req: Request,
  res: Response,
  device: Device,
  sessionId: string,
  body: DrawBody,
  model: string,
  apiKey: string
): Promise<void> {
  const client = new Anthropic({ apiKey })
  const controller = new AbortController()
  req.on('close', () => controller.abort())

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
    stream = client.messages.stream(
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
        ...(THINKING_OFF.test(model) ? { thinking: { type: 'disabled' } } : {}),
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
    if (!res.writableEnded) res.write(JSON.stringify(chunk) + '\n')
  }

  try {
    for await (const event of stream) {
      if (event.type === 'message_start') {
        usage.input = event.message.usage.input_tokens
        usage.cacheRead = event.message.usage.cache_read_input_tokens ?? 0
        usage.cacheWrite = event.message.usage.cache_creation_input_tokens ?? 0
      } else if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        if (firstTokenMs === null) firstTokenMs = Date.now() - t0
        acc += event.delta.text
        write({ k: 'text', text: event.delta.text })
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
    if (controller.signal.aborted) {
      errored = 'aborted'
    } else {
      errored = e instanceof Error ? e.message : String(e)
      write({ k: 'error', code: 'upstream', message: 'drawing stopped' })
    }
  }

  const costUsd = estimateCost(model, { ...usage, costUsd: null })
  if (errored === null || errored === 'refusal') write({ k: 'usage', usage, costUsd })
  if (!res.writableEnded) res.end()

  // A relayed line is one non-empty streamed line; `skip` means the model judged the words unfit.
  const lines = acc
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
  const skip = lines.some((l) => l === 'skip')
  const lastText = body.user[body.user.length - 1]?.text ?? ''
  const skipWords = skip ? await maskText(lastText.slice(0, 300)) : null

  try {
    await prisma.callLog.create({
      data: {
        deviceId: device.id,
        sessionId,
        model,
        dialect: body.dialect,
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
  } catch (e) {
    log.error(`[relay] call log failed: ${e instanceof Error ? e.message : String(e)}`)
  }
}
