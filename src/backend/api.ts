import { z } from 'zod'
import { apiUrl } from './config'
import { deviceTokenSettled, getDeviceToken } from './device'
import type {
  ApiErrorCode,
  ApiInput,
  ApiName,
  ApiOutput,
  DrawChunk,
  DrawRequest,
} from '../../packages/shared/src/api'

/**
 * The studio's typed client for the `POST /api/app/<name>` contract in packages/shared/src/api.ts.
 * Inputs are typed from the contract; outputs are trusted to it (no zod on the happy path) except
 * that the body must be a JSON object. The device token rides in `x-device-token` when we have one.
 */

const apiErrorCodeSchema = z.enum([
  'bad_request',
  'unauthorized',
  'blocked',
  'not_found',
  'exhausted',
  'paused',
  'read_only',
  'cap',
  'already_used',
  'invalid_receipt',
  'invalid_code',
  'consent_required',
  'upstream',
  'internal',
])

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ApiErrorCode,
    message: string
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

const errorBodySchema = z.object({
  error: z.object({ code: apiErrorCodeSchema.catch('internal'), message: z.string().catch('') }),
})

async function apiErrorFromResponse(res: Response): Promise<ApiError> {
  const body: unknown = await res.json().catch(() => null)
  const parsed = errorBodySchema.safeParse(body)
  if (parsed.success) return new ApiError(res.status, parsed.data.error.code, parsed.data.error.message)
  return new ApiError(res.status, 'internal', `${res.status}`)
}

function headers(): Record<string, string> {
  const h: Record<string, string> = { 'content-type': 'application/json' }
  const token = getDeviceToken()
  if (token !== null) h['x-device-token'] = token
  return h
}

export async function api<K extends ApiName>(name: K, input: ApiInput<K>): Promise<ApiOutput<K>> {
  // Boot no longer waits for registration, so early calls wait for the token instead of going out bare.
  if (name !== 'device.register') await deviceTokenSettled()
  let res: Response
  try {
    res = await fetch(apiUrl(`/api/app/${name}`), {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify(input),
    })
  } catch {
    throw new ApiError(0, 'upstream', 'offline')
  }
  if (!res.ok) throw await apiErrorFromResponse(res)
  const json: unknown = await res.json().catch(() => null)
  if (typeof json !== 'object' || json === null) throw new ApiError(res.status, 'internal', 'bad response')
  // Output is trusted to the contract; only the "is an object" shape is checked above.
  return json as ApiOutput<K>
}

const drawChunkSchema = z.discriminatedUnion('k', [
  z.object({ k: z.literal('text'), text: z.string() }),
  z.object({
    k: z.literal('usage'),
    usage: z.object({
      input: z.number(),
      cacheRead: z.number(),
      cacheWrite: z.number(),
      output: z.number(),
    }),
    costUsd: z.number().nullable(),
  }),
  z.object({ k: z.literal('error'), code: apiErrorCodeSchema, message: z.string() }),
])

/** `POST /api/app/draw`: an NDJSON stream of DrawChunk lines. Malformed lines are skipped. */
export async function* drawStream(req: DrawRequest, signal: AbortSignal): AsyncGenerator<DrawChunk> {
  await deviceTokenSettled()
  let res: Response
  try {
    res = await fetch(apiUrl('/api/app/draw'), {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify(req),
      signal,
    })
  } catch (e) {
    if (signal.aborted || (e instanceof DOMException && e.name === 'AbortError')) throw e
    throw new ApiError(0, 'upstream', 'offline')
  }
  if (!res.ok) throw await apiErrorFromResponse(res)
  if (!res.body) throw new ApiError(res.status, 'internal', 'no response body')
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  const emit = function* (line: string): Generator<DrawChunk> {
    const trimmed = line.trim()
    if (!trimmed) return
    let parsed: unknown
    try {
      parsed = JSON.parse(trimmed)
    } catch {
      return
    }
    const chunk = drawChunkSchema.safeParse(parsed)
    if (chunk.success) yield chunk.data
  }
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    let nl = buf.indexOf('\n')
    while (nl >= 0) {
      const line = buf.slice(0, nl)
      buf = buf.slice(nl + 1)
      nl = buf.indexOf('\n')
      yield* emit(line)
    }
  }
  yield* emit(buf)
}
