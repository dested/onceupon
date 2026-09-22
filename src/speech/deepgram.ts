import { z } from 'zod'
import type { Recognizer, RecognizerHandlers, RecResult } from './recognition'
import { openPcmMic, rms, SAMPLE_RATE, type PcmMic } from './pcm-mic'

/**
 * Streaming speech to text through Deepgram's Nova-3 listen API, straight from the browser over a
 * WebSocket. Browser auth is the `['token', key]` subprotocol (no headers possible). Mic audio goes
 * out as raw 24kHz PCM16 binary frames; words come back as interim/final Results. Presents the same
 * Recognizer/RecResult shape as the other recognizers so the tracker is unchanged. Reads as a sibling
 * of `openai-realtime.ts` (same start/teardown/stopped structure, same shared mic pipeline).
 */

export interface DeepgramOptions {
  apiKey: string
  model: string
  deviceId: string
}

// Deepgram closes the socket after ~10s of no audio; a KeepAlive resets that timer.
const KEEPALIVE_EVERY_MS = 5000
const KEEPALIVE_AFTER_QUIET_MS = 4000
const ENDPOINT_MS = 700
// Deepgram's minimum is 1000.
const UTTERANCE_END_MS = 1000

const messageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('Results'),
    is_final: z.boolean().optional(),
    speech_final: z.boolean().optional(),
    channel: z
      .object({ alternatives: z.array(z.object({ transcript: z.string().optional() })).optional() })
      .optional(),
  }),
  z.object({ type: z.literal('Metadata') }),
  z.object({ type: z.literal('SpeechStarted') }),
  z.object({ type: z.literal('UtteranceEnd') }),
])

export function createDeepgramRecognizer(
  handlers: RecognizerHandlers,
  opts: DeepgramOptions
): Recognizer {
  const url =
    `wss://api.deepgram.com/v1/listen?model=${encodeURIComponent(opts.model)}` +
    '&encoding=linear16&sample_rate=24000&channels=1&language=en&interim_results=true' +
    '&punctuate=true&smart_format=false&numerals=false&filler_words=false&vad_events=true' +
    // speech_final after this much silence; UtteranceEnd when no new words for this long. Both are
    // "the child stopped talking", tuned to the tracker's 700ms quiet window.
    `&endpointing=${ENDPOINT_MS}&utterance_end_ms=${UTTERANCE_END_MS}`

  let ws: WebSocket | null = null
  let pcmMic: PcmMic | null = null
  let stopped = true
  let ready = false
  let keepAlive = 0
  let lastFrameAt = 0
  // Deepgram finalizes a segment (`is_final`) every few seconds WHILE the child is still talking;
  // only `speech_final` / UtteranceEnd mean the talking stopped. So settled segments stay inside one
  // live (non-final) result until an endpoint, and the tracker's quiet window and mic-energy hold
  // decide the beat; a Deepgram endpoint commits whatever is left as a real final.
  const committed: RecResult[] = []
  const settled: string[] = []
  let interim = ''

  const liveText = (): string => [...settled, interim].filter((s) => s.trim()).join(' ')

  const emit = (changedIndex: number): void => {
    const live = liveText()
    const results: RecResult[] = live
      ? [...committed, { transcript: live, isFinal: false }]
      : [...committed]
    handlers.onResult(results, changedIndex)
  }

  /** The child stopped talking (Deepgram's VAD): release everything settled so far as a final. */
  const commit = (why: string): void => {
    const text = liveText()
    settled.length = 0
    interim = ''
    if (!text) return
    committed.push({ transcript: text, isFinal: true })
    handlers.onTrace?.('final', `${text} (${why})`)
    emit(committed.length - 1)
  }

  const onMessage = (raw: string): void => {
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      return
    }
    const res = messageSchema.safeParse(parsed)
    if (!res.success) return
    const msg = res.data
    switch (msg.type) {
      case 'Results': {
        const transcript = msg.channel?.alternatives?.[0]?.transcript ?? ''
        if (msg.is_final ?? false) {
          // A settled segment: the words will not be rewritten, but the child may still be talking.
          // Deepgram may emit an empty is_final at an endpoint; keep only spoken segments.
          if (transcript.trim()) {
            settled.push(transcript)
            handlers.onTrace?.('delta', `${transcript} (settled)`)
          }
          interim = ''
          if (msg.speech_final ?? false) commit('speech_final')
          else emit(committed.length)
        } else {
          interim = transcript
          // Deepgram sends an empty delta about once a second during silence; do not trace those.
          if (transcript.trim()) handlers.onTrace?.('delta', transcript)
          emit(committed.length)
        }
        break
      }
      case 'SpeechStarted':
        handlers.onTrace?.('speech', 'started')
        break
      case 'UtteranceEnd':
        // No new words for UTTERANCE_END_MS: the thought is done even if speech_final never came.
        handlers.onTrace?.('commit', '')
        commit('utterance_end')
        break
      case 'Metadata':
        // Deepgram sends Metadata at stream end (verified against the live API), not on open, so it
        // is not the readiness signal; the socket is ready to take audio the moment it opens.
        break
      default:
        break
    }
  }

  const teardown = (): void => {
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'CloseStream' }))
    if (ws && ws.readyState <= WebSocket.OPEN) ws.close()
    ws = null
    pcmMic?.stop()
    pcmMic = null
    clearInterval(keepAlive)
    keepAlive = 0
  }

  const start = async (): Promise<void> => {
    stopped = false
    ready = false
    committed.length = 0
    settled.length = 0
    interim = ''
    lastFrameAt = 0
    const pending: ArrayBuffer[] = []

    // Socket auth via subprotocol; the browser cannot set an Authorization header on a WebSocket.
    const socket = new WebSocket(url, ['token', opts.apiKey])
    ws = socket

    const send = (buf: ArrayBuffer): void => {
      // Raw PCM16 binary; Deepgram wants no base64, no JSON envelope.
      socket.send(buf)
      lastFrameAt = Date.now()
      const pcm = new Int16Array(buf)
      const ms = (pcm.length / SAMPLE_RATE) * 1000
      handlers.onAudio?.(ms)
      handlers.onLevel?.(Math.min(1, rms(pcm) * 6))
    }

    socket.onopen = () => {
      // Deepgram accepts audio immediately on open (no session-setup ack), so open is readiness.
      ready = true
      handlers.onTrace?.('ready', opts.model)
      if (pcmMic) handlers.onReady()
      for (const buf of pending) send(buf)
      pending.length = 0
      keepAlive = window.setInterval(() => {
        if (
          socket.readyState === WebSocket.OPEN &&
          Date.now() - lastFrameAt >= KEEPALIVE_AFTER_QUIET_MS
        ) {
          socket.send(JSON.stringify({ type: 'KeepAlive' }))
        }
      }, KEEPALIVE_EVERY_MS)
    }
    socket.onmessage = (m) => {
      if (typeof m.data !== 'string') return
      onMessage(m.data)
    }
    // Deepgram errors surface as a close with a code; onError fires from onclose only.
    socket.onclose = (ev) => {
      if (!stopped) handlers.onError(`deepgram closed (${ev.code})`)
      handlers.onEnd()
    }

    const mic = await openPcmMic({
      deviceId: opts.deviceId,
      onFrame: (buf) => {
        if (socket.readyState === WebSocket.OPEN) send(buf)
        else if (pending.length < 600) pending.push(buf)
      },
    })
    if (stopped) {
      mic.stop()
      return teardown()
    }
    pcmMic = mic
    if (ready) handlers.onReady()
  }

  return {
    start: () => {
      if (!stopped) return
      start().catch((e: unknown) => {
        handlers.onError(e instanceof Error ? e.message : String(e))
        handlers.onEnd()
      })
    },
    stop: () => {
      stopped = true
      teardown()
    },
    abort: () => {
      stopped = true
      teardown()
    },
  }
}
