/**
 * The iPad's on-device ears through the native shell (SpeechAnalyzer on iPadOS 26+, else on-device
 * SFSpeechRecognizer; Whistle, the bundled Cactus model, when the ears setting asks for it). Free and offline after the first model download. Same Recognizer shape as the
 * streaming recognizers; results, loudness and readiness arrive as bridge events. The shell owns the
 * mic while these ears listen, so it also records the span: `takeClip()` hands the voice clip over
 * after `stop()` (the studio's VoiceRecorder collects it through ExternalClipSource).
 */
import { z } from 'zod'
import { SPEECH_ENGINES } from '../../packages/shared/src/bridge'
import { base64ToBlob, bridgeCall, hasBridge, onBridgeEvent } from '~/backend/bridge'
import type { ExternalClipSource } from '~/story/voice'
import type { RecResult, Recognizer, RecognizerHandlers } from './recognition'

const resultSchema = z.object({
  results: z.array(z.object({ transcript: z.string(), isFinal: z.boolean() })),
})
const levelSchema = z.object({ level: z.number() })
const errorSchema = z.object({ code: z.string(), message: z.string() })
const availableSchema = z.object({
  engine: z.enum(SPEECH_ENGINES).nullable(),
  engines: z.array(z.enum(SPEECH_ENGINES)).optional(),
  permission: z.enum(['granted', 'denied', 'undetermined']),
})
const startSchema = z.object({ available: z.boolean(), engine: z.enum(SPEECH_ENGINES).optional() })
const stopSchema = z.object({
  clip: z.object({ base64: z.string(), mime: z.string(), ms: z.number() }).nullable().optional(),
})

export type AppleEngine = (typeof SPEECH_ENGINES)[number]

export interface AppleEarsOffer {
  /** The engine the shell picks by itself, or null (web, old shell, unsupported OS, mic denied). */
  engine: AppleEngine | null
  /** Every engine the shell can run; one of these can be asked for by name. */
  engines: AppleEngine[]
}

/** The on-device engines this shell offers for `locale`. Never throws. */
export async function appleEars(locale: string): Promise<AppleEarsOffer> {
  const none: AppleEarsOffer = { engine: null, engines: [] }
  if (!hasBridge()) return none
  try {
    const out = availableSchema.safeParse(await bridgeCall('speech.available', { locale }))
    if (!out.success || out.data.permission === 'denied') return none
    const { engine } = out.data
    // Shells from before the list offer only their own pick.
    return { engine, engines: out.data.engines ?? (engine ? [engine] : []) }
  } catch {
    // shells from before speech.available (or no shell): not offered
    return none
  }
}

/** Message prefix the session reads to fall back to cloud ears. */
export const APPLE_UNAVAILABLE = 'apple-unavailable'

export interface AppleRecognizer extends Recognizer, ExternalClipSource {
  readonly engine: AppleEngine | null
}

export function createAppleRecognizer(
  handlers: RecognizerHandlers,
  opts: { locale: string; record: boolean; engine?: AppleEngine }
): AppleRecognizer {
  let unsubs: Array<() => void> = []
  let running = false
  let ready = false
  let ended = true
  let engine: AppleEngine | null = null
  let stopping: Promise<{ blob: Blob; ms: number } | null> | null = null

  const finish = (): void => {
    if (ended) return
    ended = true
    running = false
    for (const u of unsubs) u()
    unsubs = []
    handlers.onEnd()
  }
  const markReady = (): void => {
    if (ready || !running) return
    ready = true
    handlers.onTrace?.('ready', engine ?? 'apple')
    handlers.onReady()
  }

  const subscribe = (): void => {
    unsubs = [
      onBridgeEvent('speech.ready', () => markReady()),
      onBridgeEvent('speech.result', (data) => {
        const r = resultSchema.safeParse(data)
        if (!r.success) return
        const results: RecResult[] = r.data.results
        const last = results[results.length - 1]
        if (last) handlers.onTrace?.(last.isFinal ? 'final' : 'delta', last.transcript)
        handlers.onResult(results, 0)
      }),
      onBridgeEvent('speech.level', (data) => {
        const r = levelSchema.safeParse(data)
        if (r.success) handlers.onLevel?.(r.data.level)
      }),
      onBridgeEvent('speech.error', (data) => {
        const r = errorSchema.safeParse(data)
        const msg = r.success ? `${r.data.code}: ${r.data.message}` : 'speech error'
        handlers.onTrace?.('error', msg)
        handlers.onError(msg)
      }),
      onBridgeEvent('speech.end', () => {
        if (!stopping) finish()
      }),
    ]
  }

  const rec: AppleRecognizer = {
    get engine() {
      return engine
    },
    start: () => {
      if (running) return
      running = true
      ready = false
      ended = false
      stopping = null
      subscribe()
      void bridgeCall('speech.start', {
        locale: opts.locale,
        onDevice: true,
        record: opts.record,
        ...(opts.engine ? { engine: opts.engine } : {}),
      })
        .then((raw) => {
          const out = startSchema.safeParse(raw)
          if (!out.success || !out.data.available) {
            handlers.onError(`${APPLE_UNAVAILABLE}: the shell could not start on-device ears`)
            finish()
            return
          }
          engine = out.data.engine ?? 'sfspeech'
          // Shells that predate speech.ready are listening once start resolves.
          if (!out.data.engine) markReady()
        })
        .catch((e: unknown) => {
          handlers.onError(`${APPLE_UNAVAILABLE}: ${e instanceof Error ? e.message : String(e)}`)
          finish()
        })
    },
    stop: () => {
      if (!running || stopping) return
      stopping = bridgeCall('speech.stop', {})
        .then((raw) => {
          const out = stopSchema.safeParse(raw)
          const clip = out.success ? out.data.clip : null
          return clip ? { blob: base64ToBlob(clip.base64, clip.mime), ms: clip.ms } : null
        })
        .catch(() => null)
        .finally(() => finish())
    },
    abort: () => {
      rec.stop()
    },
    takeClip: () => (stopping ?? Promise.resolve(null)).then((c) => {
      stopping = null
      return c
    }),
  }
  return rec
}
