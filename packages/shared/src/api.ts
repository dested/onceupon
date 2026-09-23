/**
 * The studio <-> server contract. Every entry is `POST /api/app/<name>` with a JSON body of `input`
 * and a JSON `output`; the device token rides in the `x-device-token` header (absent only for
 * `device.register`). Errors: HTTP 4xx/5xx with body `{ error: { code, message } }` (ApiErrorCode).
 * The server validates inputs with zod schemas that satisfy these types; the studio's client is
 * typed from this map. Keep this file dependency-free.
 */
import type { PackId } from './packs'

export type Platform = 'ios' | 'android' | 'web'
export type EarsVendor = 'deepgram' | 'openai' | 'browser'
export type EndReason = 'the-end' | 'sleepy' | 'silence'

export type ApiErrorCode =
  | 'bad_request'
  | 'unauthorized'
  | 'blocked'
  | 'not_found'
  | 'exhausted'
  | 'paused'
  | 'read_only'
  | 'cap'
  | 'already_used'
  | 'invalid_receipt'
  | 'invalid_code'
  | 'consent_required'
  | 'upstream'
  | 'internal'

export interface ApiErrorBody {
  error: { code: ApiErrorCode; message: string }
}

export interface DeviceState {
  deviceId: string
  /** 8 characters, shown to the parent (support, web shop, redeem on the site). */
  code: string
  balanceSec: number
  /** Has ever bought a pack or redeemed a gift (unlocks "share with voice"). */
  paying: boolean
  /** Parent turned on "share with voice" after the consent notice. */
  shareVoice: boolean
  freeStoryUsed: boolean
  blocked: boolean
  /** ISO time of the next weekly free top-up, null if the device is not eligible yet. */
  nextWeeklyAt: string | null
  lastPack: PackId | null
}

export interface ClientConfig {
  earsVendor: Exclude<EarsVendor, 'browser'>
  model: string
  dialect: 'ops' | 'json' | 'lines'
  freeFirstStorySec: number
  weeklyFreeSec: number
  purchasesPaused: boolean
  relayPaused: boolean
  readOnly: boolean
  /** The website shop; the client appends the device code: `${shopUrl}?d=CODE`. */
  shopUrl: string
  redeemUrl: string
  privacyUrl: string
  termsUrl: string
  supportUrl: string
  deleteDataUrl: string
  /** Listening with no words this long shows "say The End when you're done", ms. */
  silenceNudgeMs: number
  /** Listening with no words this long ends the story with the finale, ms. */
  silenceEndMs: number
}

export interface EarsToken {
  vendor: 'deepgram' | 'openai'
  /** Deepgram: a grant token (WebSocket subprotocol `bearer`); OpenAI: an ephemeral client secret `ek_...`. */
  token: string
  expiresAt: string
  model: string
}

export interface SessionStart {
  sessionId: string
  remainingSec: number
  ears: EarsToken | null
  model: string
  dialect: string
}

export interface SharedVoiceClipMeta {
  /** ms on the record clock when the clip starts */
  t: number
  ms: number
  file: string
}

/** A StoryRecord as the studio saves it (mirrors src/story/storage.ts; the server stores it as JSON). */
export interface SharedRecord {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  seed: number
  cover: string | null
  dialect?: string
  events: Array<
    | { k: 'words'; t: number; text: string }
    | { k: 'cmd'; t: number; line: string }
    | { k: 'end'; t: number }
  >
  voice?: { mime: string; clips: SharedVoiceClipMeta[] }
}

export interface ShareSummary {
  id: string
  storyId: string
  url: string
  createdAt: string
  expiresAt: string
  hasVoice: boolean
  views: number
}

export interface AppApi {
  'device.register': {
    input: { installId: string; platform: Platform; appVersion: string | null; storefront: string | null }
    output: DeviceState & { deviceToken: string }
  }
  'device.state': { input: Record<string, never>; output: DeviceState }
  'device.consent': { input: { shareVoice: boolean }; output: DeviceState }
  'device.attribution': { input: { token: string }; output: { ok: true } }
  config: { input: Record<string, never>; output: ClientConfig }
  'mask.list': { input: Record<string, never>; output: { words: string[] } }
  'session.start': { input: { storyId: string; ears: EarsVendor }; output: SessionStart }
  /** Every 15 s while the mic is open; `listeningMs` = mic-open ms since the last beat (or start). */
  'session.beat': {
    input: { sessionId: string; listeningMs: number }
    output: { remainingSec: number; exhausted: boolean }
  }
  /**
   * One typed message. The server charges it as talking time from the text itself
   * (`typedChargeSec` in ./typed: max(3, ceil(words / 2.5)) s); the studio reports no duration.
   */
  'session.typed': {
    input: { sessionId: string; text: string }
    output: { remainingSec: number; exhausted: boolean; chargedSec: number }
  }
  'session.stop': {
    input: { sessionId: string; listeningMs: number; ended: EndReason | null }
    output: { remainingSec: number }
  }
  'ears.token': { input: { sessionId: string }; output: EarsToken }
  'iap.verify': {
    input: { jws: string }
    output: { credited: boolean; seconds: number; balanceSec: number; packId: PackId }
  }
  'iap.restore': { input: { jws: string[] }; output: { credited: number; balanceSec: number } }
  'gift.redeem': { input: { code: string }; output: { seconds: number; balanceSec: number; packId: PackId } }
  'share.create': {
    input: {
      record: SharedRecord
      childName: string | null
      /** Only accepted when the device has `shareVoice` consent and is paying. One file: the clips concatenated by the studio. */
      voice: { mime: string; base64: string } | null
      /** data:image/png or image/jpeg base64 data URL of the cover (the studio's thumbnails are JPEG), or null */
      coverPng: string | null
    }
    output: { id: string; url: string; expiresAt: string }
  }
  'share.unpublish': { input: { id: string }; output: { ok: true } }
  'share.list': { input: Record<string, never>; output: { shares: ShareSummary[] } }
}

export type ApiName = keyof AppApi
export type ApiInput<K extends ApiName> = AppApi[K]['input']
export type ApiOutput<K extends ApiName> = AppApi[K]['output']

/** One text block of the model's user message; `cache` marks an Anthropic prompt-cache breakpoint. */
export interface DrawBlock {
  text: string
  cache?: boolean
}

/** `POST /api/app/draw` (NDJSON stream of DrawChunk lines). The prompt is built by the studio's dialect. */
export interface DrawRequest {
  sessionId: string
  system: string
  user: DrawBlock[]
  maxTokens: number
  dialect: string
  /** This call replaces one the studio threw away because more words arrived. */
  restart: boolean
}

export interface DrawUsage {
  input: number
  cacheRead: number
  cacheWrite: number
  output: number
}

export type DrawChunk =
  | { k: 'text'; text: string }
  | { k: 'usage'; usage: DrawUsage; costUsd: number | null }
  | { k: 'error'; code: ApiErrorCode; message: string }

/** `GET /api/share/:id` for the player and the share page (public, no token). */
export interface PublicShare {
  id: string
  title: string
  childName: string | null
  record: SharedRecord
  hasVoice: boolean
  /** `/api/share/:id/voice` when hasVoice */
  voiceUrl: string | null
  voiceMime: string | null
  /** `/api/share/:id/cover.png` when a cover was uploaded */
  coverUrl: string | null
  createdAt: string
  expiresAt: string
}
