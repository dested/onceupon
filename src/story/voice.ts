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
    // Chunks belong to this recorder: a stop() whose last dataavailable lands after the next span
    // has started must not mix (or lose) the two clips' data.
    const chunks: Blob[] = []
    this.chunks = chunks
    this.tRecord = tRecord
    this.startedAt = performance.now()
    this.mimeBase = mimeType.split(';')[0] ?? mimeType
    const rec = new MediaRecorder(stream, { mimeType, audioBitsPerSecond: 48000 })
    rec.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data)
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
    const chunks = this.chunks
    this.chunks = []
    return new Promise((resolve) => {
      const finish = (): void => {
        const blob = new Blob(chunks, { type: mime })
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
  /** A seek asked for before the element had metadata: the clip offset (s) and when it was asked. */
  pending: { want: number; at: number } | null
  /** A play() promise is in flight (don't stack them; WebKit aborts the earlier one). */
  starting: boolean
}

/** How long load() waits for a clip's metadata before handing the player over anyway. */
const METADATA_WAIT_MS = 3000
/** Drift (s) that re-seeks a paused clip before play, and a clip that is already playing. */
const SEEK_WHEN_PAUSED = 0.25
const SEEK_WHEN_PLAYING = 0.75

function makeClip(t: number, ms: number, url: string): LoadedClip {
  const el = new Audio()
  el.preload = 'auto'
  const clip: LoadedClip = { t, ms, el, url, pending: null, starting: false }
  // A seek asked for too early is applied once the element can seek (WebKit drops or mangles seeks
  // on an element with no metadata, and iOS ignores preload so nothing loads until asked).
  el.addEventListener('loadedmetadata', () => {
    const p = clip.pending
    if (!p) return
    clip.pending = null
    const want = p.want + (el.paused ? 0 : (performance.now() - p.at) / 1000)
    if (want > 0.05) {
      try {
        el.currentTime = want
      } catch {
        // still not seekable; the next sync will try again
      }
    }
  })
  el.src = url
  el.load()
  return clip
}

/** Resolve when the element has metadata (or failed, or after a timeout), so the first sync can seek. */
function whenLoaded(el: HTMLAudioElement): Promise<void> {
  if (el.readyState >= HTMLMediaElement.HAVE_METADATA) return Promise.resolve()
  return new Promise((resolve) => {
    const done = (): void => {
      window.clearTimeout(timer)
      el.removeEventListener('loadedmetadata', done)
      el.removeEventListener('error', done)
      resolve()
    }
    const timer = window.setTimeout(done, METADATA_WAIT_MS)
    el.addEventListener('loadedmetadata', done)
    el.addEventListener('error', done)
  })
}

/** Plays a record's voice clips in step with replay. The Replayer drives `sync` on every step and every 200 ms. */
export class VoicePlayer {
  private constructor(private clips: LoadedClip[]) {}

  static async load(record: StoryRecord): Promise<VoicePlayer | null> {
    const voice = record.voice
    if (!voice || voice.clips.length === 0) return null
    const loaded: LoadedClip[] = []
    for (const clip of voice.clips) {
      const blob = await getVoiceClip(clip.file)
      if (!blob) continue
      loaded.push(makeClip(clip.t, clip.ms, URL.createObjectURL(blob)))
    }
    if (loaded.length === 0) return null
    // Load every element up front: WKWebView ignores preload, and a play()/seek on an element with no
    // metadata at replay start is exactly what lost the first clip.
    await Promise.all(loaded.map((c) => whenLoaded(c.el)))
    return new VoicePlayer(loaded)
  }

  /** One file that starts at record t = 0 (share pages serve the whole timeline as one clip). */
  static fromUrl(url: string, mime: string, totalMs: number): VoicePlayer {
    // The mime is advisory; the server sends the real content type. Kept for a caller that needs it.
    void mime
    return new VoicePlayer([makeClip(0, totalMs, url)])
  }

  sync(recordMs: number, playing: boolean): void {
    for (const clip of this.clips) {
      const within = playing && recordMs >= clip.t && recordMs < clip.t + clip.ms
      const el = clip.el
      if (!within) {
        clip.pending = null
        if (!el.paused) el.pause()
        continue
      }
      const want = (recordMs - clip.t) / 1000
      // The file can be a little shorter than the span's measured ms; past its end, never restart it.
      if (Number.isFinite(el.duration) && want >= el.duration - 0.05) continue
      if (el.readyState < HTMLMediaElement.HAVE_METADATA) {
        clip.pending = { want, at: performance.now() }
      } else if (!el.seeking) {
        const tolerance = el.paused ? SEEK_WHEN_PAUSED : SEEK_WHEN_PLAYING
        if (Math.abs(el.currentTime - want) > tolerance) {
          try {
            el.currentTime = want
          } catch {
            // not seekable yet; the next sync will catch it
          }
        }
      }
      // An ended element that was not sought back stays ended (play() would restart it from 0).
      if (el.paused && !clip.starting && !(el.ended && !el.seeking)) {
        clip.starting = true
        el.play()
          .catch(() => undefined)
          .finally(() => {
            clip.starting = false
          })
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
