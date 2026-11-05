import { BufferTarget, EncodedAudioPacketSource, Mp4OutputFormat, Output } from 'mediabunny'
import { EXPORT_SAMPLE_RATE, playbackContext, primePlayback } from '~/engine/audio'
import { encodeAac } from '~/export/aac'
import type { VoiceTrack } from '~/export/mp4'
import { APP_SHELL } from '~/backend/config'
import { getVoiceClip } from '~/story/storage'
import type { StoryRecord } from '~/story/storage'
import { findSpeech, voicePieces, type KeptSpan, type Span, type VoicePiece } from './story-time'

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

/** Something else recorded the span (the shell's on-device ears own the mic); hands the clip over at stop. */
export interface ExternalClipSource {
  takeClip(): Promise<{ blob: Blob; ms: number } | null>
}

/** Records the child's voice while the mic is open. One clip per listening span. */
export class VoiceRecorder {
  private rec: MediaRecorder | null = null
  private external: { source: ExternalClipSource; t: number } | null = null
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

  /** The span is recorded elsewhere; `stop()` collects it from `source`. */
  startExternal(source: ExternalClipSource, tRecord: number): void {
    if (this.rec || this.external) return
    this.external = { source, t: tRecord }
  }

  stop(): Promise<{ t: number; ms: number; blob: Blob } | null> {
    const ext = this.external
    if (ext) {
      this.external = null
      return ext.source.takeClip().then((c) => (c && c.blob.size > 0 ? { t: ext.t, ms: c.ms, blob: c.blob } : null))
    }
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
    return this.rec !== null || this.external !== null
  }
}

/**
 * Call synchronously inside the tap that starts a replay (before `Replayer.play()`): resumes (or
 * creates) the playback AudioContext the voice and the crayon sounds share, so iOS lets them sound.
 * Outside the app shell it also asks for the media audio session, so Web Audio is not muted by the
 * iPhone's silent switch (an <audio> element ignores the switch; Web Audio does not, unless asked).
 */
export function primeAudio(): void {
  if (!APP_SHELL) setPlaybackSession()
  primePlayback()
}

/** `navigator.audioSession.type = 'playback'` (Safari 16.4+), where it exists. The shell sets its own session. */
function setPlaybackSession(): void {
  if (typeof navigator === 'undefined' || !('audioSession' in navigator)) return
  const session: unknown = navigator.audioSession
  if (typeof session !== 'object' || session === null || !('type' in session)) return
  try {
    if (session.type !== 'playback') Reflect.set(session, 'type', 'playback')
  } catch {
    // read-only or refused: the switch decides
  }
}

/** A decoded clip on the record clock. `ms` is the decoded length (the file can differ from the span). */
interface DecodedClip {
  t: number
  ms: number
  buffer: AudioBuffer
}

/** Fade (s) at both ends of every voice piece, so a squeezed quiet stretch never clicks. */
const PIECE_FADE_S = 0.008

/**
 * Start `pieces` of `clips` on `ctx`: story ms `fromStoryMs` plays at context time `whenS`. Pieces
 * already over are skipped, one already under way starts part-way. Shared by replay (live context)
 * and the mp4 (offline), so both place the voice the same way.
 */
function startPieces(
  ctx: BaseAudioContext,
  out: AudioNode,
  clips: readonly DecodedClip[],
  pieces: readonly VoicePiece[],
  fromStoryMs: number,
  whenS: number
): AudioBufferSourceNode[] {
  const started: AudioBufferSourceNode[] = []
  for (const p of pieces) {
    const clip = clips[p.clip]
    if (!clip) continue
    const skip = Math.max(0, fromStoryMs - p.atMs)
    const durS = (p.durMs - skip) / 1000
    if (durS <= 0.005) continue
    const at = whenS + Math.max(0, p.atMs - fromStoryMs) / 1000
    const src = ctx.createBufferSource()
    src.buffer = clip.buffer
    const gain = ctx.createGain()
    const fade = Math.min(PIECE_FADE_S, durS / 2)
    gain.gain.setValueAtTime(0, at)
    gain.gain.linearRampToValueAtTime(1, at + fade)
    gain.gain.setValueAtTime(1, at + durS - fade)
    gain.gain.linearRampToValueAtTime(0, at + durS)
    src.connect(gain).connect(out)
    src.start(at, (p.offsetMs + skip) / 1000, durS)
    started.push(src)
  }
  return started
}

/** Speech in every clip, on the record clock. */
function speechOf(clips: readonly DecodedClip[]): Span[] {
  const spans: Span[] = []
  for (const c of clips) {
    const channels: Float32Array[] = []
    for (let ch = 0; ch < c.buffer.numberOfChannels; ch++) channels.push(c.buffer.getChannelData(ch))
    spans.push(...findSpeech(channels, c.buffer.sampleRate, c.t))
  }
  return spans.sort((a, b) => a.from - b.from)
}

/** Decode compressed clips on `ctx`; an undecodable one is dropped rather than failing the whole voice. */
async function decodeClips(
  ctx: BaseAudioContext,
  sources: readonly { t: number; bytes: ArrayBuffer | null }[]
): Promise<DecodedClip[]> {
  const out: DecodedClip[] = []
  for (const s of sources) {
    if (!s.bytes) continue
    try {
      const buffer = await ctx.decodeAudioData(s.bytes)
      out.push({ t: s.t, ms: buffer.duration * 1000, buffer })
    } catch {
      // not decodable here (e.g. a webm clip in an old WebKit): skip it
    }
  }
  return out
}

/** What a VoicePlayer is playing: from which story ms, since which performance.now(), which spans. */
interface Playing {
  fromStoryMs: number
  since: number
  spans: readonly KeptSpan[]
}

/**
 * The child's voice in replay, through Web Audio: clips are fetched and decoded once (from the start,
 * `ready` settles when done), the speech in them is found, and `play()` schedules exactly the story-
 * time pieces from a story position on the shared playback context. No element seeking: that is what
 * lost clips in WKWebView. If the context starts or resumes late (iOS, a call), the pieces are placed
 * again from wherever the story clock is by then.
 */
export class VoicePlayer {
  /** Settles (never rejects) once every clip is decoded or dropped. */
  readonly ready: Promise<void>
  private clips: DecodedClip[] = []
  private speechSpans: Span[] = []
  private playing: Playing | null = null
  private sources: AudioBufferSourceNode[] = []
  private listening: AudioContext | null = null
  private disposed = false
  /** A blob: URL handed to fromUrl, revoked with the player. */
  private ownedUrl: string | null = null
  private readonly onState = (): void => this.place()

  private constructor(fetchAll: () => Promise<{ t: number; bytes: ArrayBuffer | null }[]>) {
    this.ready = (async () => {
      const ctx = playbackContext()
      if (!ctx) return
      try {
        const clips = await decodeClips(ctx, await fetchAll())
        if (this.disposed) return
        this.clips = clips
        this.speechSpans = speechOf(clips)
      } catch (e) {
        console.warn('voice: could not load the recording', e)
      }
    })()
  }

  /** The record's own clips (local storage). Null when it has none that decode. */
  static async load(record: StoryRecord): Promise<VoicePlayer | null> {
    const clips = record.voice?.clips ?? []
    if (clips.length === 0) return null
    const player = new VoicePlayer(() =>
      Promise.all(
        clips.map(async (c) => {
          const blob = await getVoiceClip(c.file)
          return { t: c.t, bytes: blob ? await blob.arrayBuffer() : null }
        })
      )
    )
    await player.ready
    return player.hasAudio ? player : null
  }

  /** One file that starts at record t = 0 (share pages serve the whole timeline as one clip). */
  static fromUrl(url: string, mime: string, totalMs: number): VoicePlayer {
    // The mime is advisory (the server sends the real content type) and the length comes from the
    // decoded file; both are kept for callers that pass them.
    void mime
    void totalMs
    const player = new VoicePlayer(async () => {
      const res = await fetch(url)
      return res.ok ? [{ t: 0, bytes: await res.arrayBuffer() }] : []
    })
    if (url.startsWith('blob:')) player.ownedUrl = url
    return player
  }

  /** Something decoded and can play. */
  get hasAudio(): boolean {
    return this.clips.length > 0
  }

  /** Where the child is talking, on the record clock (empty until `ready`). */
  get speech(): readonly Span[] {
    return this.speechSpans
  }

  /** Play the kept `spans` from story ms `fromStoryMs`, now. Replaces whatever was playing. */
  play(fromStoryMs: number, spans: readonly KeptSpan[]): void {
    this.playing = { fromStoryMs, since: performance.now(), spans }
    const ctx = playbackContext()
    if (!ctx || this.disposed) return
    if (this.listening !== ctx) {
      this.listening?.removeEventListener('statechange', this.onState)
      ctx.addEventListener('statechange', this.onState)
      this.listening = ctx
    }
    // Inside the shell (no gesture needed) this starts it; on a web page primeAudio() did, in the tap.
    if (ctx.state !== 'running') void ctx.resume().catch(() => undefined)
    this.place()
  }

  stop(): void {
    this.playing = null
    this.silence()
  }

  dispose(): void {
    this.disposed = true
    this.stop()
    this.listening?.removeEventListener('statechange', this.onState)
    this.listening = null
    this.clips = []
    if (this.ownedUrl) URL.revokeObjectURL(this.ownedUrl)
    this.ownedUrl = null
  }

  /** (Re)schedule from the story clock's position now; only while the context runs. */
  private place(): void {
    this.silence()
    const p = this.playing
    const ctx = playbackContext()
    if (!p || !ctx || ctx.state !== 'running' || this.clips.length === 0) return
    // A few ms ahead, so the first piece is not scheduled in the past.
    const LEAD_MS = 30
    const fromStoryMs = p.fromStoryMs + (performance.now() - p.since) + LEAD_MS
    const pieces = voicePieces(this.clips, p.spans)
    this.sources = startPieces(ctx, ctx.destination, this.clips, pieces, fromStoryMs, ctx.currentTime + LEAD_MS / 1000)
  }

  private silence(): void {
    for (const s of this.sources) {
      try {
        s.stop()
      } catch {
        // never started or already stopped
      }
      s.disconnect()
    }
    this.sources = []
  }
}

/**
 * The voice for the mp4: every clip decoded once at the export sample rate (no resample in the mix),
 * the speech found in it, and `mix` placing the story-time pieces exactly as replay does. Decoding is
 * offline (no audio hardware) and deterministic: the same file decodes to the same samples.
 */
export async function makeVoiceTrack(record: StoryRecord): Promise<VoiceTrack | null> {
  const voice = record.voice
  if (!voice || voice.clips.length === 0) return null
  if (typeof OfflineAudioContext === 'undefined') return null
  const decoder = new OfflineAudioContext(1, 1, EXPORT_SAMPLE_RATE)
  const clips = await decodeClips(
    decoder,
    await Promise.all(
      voice.clips.map(async (c) => {
        const blob = await getVoiceClip(c.file)
        return { t: c.t, bytes: blob ? await blob.arrayBuffer() : null }
      })
    )
  )
  if (clips.length === 0) return null
  return {
    speech: speechOf(clips),
    mix(ctx, spans) {
      startPieces(ctx, ctx.destination, clips, voicePieces(clips, spans), 0, 0)
    },
  }
}

const VOICE_BITRATE = 96_000

/**
 * One AAC file of the whole record timeline (silence between clips), for the share page's single
 * voice track: the share page finds the speech in it and plays it in story time. Null when no AAC
 * encoder (native or wasm, see src/export/aac.ts) can run here. Muxed like the mp4's audio track.
 */
export async function renderVoiceFile(
  record: StoryRecord
): Promise<{ blob: Blob; mime: string } | null> {
  const voice = record.voice
  if (!voice || voice.clips.length === 0) return null
  if (typeof OfflineAudioContext === 'undefined') return null

  const track = await makeVoiceTrack(record)
  if (!track) return null

  const lastEnd = voice.clips.reduce((m, c) => Math.max(m, c.t + c.ms), 0)
  const totalSec = Math.max(1, Math.ceil(lastEnd / 1000))
  const ctx = new OfflineAudioContext(1, totalSec * EXPORT_SAMPLE_RATE, EXPORT_SAMPLE_RATE)
  // The whole record timeline as recorded (one span, story time = record time): the share page
  // finds the speech in it and plays it in story time itself.
  track.mix(ctx, [{ from: 0, to: totalSec * 1000, at: 0 }])
  const rendered = await ctx.startRendering()

  const aac = await encodeAac(rendered, { bitrate: VOICE_BITRATE })
  if (!aac) return null

  const target = new BufferTarget()
  const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target })
  const audioTrack = new EncodedAudioPacketSource('aac')
  output.addAudioTrack(audioTrack)
  await output.start()
  try {
    for (const p of aac.packets) await audioTrack.add(p.packet, p.meta)
    await output.finalize()
  } catch (e) {
    await output.cancel()
    throw e
  }
  const buffer = target.buffer
  if (!buffer) return null
  return { blob: new Blob([buffer], { type: 'audio/mp4' }), mime: 'audio/mp4' }
}
