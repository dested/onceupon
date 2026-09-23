import { z } from 'zod'
import { env } from './env'
import { log } from './logger'
import type { EarsToken } from '../../../packages/shared/src/api'
import type { Flags } from './flags'

const deepgramGrant = z.object({ access_token: z.string(), expires_in: z.number() })
const openaiSecret = z.object({ value: z.string(), expires_at: z.number() })

const clampTtl = (ttlSec: number): number => Math.max(60, Math.min(3600, Math.round(ttlSec)))

/** The configured vendor if its key is set, else the other if set, else null (client falls back to browser ears). */
export function pickEarsVendor(flags: Flags): 'deepgram' | 'openai' | null {
  const has = { deepgram: Boolean(env.DEEPGRAM_API_KEY), openai: Boolean(env.OPENAI_API_KEY) }
  if (has[flags.earsVendor]) return flags.earsVendor
  if (has.deepgram) return 'deepgram'
  if (has.openai) return 'openai'
  return null
}

/**
 * The flagged vendor first, then the other one: a key without the grant scope (Deepgram 403) must
 * not leave a session with no ears when the other vendor can carry it.
 */
export async function mintEarsWithFallback(flags: Flags, ttlSec: number): Promise<EarsToken | null> {
  const first = pickEarsVendor(flags)
  if (!first) return null
  const token = await mintEarsToken(first, ttlSec)
  if (token) return token
  const other = first === 'deepgram' ? 'openai' : 'deepgram'
  const has = other === 'deepgram' ? Boolean(env.DEEPGRAM_API_KEY) : Boolean(env.OPENAI_API_KEY)
  if (!has) return null
  log.warn(`ears: ${first} minting failed, falling back to ${other}`)
  return mintEarsToken(other, ttlSec)
}

/** Mint a short-lived streaming-STT credential; null on any upstream failure (log, don't throw). */
export async function mintEarsToken(
  vendor: 'deepgram' | 'openai',
  ttlSec: number
): Promise<EarsToken | null> {
  const ttl = clampTtl(ttlSec)
  try {
    if (vendor === 'deepgram') {
      if (!env.DEEPGRAM_API_KEY) return null
      const res = await fetch('https://api.deepgram.com/v1/auth/grant', {
        method: 'POST',
        headers: { Authorization: `Token ${env.DEEPGRAM_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ttl_seconds: ttl }),
      })
      if (!res.ok) {
        log.warn(`deepgram grant failed: ${res.status}`)
        return null
      }
      const data = deepgramGrant.parse(await res.json())
      return {
        vendor: 'deepgram',
        token: data.access_token,
        expiresAt: new Date(Date.now() + data.expires_in * 1000).toISOString(),
        model: 'nova-3',
      }
    }

    if (!env.OPENAI_API_KEY) return null
    const res = await fetch('https://api.openai.com/v1/realtime/client_secrets', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        expires_after: { anchor: 'created_at', seconds: ttl },
        session: {
          type: 'transcription',
          audio: {
            input: {
              format: { type: 'audio/pcm', rate: 24000 },
              transcription: { model: 'gpt-live-transcribe', language: 'en' },
            },
          },
        },
      }),
    })
    if (!res.ok) {
      log.warn(`openai client secret failed: ${res.status}`)
      return null
    }
    const data = openaiSecret.parse(await res.json())
    return {
      vendor: 'openai',
      token: data.value,
      expiresAt: new Date(data.expires_at * 1000).toISOString(),
      model: 'gpt-live-transcribe',
    }
  } catch (e) {
    log.warn(`ears mint failed (${vendor}): ${e instanceof Error ? e.message : String(e)}`)
    return null
  }
}
