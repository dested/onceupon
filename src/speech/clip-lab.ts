import { z } from 'zod'
import { isLiveModel } from './openai-realtime'
import { pcmToWav, SAMPLE_RATE } from './pcm-mic'

/**
 * Run a saved mic clip through OpenAI transcription models, to tell audio problems from model
 * problems. REST models get the WAV in one POST; realtime-only models get the clip streamed over a
 * socket and committed. No mic involved.
 */

export interface ClipResult {
  model: string
  text: string
  ms: number
  error: string | null
}

/** Models worth comparing: the live one we use, plus the REST ceiling and the classic. */
export const CLIP_LAB_MODELS = ['gpt-live-transcribe', 'gpt-4o-transcribe', 'whisper-1'] as const

const restSchema = z.object({ text: z.string() })
const evSchema = z.object({
  type: z.string(),
  delta: z.string().optional(),
  transcript: z.string().optional(),
  error: z.object({ message: z.string().optional() }).optional(),
})

function toBase64(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000)
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}

async function viaRest(pcm: Int16Array, model: string, apiKey: string): Promise<string> {
  const form = new FormData()
  form.append('file', pcmToWav(pcm), 'clip.wav')
  form.append('model', model)
  form.append('language', 'en')
  const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  })
  if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 120)}`)
  const parsed = restSchema.safeParse(await res.json())
  if (!parsed.success) throw new Error('unexpected response shape')
  return parsed.data.text.trim()
}

function viaRealtime(pcm: Int16Array, model: string, apiKey: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const live = isLiveModel(model)
    const socket = new WebSocket('wss://api.openai.com/v1/realtime?intent=transcription', [
      'realtime',
      `openai-insecure-api-key.${apiKey}`,
    ])
    let text = ''
    let settle = 0
    let hard = 0
    const finish = (): void => {
      clearTimeout(settle)
      clearTimeout(hard)
      if (socket.readyState <= WebSocket.OPEN) socket.close()
      resolve(text.trim())
    }
    const fail = (why: string): void => {
      clearTimeout(settle)
      clearTimeout(hard)
      if (socket.readyState <= WebSocket.OPEN) socket.close()
      reject(new Error(why))
    }
    socket.onerror = () => fail('socket error')
    socket.onopen = () => {
      socket.send(
        JSON.stringify({
          type: 'session.update',
          session: {
            type: 'transcription',
            audio: {
              input: {
                format: { type: 'audio/pcm', rate: SAMPLE_RATE },
                transcription: { model, language: 'en' },
                ...(live ? {} : { turn_detection: null }),
                noise_reduction: { type: 'near_field' },
              },
            },
          },
        })
      )
    }
    socket.onmessage = (m) => {
      if (typeof m.data !== 'string') return
      let raw: unknown
      try {
        raw = JSON.parse(m.data)
      } catch {
        return
      }
      const ev = evSchema.safeParse(raw)
      if (!ev.success) return
      const e = ev.data
      if (e.type === 'session.updated') {
        // Stream the clip in 100ms chunks, then a second of silence so the live model flushes, then commit.
        const step = SAMPLE_RATE / 10
        for (let i = 0; i < pcm.length; i += step) {
          const part = pcm.subarray(i, Math.min(pcm.length, i + step))
          socket.send(
            JSON.stringify({
              type: 'input_audio_buffer.append',
              audio: toBase64(new Uint8Array(part.buffer, part.byteOffset, part.byteLength)),
            })
          )
        }
        const silence = new Int16Array(SAMPLE_RATE)
        socket.send(
          JSON.stringify({
            type: 'input_audio_buffer.append',
            audio: toBase64(new Uint8Array(silence.buffer)),
          })
        )
        socket.send(JSON.stringify({ type: 'input_audio_buffer.commit' }))
        hard = window.setTimeout(finish, 15000)
        settle = window.setTimeout(finish, 4000)
      } else if (e.type === 'conversation.item.input_audio_transcription.delta') {
        text += e.delta ?? ''
        clearTimeout(settle)
        settle = window.setTimeout(finish, 1500)
      } else if (e.type === 'conversation.item.input_audio_transcription.completed') {
        if (e.transcript) text = e.transcript
        finish()
      } else if (e.type === 'error') {
        fail(e.error?.message ?? 'realtime error')
      }
    }
  })
}

export async function transcribeClip(
  pcm: Int16Array,
  model: string,
  apiKey: string
): Promise<ClipResult> {
  const t0 = performance.now()
  try {
    const text = isLiveModel(model)
      ? await viaRealtime(pcm, model, apiKey)
      : await viaRest(pcm, model, apiKey)
    return { model, text, ms: Math.round(performance.now() - t0), error: null }
  } catch (e: unknown) {
    return {
      model,
      text: '',
      ms: Math.round(performance.now() - t0),
      error: e instanceof Error ? e.message : String(e),
    }
  }
}

export function compareClip(
  pcm: Int16Array,
  apiKey: string,
  models: readonly string[] = CLIP_LAB_MODELS
): Promise<ClipResult[]> {
  return Promise.all(models.map((m) => transcribeClip(pcm, m, apiKey)))
}
