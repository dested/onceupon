import { z } from 'zod'
import type { Recognizer, RecognizerHandlers, RecResult } from './recognition'

/**
 * Streaming speech to text through OpenAI's Realtime transcription API, straight from the
 * browser over a WebSocket (auth via subprotocol; localhost-only app, same stance as the LLM keys).
 * Mic audio goes out as 24kHz PCM16; partial words come back as deltas, finals on server VAD.
 * Presents the same Recognizer/RecResult shape as the Chrome recognizer so the tracker is unchanged.
 */

export const SAMPLE_RATE = 24000

const eventSchema = z.object({
  type: z.string(),
  item_id: z.string().optional(),
  delta: z.string().optional(),
  transcript: z.string().optional(),
  error: z.object({ message: z.string().optional() }).optional(),
})

// Batches ~100ms of PCM16 per message so the socket sees ~10 sends a second, not 200.
const WORKLET_SOURCE = `
class PcmSender extends AudioWorkletProcessor {
  constructor() {
    super()
    this.buf = new Int16Array(2400)
    this.n = 0
    this.step = sampleRate / 24000
    this.pos = 0
    this.prev = 0
  }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0]
    if (!ch) return true
    // linear-interpolation downsample from the device rate to 24k
    let pos = this.pos
    while (pos < ch.length) {
      const i0 = Math.floor(pos)
      const frac = pos - i0
      const a = i0 - 1 >= 0 ? ch[i0 - 1] : this.prev
      const b = ch[i0]
      const v = Math.max(-1, Math.min(1, a + (b - a) * frac))
      this.buf[this.n++] = v < 0 ? v * 32768 : v * 32767
      if (this.n === this.buf.length) {
        this.port.postMessage(this.buf.buffer, [this.buf.buffer])
        this.buf = new Int16Array(2400)
        this.n = 0
      }
      pos += this.step
    }
    this.pos = pos - ch.length
    this.prev = ch[ch.length - 1]
    return true
  }
}
registerProcessor('pcm-sender', PcmSender)
`

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

/** The most recent 30s of mic audio sent to OpenAI, as 24k mono PCM16. Null until the mic runs. */
export let lastClip: (() => Int16Array) | null = null

/** Wrap PCM16 in a WAV container for download. */
export function pcmToWav(pcm: Int16Array, rate = SAMPLE_RATE): Blob {
  const header = new ArrayBuffer(44)
  const v = new DataView(header)
  const write = (o: number, str: string): void => {
    for (let i = 0; i < str.length; i++) v.setUint8(o + i, str.charCodeAt(i))
  }
  write(0, 'RIFF')
  v.setUint32(4, 36 + pcm.byteLength, true)
  write(8, 'WAVE')
  write(12, 'fmt ')
  v.setUint32(16, 16, true)
  v.setUint16(20, 1, true)
  v.setUint16(22, 1, true)
  v.setUint32(24, rate, true)
  v.setUint32(28, rate * 2, true)
  v.setUint16(32, 2, true)
  v.setUint16(34, 16, true)
  write(36, 'data')
  v.setUint32(40, pcm.byteLength, true)
  const data = new Int16Array(pcm)
  return new Blob([header, data], { type: 'audio/wav' })
}

/** Live models stream words continuously with no turn detection; sentence punctuation marks a final. */
export function isLiveModel(model: string): boolean {
  return /live/.test(model)
}

let warmStream: Promise<MediaStream> | null = null
function micConstraints(deviceId: string): MediaStreamConstraints {
  return {
    audio: {
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
    },
  }
}
let warmDeviceId = ''

/** Open the mic ahead of time (only if permission was already granted) so the first click has no gap. */
export async function warmMic(deviceId = ''): Promise<void> {
  if (warmStream && warmDeviceId === deviceId) return
  try {
    const status = await navigator.permissions.query({ name: 'microphone' })
    if (status.state !== 'granted') return
  } catch {
    return
  }
  warmDeviceId = deviceId
  warmStream = navigator.mediaDevices.getUserMedia(micConstraints(deviceId))
  warmStream.catch(() => {
    warmStream = null
  })
}

function takeMic(deviceId: string): Promise<MediaStream> {
  const p = warmStream && warmDeviceId === deviceId ? warmStream : navigator.mediaDevices.getUserMedia(micConstraints(deviceId))
  warmStream = null
  return p
}

/** Audio inputs the browser will let us pick from (labels need a granted permission). */
export async function listMics(): Promise<{ id: string; label: string }[]> {
  try {
    const all = await navigator.mediaDevices.enumerateDevices()
    return all.filter((d) => d.kind === 'audioinput').map((d, i) => ({ id: d.deviceId, label: d.label || `microphone ${i + 1}` }))
  } catch {
    return []
  }
}

export function createOpenAiRealtimeRecognizer(handlers: RecognizerHandlers, opts: RealtimeOptions): Recognizer {
  const live = isLiveModel(opts.model)
  let ws: WebSocket | null = null
  let audioCtx: AudioContext | null = null
  let stream: MediaStream | null = null
  let node: AudioWorkletNode | null = null
  let stopped = true
  // Utterances in arrival order; index is what the tracker keys on.
  const items: Array<{ id: string; transcript: string; isFinal: boolean }> = []
  // Server VAD only finalizes on a pause. A child narrating without pausing would get nothing for
  // ages, so we also commit every few seconds of continuous speech.
  let speaking = false
  let msSinceCommit = 0
  // Last 30s of exactly what we sent, for diagnosis (debug panel "save mic clip").
  const ring: Int16Array[] = []
  const RING_MAX = 300
  const rms = (pcm: Int16Array): number => {
    let acc = 0
    for (let i = 0; i < pcm.length; i++) acc += (pcm[i] ?? 0) * (pcm[i] ?? 0)
    return Math.sqrt(acc / Math.max(1, pcm.length)) / 32768
  }
  let peak = 0.02

  const emit = (changedIndex: number): void => {
    const results: RecResult[] = items.map((it) => ({ transcript: it.transcript, isFinal: it.isFinal }))
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
    node?.port.close()
    node?.disconnect()
    node = null
    stream?.getTracks().forEach((t) => t.stop())
    stream = null
    void audioCtx?.close()
    audioCtx = null
    if (ws && ws.readyState <= WebSocket.OPEN) ws.close()
    ws = null
  }

  const start = async (): Promise<void> => {
    stopped = false
    items.length = 0
    let ready = false
    const pending: ArrayBuffer[] = []
    lastClip = () => {
      let n = 0
      for (const p of ring) n += p.length
      const out = new Int16Array(n)
      let o = 0
      for (const p of ring) {
        out.set(p, o)
        o += p.length
      }
      return out
    }

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
                transcription: { model: opts.model, language: 'en', ...(opts.prompt ? { prompt: opts.prompt } : {}) },
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
        if (stream) handlers.onReady()
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
      ring.push(pcm)
      if (ring.length > RING_MAX) ring.shift()
      socket.send(JSON.stringify({ type: 'input_audio_buffer.append', audio: toBase64(buf) }))
      const ms = (pcm.length / SAMPLE_RATE) * 1000
      msSinceCommit += ms
      handlers.onAudio?.(ms)
      // Commit mid-speech only at a quiet moment, so we never cut a word in half; hard cap regardless.
      const level = rms(pcm)
      handlers.onLevel?.(Math.min(1, level * 6))
      peak = Math.max(level, peak * 0.98)
      const quiet = level < peak * 0.25
      if (!live && speaking && ((msSinceCommit >= opts.maxTurnMs && quiet) || msSinceCommit >= opts.maxTurnMs * 1.8)) {
        msSinceCommit = 0
        socket.send(JSON.stringify({ type: 'input_audio_buffer.commit' }))
      }
    }

    const mic = await takeMic(opts.deviceId)
    if (stopped) {
      mic.getTracks().forEach((t) => t.stop())
      return teardown()
    }
    stream = mic
    audioCtx = new AudioContext()
    const url = URL.createObjectURL(new Blob([WORKLET_SOURCE], { type: 'application/javascript' }))
    await audioCtx.audioWorklet.addModule(url)
    URL.revokeObjectURL(url)
    if (stopped || !audioCtx) return teardown()

    const src = audioCtx.createMediaStreamSource(mic)
    node = new AudioWorkletNode(audioCtx, 'pcm-sender')
    node.port.onmessage = (m: MessageEvent<ArrayBuffer>) => {
      if (ready && socket.readyState === WebSocket.OPEN) send(m.data)
      else if (pending.length < 600) pending.push(m.data)
    }
    src.connect(node)
    // Keep the graph alive without playing the mic back.
    const mute = audioCtx.createGain()
    mute.gain.value = 0
    node.connect(mute).connect(audioCtx.destination)
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
