/**
 * Shared 24kHz PCM16 microphone pipeline. Both streaming recognizers (OpenAI Realtime and Deepgram)
 * open the mic through here: it downsamples to 24k mono via an AudioWorklet, keeps the last 30s of
 * audio for the voice lab (`lastClip`), and hands each PCM16 frame to a caller-supplied `onFrame`.
 * Everything socket-specific (auth, message shape, metering, commit rules) lives in the recognizers.
 */

export const SAMPLE_RATE = 24000

// Batches ~100ms of PCM16 per message so a socket sees ~10 sends a second, not 200.
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

/** RMS loudness of one PCM16 frame, 0..1. */
export function rms(pcm: Int16Array): number {
  let acc = 0
  for (let i = 0; i < pcm.length; i++) acc += (pcm[i] ?? 0) * (pcm[i] ?? 0)
  return Math.sqrt(acc / Math.max(1, pcm.length)) / 32768
}

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

let warmStream: Promise<MediaStream> | null = null
let warmDeviceId = ''

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
  const p =
    warmStream && warmDeviceId === deviceId
      ? warmStream
      : navigator.mediaDevices.getUserMedia(micConstraints(deviceId))
  warmStream = null
  return p
}

/** Audio inputs the browser will let us pick from (labels need a granted permission). */
export async function listMics(): Promise<{ id: string; label: string }[]> {
  try {
    const all = await navigator.mediaDevices.enumerateDevices()
    return all
      .filter((d) => d.kind === 'audioinput')
      .map((d, i) => ({ id: d.deviceId, label: d.label || `microphone ${i + 1}` }))
  } catch {
    return []
  }
}

/** The most recent 30s of mic audio, as 24k mono PCM16. Null until the mic runs. */
export let lastClip: (() => Int16Array) | null = null

const RING_MAX = 300

export interface PcmMic {
  stop(): void
}

/** The mic stream currently open through openPcmMic, so the voice recorder can tap it. Null when closed. */
let currentStream: MediaStream | null = null

export function currentMicStream(): MediaStream | null {
  return currentStream
}

export interface PcmMicOptions {
  /** Input device id from listMics(); empty = system default. */
  deviceId: string
  /** One PCM16 frame from the worklet; the caller decides what to do with it. */
  onFrame: (buf: ArrayBuffer) => void
}

/**
 * Open the microphone and stream 24k PCM16 frames to `onFrame`. Every frame is also pushed into the
 * 30s ring behind `lastClip` before the caller sees it, so the voice lab always has the real audio.
 */
export async function openPcmMic(opts: PcmMicOptions): Promise<PcmMic> {
  const ring: Int16Array[] = []
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

  const mic = await takeMic(opts.deviceId)
  currentStream = mic
  const audioCtx = new AudioContext()
  const url = URL.createObjectURL(new Blob([WORKLET_SOURCE], { type: 'application/javascript' }))
  await audioCtx.audioWorklet.addModule(url)
  URL.revokeObjectURL(url)

  const src = audioCtx.createMediaStreamSource(mic)
  const node = new AudioWorkletNode(audioCtx, 'pcm-sender')
  node.port.onmessage = (m: MessageEvent<ArrayBuffer>) => {
    ring.push(new Int16Array(m.data))
    if (ring.length > RING_MAX) ring.shift()
    opts.onFrame(m.data)
  }
  src.connect(node)
  // Keep the graph alive without playing the mic back.
  const mute = audioCtx.createGain()
  mute.gain.value = 0
  node.connect(mute).connect(audioCtx.destination)

  return {
    stop: () => {
      node.port.close()
      node.disconnect()
      mic.getTracks().forEach((t) => t.stop())
      if (currentStream === mic) currentStream = null
      void audioCtx.close()
    },
  }
}
