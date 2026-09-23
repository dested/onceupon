import {
  BufferTarget,
  EncodedAudioPacketSource,
  EncodedPacket,
  Mp4OutputFormat,
  Output,
} from 'mediabunny'
import { EXPORT_SAMPLE_RATE } from '~/engine/audio'
import type { VoiceTrack } from '~/export/mp4'
import { getVoiceClip } from '~/story/storage'
import type { StoryRecord } from '~/story/storage'

/**
 * The child is the narrator. While the mic is open the studio records one clip per listening span;
 * each clip carries the record-clock time `t` (same clock as StoryEvent.t) it started and its length
 * in ms. Replay and the mp4 place the clips back on that timeline; a share page gets one joined file.
 */

export interface VoiceClipMeta {
  /** ms on the record clock when the clip starts (same clock as StoryEvent.t). */
  t: number
  ms: number
  file: string
}

/** In order of preference; the first the platform can record. mp4/aac replays and muxes everywhere. */
const MIME_CANDIDATES = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm'] as const

/** Records the child's voice while the mic is open. One clip per listening span. */
export class VoiceRecorder {
  private rec: MediaRecorder | null = null
  private chunks: Blob[] = []
  private tRecord = 0
  private startedAt = 0
  /** The recorder's mime without codec params, e.g. 'audio/mp4' or 'audio/webm'. */
  private mimeBase = ''

  static mime(): string | null {
    if (typeof MediaRecorder === 'undefined') return null
    for (const m of MIME_CANDIDATES) if (MediaRecorder.isTypeSupported(m)) return m
    return null
  }

  start(stream: MediaStream | null, tRecord: number): void {
    if (this.rec || !stream) return
    const mimeType = VoiceRecorder.mime()
    if (!mimeType) return
    this.chunks = []
    this.tRecord = tRecord
    this.startedAt = performance.now()
    this.mimeBase = mimeType.split(';')[0] ?? mimeType
    const rec = new MediaRecorder(stream, { mimeType, audioBitsPerSecond: 48000 })
    rec.ondataavailable = (e) => {
      if (e.data.size > 0) this.chunks.push(e.data)
    }
    this.rec = rec
    // A timeslice so a crash or a forced stop still keeps most of what was said.
    rec.start(1000)
  }

  stop(): Promise<{ t: number; ms: number; blob: Blob } | null> {
    const rec = this.rec
    if (!rec) return Promise.resolve(null)
    this.rec = null
    const ms = Math.round(performance.now() - this.startedAt)
    const t = this.tRecord
    const mime = this.mimeBase
    return new Promise((resolve) => {
      const finish = (): void => {
        const blob = new Blob(this.chunks, { type: mime })
        this.chunks = []
        resolve(blob.size > 0 ? { t, ms, blob } : null)
      }
      if (rec.state === 'inactive') {
        finish()
        return
      }
      rec.onstop = finish
      rec.stop()
    })
  }

  get recording(): boolean {
    return this.rec !== null
  }
}

interface LoadedClip {
  t: number
  ms: number
  el: HTMLAudioElement
  url: string
}

/** Plays a record's voice clips in step with replay. The Replayer drives `sync` on every step. */
export class VoicePlayer {
  private constructor(private clips: LoadedClip[]) {}

  static async load(record: StoryRecord): Promise<VoicePlayer | null> {
    const voice = record.voice
    if (!voice || voice.clips.length === 0) return null
    const loaded: LoadedClip[] = []
    for (const clip of voice.clips) {
      const blob = await getVoiceClip(clip.file)
      if (!blob) continue
      const url = URL.createObjectURL(blob)
      const el = new Audio()
      el.preload = 'auto'
      el.src = url
      loaded.push({ t: clip.t, ms: clip.ms, el, url })
    }
    if (loaded.length === 0) return null
    return new VoicePlayer(loaded)
  }

  /** One file that starts at record t = 0 (share pages serve the whole timeline as one clip). */
  static fromUrl(url: string, mime: string, totalMs: number): VoicePlayer {
    const el = new Audio()
    el.preload = 'auto'
    // The mime is advisory; the server sends the real content type. Kept for a caller that needs it.
    void mime
    el.src = url
    return new VoicePlayer([{ t: 0, ms: totalMs, el, url }])
  }

  sync(recordMs: number, playing: boolean): void {
    for (const clip of this.clips) {
      const within = playing && recordMs >= clip.t && recordMs < clip.t + clip.ms
      if (within) {
        const want = (recordMs - clip.t) / 1000
        if (Math.abs(clip.el.currentTime - want) > 0.25) {
          try {
            clip.el.currentTime = want
          } catch {
            // not seekable yet; the next sync will catch it
          }
        }
        if (clip.el.paused) void clip.el.play().catch(() => undefined)
      } else if (!clip.el.paused) {
        clip.el.pause()
      }
    }
  }

  dispose(): void {
    for (const clip of this.clips) {
      clip.el.pause()
      clip.el.removeAttribute('src')
      URL.revokeObjectURL(clip.url)
    }
    this.clips = []
  }
}

/**
 * Decode a record's clips to AudioBuffers, once, so the exporter can drop each on the OfflineAudioContext
 * at its record time. Decoding at the export sample rate avoids a resample. Deterministic: decoding the
 * same compressed file on the same machine yields the same samples.
 */
export async function makeVoiceTrack(record: StoryRecord): Promise<VoiceTrack | null> {
  const voice = record.voice
  if (!voice || voice.clips.length === 0) return null
  if (typeof AudioContext === 'undefined') return null
  const decoded: { t: number; buffer: AudioBuffer }[] = []
  let tmp: AudioContext
  try {
    tmp = new AudioContext({ sampleRate: EXPORT_SAMPLE_RATE })
  } catch {
    tmp = new AudioContext()
  }
  try {
    for (const clip of voice.clips) {
      const blob = await getVoiceClip(clip.file)
      if (!blob) continue
      const bytes = await blob.arrayBuffer()
      try {
        decoded.push({ t: clip.t, buffer: await tmp.decodeAudioData(bytes) })
      } catch {
        // an undecodable clip is dropped rather than failing the whole export
      }
    }
  } finally {
    void tmp.close()
  }
  if (decoded.length === 0) return null
  return {
    mix(ctx, videoSecondsOf) {
      for (const d of decoded) {
        const src = ctx.createBufferSource()
        src.buffer = d.buffer
        const gain = ctx.createGain()
        gain.gain.value = 1
        src.connect(gain).connect(ctx.destination)
        src.start(Math.max(0, videoSecondsOf(d.t)))
      }
    },
  }
}

const VOICE_AAC: AudioEncoderConfig = {
  codec: 'mp4a.40.2',
  sampleRate: EXPORT_SAMPLE_RATE,
  numberOfChannels: 1,
  bitrate: 96_000,
}
/** Samples per AudioData handed to the encoder (matches src/export/mp4.ts). */
const AUDIO_BLOCK = 4800

/**
 * One AAC file of the whole record timeline (silence between clips), for the share page's single
 * voice track. Null without WebCodecs AudioEncoder or AAC support. Muxed exactly like the audio track
 * in src/export/mp4.ts, minus the video.
 */
export async function renderVoiceFile(
  record: StoryRecord
): Promise<{ blob: Blob; mime: string } | null> {
  const voice = record.voice
  if (!voice || voice.clips.length === 0) return null
  if (typeof AudioEncoder === 'undefined' || typeof OfflineAudioContext === 'undefined') return null
  if (!(await AudioEncoder.isConfigSupported(VOICE_AAC)).supported) return null

  const track = await makeVoiceTrack(record)
  if (!track) return null

  const lastEnd = voice.clips.reduce((m, c) => Math.max(m, c.t + c.ms), 0)
  const totalSec = Math.max(1, Math.ceil(lastEnd / 1000))
  const ctx = new OfflineAudioContext(1, totalSec * EXPORT_SAMPLE_RATE, EXPORT_SAMPLE_RATE)
  track.mix(ctx, (recordMs) => recordMs / 1000)
  const rendered = await ctx.startRendering()

  const packets: { packet: EncodedPacket; meta: EncodedAudioChunkMetadata | undefined }[] = []
  let failed: unknown = null
  const encoder = new AudioEncoder({
    output: (chunk, meta) =>
      packets.push({ packet: EncodedPacket.fromEncodedChunk(chunk), meta }),
    error: (e) => {
      failed = e
    },
  })
  encoder.configure(VOICE_AAC)
  const data = rendered.getChannelData(0)
  for (let from = 0; from < rendered.length; from += AUDIO_BLOCK) {
    const n = Math.min(AUDIO_BLOCK, rendered.length - from)
    const planar = new Float32Array(n)
    planar.set(data.subarray(from, from + n))
    const ad = new AudioData({
      format: 'f32-planar',
      sampleRate: EXPORT_SAMPLE_RATE,
      numberOfFrames: n,
      numberOfChannels: 1,
      timestamp: Math.round((from / EXPORT_SAMPLE_RATE) * 1e6),
      data: planar,
    })
    encoder.encode(ad)
    ad.close()
  }
  await encoder.flush()
  encoder.close()
  if (failed) throw failed

  const target = new BufferTarget()
  const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target })
  const audioTrack = new EncodedAudioPacketSource('aac')
  output.addAudioTrack(audioTrack)
  await output.start()
  try {
    for (const p of packets) await audioTrack.add(p.packet, p.meta)
    await output.finalize()
  } catch (e) {
    await output.cancel()
    throw e
  }
  const buffer = target.buffer
  if (!buffer) return null
  return { blob: new Blob([buffer], { type: 'audio/mp4' }), mime: 'audio/mp4' }
}
