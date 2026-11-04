import './setup'
import express from 'express'
import type { AddressInfo } from 'node:net'
import type { Server } from 'node:http'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { appApiRouter } from '../app-api'
import { prisma } from '../prisma'
import { invalidateFlags } from '../flags'
import { resetRateLimitsForTests } from '../rate-limit'
import type { ApiName, ApiInput, DrawChunk } from '../../../../packages/shared/src/api'

/** The studio's real kit system prompt (the relay's allow-list accepts it). */
export async function kitSystemPrompt(): Promise<string> {
  const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../src/llm/kit/prompt.ts')
  const mod: unknown = await import(file)
  const v = typeof mod === 'object' && mod !== null ? Reflect.get(mod, 'KIT_SYSTEM_PROMPT') : undefined
  if (typeof v !== 'string') throw new Error('no KIT_SYSTEM_PROMPT')
  return v
}

let server: Server | null = null
let base = ''

/** The studio API (`/api/app/*`) on an ephemeral port, as server.ts mounts it. */
export async function startApp(): Promise<string> {
  if (server) return base
  const app = express()
  app.use(express.json({ limit: '25mb' }))
  app.use('/api/app', appApiRouter)
  const s = await new Promise<Server>((resolve) => {
    const srv = app.listen(0, '127.0.0.1', () => resolve(srv))
  })
  server = s
  const addr: AddressInfo | string | null = s.address()
  if (!addr || typeof addr === 'string') throw new Error('no address')
  base = `http://127.0.0.1:${addr.port}`
  return base
}

export async function stopApp(): Promise<void> {
  const s = server
  server = null
  if (s) await new Promise<void>((resolve) => s.close(() => resolve()))
}

/** Empty every product table (the admin auth tables are left alone) and the rate-limit counters. */
export async function resetDb(): Promise<void> {
  await prisma.$executeRawUnsafe(
    'TRUNCATE call_log, story_session, ledger_entry, purchase, share, gift_code, alert, audit_log, apple_notification, stripe_event, flag, device CASCADE'
  )
  invalidateFlags()
  resetRateLimitsForTests()
}

export interface Res {
  status: number
  body: unknown
}

export async function call<K extends ApiName>(name: K, input: ApiInput<K>, token?: string): Promise<Res> {
  const r = await fetch(`${base}/api/app/${name}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { 'x-device-token': token } : {}) },
    body: JSON.stringify(input),
  })
  return { status: r.status, body: await r.json() }
}

/** Read a field off an unknown JSON body. */
export function field(body: unknown, ...keys: string[]): unknown {
  let v: unknown = body
  for (const k of keys) v = typeof v === 'object' && v !== null ? Reflect.get(v, k) : undefined
  return v
}

let installSeq = 0

/** A registered device with a token; `consent` gives AI consent too. */
export async function newDevice(opts: { consent?: boolean } = {}): Promise<{ id: string; token: string }> {
  const r = await call('device.register', {
    installId: `test-${Date.now()}-${installSeq++}`,
    platform: 'web',
    appVersion: null,
    storefront: null,
  })
  const token = field(r.body, 'deviceToken')
  const id = field(r.body, 'deviceId')
  if (typeof token !== 'string' || typeof id !== 'string') throw new Error(`register failed ${r.status}`)
  if (opts.consent) await call('device.consent', { aiConsent: true }, token)
  return { id, token }
}

export async function startStory(token: string): Promise<string> {
  const r = await call('session.start', { storyId: `story-${Date.now()}`, ears: 'browser' }, token)
  const id = field(r.body, 'sessionId')
  if (typeof id !== 'string') throw new Error(`session.start failed ${r.status} ${JSON.stringify(r.body)}`)
  return id
}

export interface DrawResult {
  status: number
  chunks: DrawChunk[]
  error: unknown
}

function isChunk(v: unknown): v is DrawChunk {
  const k = field(v, 'k')
  return k === 'text' || k === 'usage' || k === 'error'
}

/** POST /api/app/draw and collect the NDJSON lines (or the JSON error). */
export async function draw(
  token: string,
  sessionId: string,
  over: Partial<{ system: string; user: Array<{ text: string; cache?: boolean }>; maxTokens: number }> = {},
  signal?: AbortSignal
): Promise<DrawResult> {
  const body = {
    sessionId,
    system: over.system ?? (await kitSystemPrompt()),
    user: over.user ?? [{ text: 'STORY SO FAR:' }, { text: 'a cat on the beach', cache: true }],
    maxTokens: over.maxTokens ?? 1200,
    dialect: 'kit',
    restart: false,
  }
  const r = await fetch(`${base}/api/app/draw`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-device-token': token },
    body: JSON.stringify(body),
    signal,
  })
  const text = await r.text()
  if (r.headers.get('content-type')?.includes('ndjson')) {
    const chunks: DrawChunk[] = []
    for (const line of text.split('\n')) {
      if (!line.trim()) continue
      const v: unknown = JSON.parse(line)
      if (isChunk(v)) chunks.push(v)
    }
    return { status: r.status, chunks, error: null }
  }
  return { status: r.status, chunks: [], error: text ? JSON.parse(text) : null }
}

export async function balanceOf(deviceId: string): Promise<number> {
  const d = await prisma.device.findUniqueOrThrow({ where: { id: deviceId } })
  return d.balanceSec
}

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
