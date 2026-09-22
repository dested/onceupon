import { z } from 'zod'
import type { Recognizer, RecognizerHandlers, RecResult } from './recognition'
import { openPcmMic, rms, SAMPLE_RATE, type PcmMic } from './pcm-mic'

/**
 * Streaming speech to text through OpenAI's Realtime transcription API, straight from the
 * browser over a WebSocket (auth via subprotocol; localhost-only app, same stance as the LLM keys).
 * Mic audio goes out as 24kHz PCM16; partial words come back as deltas, finals on server VAD.
 * Presents the same Recognizer/RecResult shape as the Chrome recognizer so the tracker is unchanged.
 * The mic itself is opened through the shared pipeline in `pcm-mic.ts`.
 */

const eventSchema = z.object({
  type: z.string(),
  item_id: z.string().optional(),
  delta: z.string().optional(),
  transcript: z.string().optional(),
  error: z.object({ message: z.string().optional() }).optional(),
})

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return btoa(s)
}

export interface RealtimeOptions {
  apiKey: string
  model: string
  /**
   * Optional steering text. Keep it about the SPEAKER, never example story words: transcription
   * models hallucinate prompt text during silence, which is how a phantom dragon showed up.
   */
  prompt: string
  /** Input device id from listMics(); empty = system default. */
  deviceId: string
  silenceMs: number
  /** Commit mid-speech after this much continuous audio so words show up before the pause. */
  maxTurnMs: number
}

/** Live models stream words continuously with no turn detection; sentence punctuation marks a final. */
export function isLiveModel(model: string): boolean {
  return /live/.test(model)
}

export function createOpenAiRealtimeRecognizer(
  handlers: RecognizerHandlers,
  opts: RealtimeOptions
): Recognizer {
  const live = isLiveModel(opts.model)
  let ws: WebSocket | null = null
  let pcmMic: PcmMic | null = null
  let stopped = true
  // Utterances in arrival order; index is what the tracker keys on.
  const items: Array<{ id: string; transcript: string; isFinal: boolean }> = []
  // Server VAD only finalizes on a pause. A child narrating without pausing would get nothing for
  // ages, so we also commit every few seconds of continuous speech.
  let speaking = false
  let msSinceCommit = 0
  let peak = 0.02

  const emit = (changedIndex: number): void => {
    const results: RecResult[] = items.map((it) => ({
      transcript: it.transcript,
      isFinal: it.isFinal,
    }))
    handlers.onResult(results, changedIndex)
  }

  const itemIndex = (id: string): number => {
    const i = items.findIndex((it) => it.id === id)
    if (i >= 0) return i
    items.push({ id, transcript: '', isFinal: false })
    return items.length - 1
  }

  const onMessage = (raw: string): void => {
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      return
    }
    const ev = eventSchema.safeParse(parsed)
    if (!ev.success) return
    const e = ev.data
    switch (e.type) {
      case 'input_audio_buffer.speech_started':
        speaking = true
        handlers.onTrace?.('speech', 'started')
        break
      case 'input_audio_buffer.speech_stopped':
        speaking = false
        handlers.onTrace?.('speech', 'stopped')
        break
      case 'input_audio_buffer.committed':
        msSinceCommit = 0
        handlers.onTrace?.('commit', '')
        break
      case 'conversation.item.input_audio_transcription.delta': {
        if (live) {
          // One growing utterance for the whole session.
          let cur = items[items.length - 1]
          if (!cur || cur.isFinal) {
            cur = { id: `live-${items.length}`, transcript: '', isFinal: false }
            items.push(cur)
          }
          // Punctuation is NOT a final: the model drops a period on any short breath. The tracker's
          // quiet window decides when a thought is over; the item just keeps growing.
          cur.transcript = (cur.transcript + (e.delta ?? '')).replace(/^\s+/, '')
          handlers.onTrace?.('delta', e.delta ?? '')
          emit(items.length - 1)
          break
        }
        if (!e.item_id) return
        const i = itemIndex(e.item_id)
        const it = items[i]
        if (!it) return
        it.transcript += e.delta ?? ''
        handlers.onTrace?.('delta', e.delta ?? '')
        emit(i)
        break
      }
      case 'conversation.item.input_audio_transcription.completed': {
        if (!e.item_id) return
        const i = itemIndex(e.item_id)
        const it = items[i]
        if (!it) return
        it.transcript = (e.transcript ?? it.transcript).trim()
        it.isFinal = true
        handlers.onTrace?.('final', it.transcript)
        emit(i)
        break
      }
      case 'conversation.item.input_audio_transcription.failed':
        handlers.onError('transcription failed')
        break
      case 'error':
        handlers.onTrace?.('error', e.error?.message ?? 'realtime error')
        handlers.onError(e.error?.message ?? 'realtime error')
        break
      default:
        break
    }
  }

  const teardown = (): void => {
    pcmMic?.stop()
    pcmMic = null
    if (ws && ws.readyState <= WebSocket.OPEN) ws.close()
    ws = null
  }

  const start = async (): Promise<void> => {
    stopped = false
    items.length = 0
    let ready = false
    const pending: ArrayBuffer[] = []

    // Socket and mic open in parallel; audio captured before the session is ready is queued, not lost.
    // GA endpoint: transcription-only session, auth via subprotocol (no beta header, no session model).
    const socket = new WebSocket('wss://api.openai.com/v1/realtime?intent=transcription', [
      'realtime',
      `openai-insecure-api-key.${opts.apiKey}`,
    ])
    ws = socket
    socket.onopen = () => {
      socket.send(
        JSON.stringify({
          type: 'session.update',
          session: {
            type: 'transcription',
            audio: {
              input: {
                format: { type: 'audio/pcm', rate: SAMPLE_RATE },
                transcription: {
                  model: opts.model,
                  language: 'en',
                  ...(opts.prompt ? { prompt: opts.prompt } : {}),
                },
                ...(live
                  ? {}
                  : {
                      turn_detection: {
                        type: 'server_vad',
                        threshold: 0.5,
                        prefix_padding_ms: 300,
                        silence_duration_ms: opts.silenceMs,
                      },
                    }),
                noise_reduction: { type: 'near_field' },
              },
            },
          },
        })
      )
    }
    socket.onmessage = (m) => {
      if (typeof m.data !== 'string') return
      if (!ready && m.data.includes('"session.updated"')) {
        ready = true
        for (const buf of pending) send(buf)
        pending.length = 0
        handlers.onTrace?.('ready', opts.model)
        if (pcmMic) handlers.onReady()
      }
      onMessage(m.data)
    }
    socket.onerror = () => handlers.onError('realtime socket error')
    socket.onclose = (ev) => {
      if (!stopped) handlers.onError(`realtime closed (${ev.code})`)
      handlers.onEnd()
    }

    const send = (buf: ArrayBuffer): void => {
      const pcm = new Int16Array(buf)
      socket.send(JSON.stringify({ type: 'input_audio_buffer.append', audio: toBase64(buf) }))
      const ms = (pcm.length / SAMPLE_RATE) * 1000
      msSinceCommit += ms
      handlers.onAudio?.(ms)
      // Commit mid-speech only at a quiet moment, so we never cut a word in half; hard cap regardless.
      const level = rms(pcm)
      handlers.onLevel?.(Math.min(1, level * 6))
      peak = Math.max(level, peak * 0.98)
      const quiet = level < peak * 0.25
      if (
        !live &&
        speaking &&
        ((msSinceCommit >= opts.maxTurnMs && quiet) || msSinceCommit >= opts.maxTurnMs * 1.8)
      ) {
        msSinceCommit = 0
        socket.send(JSON.stringify({ type: 'input_audio_buffer.commit' }))
      }
    }

    const mic = await openPcmMic({
      deviceId: opts.deviceId,
      onFrame: (buf) => {
        if (ready && socket.readyState === WebSocket.OPEN) send(buf)
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
