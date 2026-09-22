/**
 * Probe Deepgram Nova-3 streaming with a real key. Streams 24k PCM16 in 100ms frames over the same
 * socket/params `src/speech/deepgram.ts` uses, and prints every Results / UtteranceEnd message with
 * ms since the socket opened, so kid-speech accuracy and latency can be judged.
 *
 * Bun auto-loads .env.local, so no explicit exports are needed:
 *   bun scripts/probe-deepgram.ts               # synthesize a sentence with OpenAI TTS and stream it
 *   bun scripts/probe-deepgram.ts clip.wav      # stream a WAV (24k mono PCM16, e.g. the app's "save clip")
 *
 * Key: DEEPGRAM_API_KEY or VITE_DEEPGRAM_API_KEY. TTS needs OPENAI_API_KEY or VITE_OPENAI_API_KEY.
 */
import { z } from 'zod'

const dgKey = process.env.DEEPGRAM_API_KEY || process.env.VITE_DEEPGRAM_API_KEY
const openaiKey = process.env.OPENAI_API_KEY || process.env.VITE_OPENAI_API_KEY
const path = process.argv[2]
if (!dgKey) {
  console.error('set DEEPGRAM_API_KEY or VITE_DEEPGRAM_API_KEY (Bun loads .env.local)')
  process.exit(1)
}

const SAMPLE_RATE = 24000
const FRAME_SAMPLES = SAMPLE_RATE / 10 // 100ms of audio per frame
const SENTENCE = 'Once upon a time a big green dragon lived in a castle with a princess.'

/** Pull the PCM16 samples out of a WAV file by walking its chunks to the `data` subchunk. */
function pcmFromWav(buf: ArrayBuffer): Int16Array {
  const view = new DataView(buf)
  const tag = (o: number): string =>
    String.fromCharCode(
      view.getUint8(o),
      view.getUint8(o + 1),
      view.getUint8(o + 2),
      view.getUint8(o + 3)
    )
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error('not a WAV file')
  let offset = 12
  while (offset + 8 <= view.byteLength) {
    const id = tag(offset)
    const size = view.getUint32(offset + 4, true)
    const body = offset + 8
    if (id === 'data') {
      const even = size - (size % 2)
      return new Int16Array(buf.slice(body, body + even))
    }
    offset = body + size + (size % 2)
  }
  throw new Error('no data chunk in WAV')
}

/** Synthesize a sentence to 24k mono PCM16 with OpenAI TTS (response_format 'pcm' is raw 24k PCM16). */
async function ttsPcm(text: string, key: string): Promise<Int16Array> {
  const res = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gpt-4o-mini-tts',
      voice: 'alloy',
      input: text,
      response_format: 'pcm',
    }),
  })
  if (!res.ok) throw new Error(`OpenAI TTS ${res.status}: ${(await res.text()).slice(0, 200)}`)
  const buf = await res.arrayBuffer()
  const even = buf.byteLength - (buf.byteLength % 2)
  return new Int16Array(buf.slice(0, even))
}

async function loadPcm(): Promise<{ pcm: Int16Array; source: string }> {
  if (path) return { pcm: pcmFromWav(await Bun.file(path).arrayBuffer()), source: path }
  if (openaiKey)
    return { pcm: await ttsPcm(SENTENCE, openaiKey), source: `OpenAI TTS: "${SENTENCE}"` }
  throw new Error(
    'give a WAV path or set OPENAI_API_KEY / VITE_OPENAI_API_KEY to synthesize speech'
  )
}

const messageSchema = z.object({
  type: z.string(),
  is_final: z.boolean().optional(),
  speech_final: z.boolean().optional(),
  channel: z
    .object({ alternatives: z.array(z.object({ transcript: z.string().optional() })).optional() })
    .optional(),
})

const { pcm, source } = await loadPcm()
console.log(`streaming ${(pcm.length / SAMPLE_RATE).toFixed(1)}s of 24k PCM16 (${source})`)

const url =
  'wss://api.deepgram.com/v1/listen?model=nova-3' +
  '&encoding=linear16&sample_rate=24000&channels=1&language=en&interim_results=true' +
  '&punctuate=true&smart_format=false&numerals=false&filler_words=false&vad_events=true&endpointing=700&utterance_end_ms=1000'

const ws = new WebSocket(url, ['token', dgKey])
let t0 = 0
const ms = (): number => Math.round(performance.now() - t0)

ws.addEventListener('open', () => {
  t0 = performance.now()
  console.log(`[${ms()}ms] open`)
  let i = 0
  const timer = setInterval(() => {
    if (i >= pcm.length) {
      clearInterval(timer)
      ws.send(JSON.stringify({ type: 'CloseStream' }))
      return
    }
    const frame = pcm.subarray(i, Math.min(pcm.length, i + FRAME_SAMPLES))
    ws.send(new Uint8Array(frame.buffer, frame.byteOffset, frame.byteLength))
    i += FRAME_SAMPLES
  }, 100)
})

ws.addEventListener('message', (ev: MessageEvent) => {
  if (typeof ev.data !== 'string') return
  let parsed: unknown
  try {
    parsed = JSON.parse(ev.data)
  } catch {
    return
  }
  const res = messageSchema.safeParse(parsed)
  if (!res.success) return
  const m = res.data
  if (m.type === 'Results') {
    const transcript = m.channel?.alternatives?.[0]?.transcript ?? ''
    console.log(
      `[${ms()}ms] Results  final=${m.is_final ?? false} speech_final=${m.speech_final ?? false}  "${transcript}"`
    )
  } else if (m.type === 'UtteranceEnd') {
    console.log(`[${ms()}ms] UtteranceEnd`)
  } else if (m.type === 'SpeechStarted') {
    console.log(`[${ms()}ms] SpeechStarted`)
  } else if (m.type === 'Metadata') {
    console.log(`[${ms()}ms] Metadata`)
  }
})

ws.addEventListener('close', (ev: CloseEvent) => {
  console.log(`[${ms()}ms] close ${ev.code}`)
  process.exit(0)
})

ws.addEventListener('error', () => {
  console.error('socket error (check the key and network)')
  process.exit(1)
})
