import {
  BufferTarget,
  EncodedAudioPacketSource,
  EncodedPacket,
  EncodedVideoPacketSource,
  Mp4OutputFormat,
  Output,
} from 'mediabunny'
import { AudioCues, renderAudioCues } from '~/engine/audio'
import { VirtualClock } from '~/engine/clock'
import { Scene } from '~/engine/scene'
import { Stage } from '~/engine/stage'
import { Director } from '~/llm/director'
import { isDialectId, makeDialect } from '~/llm/dialect'
import { recordClockOffset, replaySchedule, voiceLeadMs } from '~/story/replay'
import type { StoryRecord } from '~/story/storage'
import { makeVoiceTrack } from '~/story/voice'
import { BookFrame, CPU, loadVideoAssets, PAPER, VIDEO_H, VIDEO_W } from './frame'

/**
 * A saved story → an .mp4, in the browser. The record is replayed on a VirtualClock through the
 * live engine (Stage + Director + dialect), one frame every 1/30 s, at the replay's own event times;
 * each frame is drawn inside the storybook frame, encoded with WebCodecs H.264, and muxed with
 * Mediabunny next to the crayon audio rendered offline from the cues the Stage emitted.
 * Deterministic: the same record always produces the same frames and the same audio.
 */

export const FPS = 30
const FRAME_MS = 1000 / FPS
const FRAME_US = 1e6 / FPS
/** Keyframe every 2 s. */
const GOP = FPS * 2
/** After the last event, the page must sit still this long before the end card. */
const HOLD_MS = 1500
/** Never run longer than this past the last event, whatever is still animating. */
const MAX_TAIL_MS = 60_000
const END_CARD_MS = 2000
const END_FADE_MS = 350
const VIDEO_BITRATE = 3_000_000
/** The idle crayon rests left of the corner logo instead of on it. */
const CURSOR_REST = { x: 124, y: 94 }
/** Longest the exporter holds the main thread before yielding. */
const SLICE_MS = 12
/** An encoder holding work with no output for this long is stuck (seen: WKWebView in the iOS simulator). */
const STALL_MS = 10_000

/**
 * The seam for the child's recorded voice (built separately). `videoSecondsOf` maps a time on the
 * record's clock (event `t`, ms) to seconds in the video, which squeezes dead air out like replay.
 */
export interface VoiceTrack {
  mix(ctx: OfflineAudioContext, videoSecondsOf: (recordMs: number) => number): void
}

export interface ExportProgress {
  phase: 'frames' | 'audio' | 'mux'
  /** 0..1 over the whole export. */
  fraction: number
}

export interface ExportOptions {
  signal?: AbortSignal
  onProgress?: (p: ExportProgress) => void
  /** Same as the replay screen: the `say` text masker follows the kid-safe setting. */
  moderation: boolean
  voice?: VoiceTrack | null
}

export interface ExportResult {
  blob: Blob
  seconds: number
  frames: number
  /** 'aac', or null when the browser has no AAC encoder (the video then has no sound). */
  audioCodec: string | null
  /** Things worth a line in the debug report (e.g. no AAC encoder). */
  notes: string[]
}

export class ExportUnsupportedError extends Error {}
/** An encoder stopped producing output (no packet for STALL_MS while it held work). */
export class ExportStalledError extends Error {}

const H264_CODECS = ['avc1.640028', 'avc1.4d0028', 'avc1.42e028']

async function pickVideoConfig(): Promise<VideoEncoderConfig> {
  if (typeof VideoEncoder === 'undefined')
    throw new ExportUnsupportedError('This browser cannot make videos yet')
  // Hardware first: measured in Chrome on Windows, the hardware H.264 encoder gives the same bytes
  // for the same frames on every run; the software one (OpenH264) does not. Software is the fallback.
  for (const hardwareAcceleration of [
    'prefer-hardware',
    'no-preference',
    'prefer-software',
  ] as const) {
    for (const codec of H264_CODECS) {
      const config: VideoEncoderConfig = {
        codec,
        width: VIDEO_W,
        height: VIDEO_H,
        bitrate: VIDEO_BITRATE,
        framerate: FPS,
        hardwareAcceleration,
        latencyMode: 'quality',
        avc: { format: 'avc' },
      }
      const support = await VideoEncoder.isConfigSupported(config)
      if (support.supported) return config
    }
  }
  throw new ExportUnsupportedError('This browser cannot encode H.264 video')
}

/** Give the UI thread a turn. MessageChannel is not throttled in background tabs, unlike setTimeout. */
function yieldToUi(): Promise<void> {
  return new Promise((resolve) => {
    const ch = new MessageChannel()
    ch.port1.onmessage = () => resolve()
    ch.port2.postMessage(null)
  })
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new DOMException('Export cancelled', 'AbortError')
}

/**
 * Watches one encoder: every wait checks Cancel, and an encoder that holds work but has produced no
 * output for STALL_MS fails the export instead of hanging it. `fed`/`out` count inputs and outputs.
 */
class EncoderWatch {
  private lastOutputAt = performance.now()
  private fed = 0
  private out = 0
  constructor(
    private readonly signal: AbortSignal | undefined,
    private readonly what: string
  ) {}

  input(): void {
    if (this.fed === this.out) this.lastOutputAt = performance.now()
    this.fed++
  }

  output(): void {
    this.out++
    this.lastOutputAt = performance.now()
  }

  check(): void {
    throwIfAborted(this.signal)
    if (this.fed > this.out && performance.now() - this.lastOutputAt > STALL_MS)
      throw new ExportStalledError(`${this.what} encoder produced nothing for ${STALL_MS / 1000}s`)
  }

  /** Yield until `ready()`, checking Cancel and the stall clock every turn. */
  async until(ready: () => boolean): Promise<void> {
    while (!ready()) {
      this.check()
      await yieldToUi()
    }
    this.check()
  }

  /** Await an encoder promise (flush) while still honouring Cancel and the stall clock. */
  race<T>(p: Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      let settled = false
      const finish = (): void => {
        settled = true
        clearInterval(timer)
        this.signal?.removeEventListener('abort', onAbort)
      }
      const fail = (e: unknown): void => {
        if (settled) return
        finish()
        reject(e)
      }
      const onAbort = (): void => fail(new DOMException('Export cancelled', 'AbortError'))
      const timer = setInterval(() => {
        try {
          this.check()
        } catch (e) {
          fail(e)
        }
      }, 250)
      this.signal?.addEventListener('abort', onAbort)
      p.then(
        (v) => {
          if (settled) return
          finish()
          resolve(v)
        },
        (e: unknown) => fail(e)
      )
    })
  }
}

function makeCanvas(w: number, h: number): { c: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d', CPU)
  if (!ctx) throw new Error('2d context unavailable')
  return { c, ctx }
}

type Packet<M> = { packet: EncodedPacket; meta: M | undefined }

/** AAC only: Photos and most players refuse Opus-in-mp4, so without AAC the video has no sound. */
const AAC = 'mp4a.40.2'
const AUDIO_BITRATE = 128_000
/** Samples per AudioData handed to the encoder. */
const AUDIO_BLOCK = 4800

/**
 * Encode the rendered mix to AAC packets up front, like the video. (Mediabunny's AudioBufferSource
 * encodes asynchronously, which made the file's chunk layout vary run to run.) Null when the browser
 * has no AAC encoder.
 */
async function encodeAudio(
  audio: AudioBuffer,
  signal: AbortSignal | undefined
): Promise<Packet<EncodedAudioChunkMetadata>[] | null> {
  if (typeof AudioEncoder === 'undefined') return null
  const config: AudioEncoderConfig = {
    codec: AAC,
    sampleRate: audio.sampleRate,
    numberOfChannels: audio.numberOfChannels,
    bitrate: AUDIO_BITRATE,
  }
  if (!(await AudioEncoder.isConfigSupported(config).catch(() => ({ supported: false }))).supported)
    return null
  const watch = new EncoderWatch(signal, 'audio')
  const packets: Packet<EncodedAudioChunkMetadata>[] = []
  let failed: unknown = null
  const encoder = new AudioEncoder({
    output: (chunk, meta) => {
      watch.output()
      packets.push({ packet: EncodedPacket.fromEncodedChunk(chunk), meta })
    },
    error: (e) => {
      failed = e
    },
  })
  try {
    encoder.configure(config)
    const channels = audio.numberOfChannels
    for (let from = 0; from < audio.length; from += AUDIO_BLOCK) {
      const n = Math.min(AUDIO_BLOCK, audio.length - from)
      const planar = new Float32Array(n * channels)
      for (let ch = 0; ch < channels; ch++)
        planar.set(audio.getChannelData(ch).subarray(from, from + n), ch * n)
      const data = new AudioData({
        format: 'f32-planar',
        sampleRate: audio.sampleRate,
        numberOfFrames: n,
        numberOfChannels: channels,
        timestamp: Math.round((from / audio.sampleRate) * 1e6),
        data: planar,
      })
      watch.input()
      encoder.encode(data)
      data.close()
      if (failed) throw failed
      await watch.until(() => encoder.encodeQueueSize <= 8)
    }
    await watch.race(encoder.flush())
    if (failed) throw failed
    return packets
  } finally {
    if (encoder.state !== 'closed') encoder.close()
  }
}

export async function exportStoryVideo(
  record: StoryRecord,
  opts: ExportOptions
): Promise<ExportResult> {
  const { signal } = opts
  let lastReport = 0
  const report = (phase: ExportProgress['phase'], fraction: number, force = false): void => {
    const now = performance.now()
    if (!force && now - lastReport < 100) return
    lastReport = now
    opts.onProgress?.({ phase, fraction: Math.max(0, Math.min(1, fraction)) })
  }

  const notes: string[] = []
  const videoConfig = await pickVideoConfig()
  const assets = await loadVideoAssets()
  throwIfAborted(signal)

  // The child's voice. `opts.voice === undefined` means "figure it out"; an explicit null skips it.
  // With voice the replay runs in real time (no squeezed gaps), so voice and drawing stay aligned;
  // voice decode is deterministic for the same file, so the export stays deterministic.
  const hasVoice = record.voice !== undefined && record.voice.clips.length > 0
  let voice = opts.voice
  if (voice === undefined && hasVoice) voice = await makeVoiceTrack(record)
  throwIfAborted(signal)

  // The live engine on a virtual clock, drawing into a detached paper-sized canvas.
  const clock = new VirtualClock()
  const cues = new AudioCues(() => clock.now())
  const paper = document.createElement('canvas')
  const stage = new Stage(paper, {
    seed: record.seed,
    audio: cues,
    clock,
    size: { w: PAPER.w, h: PAPER.h },
    software: true,
    cursorRest: CURSOR_REST,
  })
  const scene = new Scene()
  const dialectId = record.dialect && isDialectId(record.dialect) ? record.dialect : 'lines'
  const director = new Director({
    scene,
    stage,
    dialect: makeDialect(dialectId, scene, { moderation: opts.moderation, clock }),
    getProvider: () => null,
    onEvent: () => undefined,
  })

  const events = record.events
  const times = replaySchedule(events, { realTime: hasVoice, leadMs: voiceLeadMs(record) })
  let caption = ''
  events.forEach((ev, i) => {
    clock.at(times[i] ?? 0, () => {
      if (ev.k === 'words') caption = ev.text
      else if (ev.k === 'end') {
        // The finale's own "The End" title takes the page; no caption pill over it.
        caption = ''
        void stage.finale(record.seed)
      }
      else director.execute(ev.line)
    })
  })
  const lastEventMs = times[times.length - 1] ?? 0

  const packets: Packet<EncodedVideoChunkMetadata>[] = []
  let encodeError: unknown = null
  const watch = new EncoderWatch(signal, 'video')
  const encoder = new VideoEncoder({
    output: (chunk, meta) => {
      watch.output()
      packets.push({ packet: EncodedPacket.fromEncodedChunk(chunk), meta })
    },
    error: (e) => {
      encodeError = e
    },
  })
  encoder.configure(videoConfig)

  const frame = new BookFrame(assets)
  const out = makeCanvas(VIDEO_W, VIDEO_H)
  let frames = 0
  let slice = performance.now()
  // Rough length for the progress bar: the events, the settle tail, the end card.
  const estimateMs = lastEventMs + 4000 + END_CARD_MS

  const encode = async (): Promise<void> => {
    if (encodeError) throw encodeError
    const vf = new VideoFrame(out.c, {
      timestamp: Math.round(frames * FRAME_US),
      duration: Math.round(FRAME_US),
    })
    watch.input()
    encoder.encode(vf, { keyFrame: frames % GOP === 0 })
    vf.close()
    frames++
    await watch.until(() => encoder.encodeQueueSize <= 6)
    if (performance.now() - slice > SLICE_MS) {
      await yieldToUi()
      slice = performance.now()
    }
    watch.check()
  }

  try {
    let stillSince: number | null = null
    for (;;) {
      const t = frames * FRAME_MS
      clock.advanceTo(t)
      stage.renderAt(t)
      frame.compose(out.ctx, paper, { caption })
      await encode()
      if (t >= lastEventMs && stage.settled) stillSince ??= t
      else stillSince = null
      if ((stillSince !== null && t - stillSince >= HOLD_MS) || t - lastEventMs > MAX_TAIL_MS) break
      report('frames', (0.9 * t) / estimateMs)
    }
    const storyMs = frames * FRAME_MS

    const last = makeCanvas(VIDEO_W, VIDEO_H)
    last.ctx.drawImage(out.c, 0, 0)
    const endFrames = Math.round((END_CARD_MS / 1000) * FPS)
    for (let j = 0; j < endFrames; j++) {
      frame.composeEnd(out.ctx, last.c, (j * FRAME_MS) / END_FADE_MS)
      await encode()
      report(
        'frames',
        (0.9 * (storyMs + j * FRAME_MS)) / Math.max(estimateMs, storyMs + END_CARD_MS)
      )
    }
    await watch.race(encoder.flush())
    if (encodeError) throw encodeError
    encoder.close()
    throwIfAborted(signal)

    const seconds = frames / FPS
    report('audio', 0.92, true)
    // Record time -> video time. With voice the timeline is real time (t - offset), so the mapping is
    // exact; without it, follow the squeezed schedule (last event at/before recordMs, clamped to the next).
    const offset = recordClockOffset(record)
    const videoSecondsOf = (recordMs: number): number => {
      if (hasVoice) return Math.max(0, recordMs - offset) / 1000
      let i = 0
      while (i + 1 < events.length && (events[i + 1]?.t ?? Infinity) <= recordMs) i++
      const ev = events[i]
      if (!ev) return 0
      const next = times[i + 1]
      const base = times[i] ?? 0
      const into = Math.max(0, recordMs - ev.t)
      return (next === undefined ? base + into : Math.min(base + into, next)) / 1000
    }
    // Offline rendering has no output to watch; the race only keeps Cancel live while it runs.
    const audio = await new EncoderWatch(signal, 'audio render').race(
      renderAudioCues(
        cues.cues,
        seconds,
        record.seed,
        voice ? (ctx) => voice.mix(ctx, videoSecondsOf) : undefined
      )
    )
    throwIfAborted(signal)

    const audioPackets = await encodeAudio(audio, signal)
    throwIfAborted(signal)
    if (!audioPackets) notes.push('video export: no AAC AudioEncoder in this browser; the video has no sound')

    report('mux', 0.96, true)
    const target = new BufferTarget()
    const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target })
    const video = new EncodedVideoPacketSource('avc')
    output.addVideoTrack(video, { frameRate: FPS })
    const audioTrack = audioPackets ? new EncodedAudioPacketSource('aac') : null
    if (audioTrack) output.addAudioTrack(audioTrack)
    await output.start()
    try {
      // Interleave a second of video with a second of audio, in a fixed order.
      let v = 0
      let a = 0
      const totalSec = Math.ceil(seconds) + 1
      for (let s = 1; s <= totalSec; s++) {
        for (; v < packets.length; v++) {
          const item = packets[v]
          if (!item || item.packet.timestamp >= s) break
          await video.add(item.packet, item.meta)
        }
        if (audioTrack)
          for (; a < (audioPackets?.length ?? 0); a++) {
            const item = audioPackets?.[a]
            if (!item || item.packet.timestamp >= s) break
            await audioTrack.add(item.packet, item.meta)
          }
        throwIfAborted(signal)
        report('mux', 0.96 + (0.04 * s) / totalSec)
        await yieldToUi()
      }
      for (; v < packets.length; v++) {
        const item = packets[v]
        if (item) await video.add(item.packet, item.meta)
      }
      if (audioTrack)
        for (; a < (audioPackets?.length ?? 0); a++) {
          const item = audioPackets?.[a]
          if (item) await audioTrack.add(item.packet, item.meta)
        }
      await output.finalize()
    } catch (e) {
      await output.cancel()
      throw e
    }
    const buffer = target.buffer
    if (!buffer) throw new Error('muxer produced no file')
    report('mux', 1, true)
    return {
      blob: new Blob([buffer], { type: 'video/mp4' }),
      seconds,
      frames,
      audioCodec: audioPackets ? 'aac' : null,
      notes,
    }
  } finally {
    if (encoder.state !== 'closed') encoder.close()
    director.stop()
  }
}

/** File name from the story title: "The brave bunny" → the-brave-bunny.mp4 */
export function videoFileName(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
  return `${slug || 'once-upon-story'}.mp4`
}
