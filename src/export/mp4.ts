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
import { replayPlan } from '~/story/replay'
import type { StoryRecord } from '~/story/storage'
import type { KeptSpan, Span } from '~/story/story-time'
import { makeVoiceTrack, makeVoiceTrackFromBlob } from '~/story/voice'
import { encodeAac, muxedAacProblem } from './aac'
import { BookFrame, CPU, loadVideoAssets, PAPER, VIDEO_H, VIDEO_W } from './frame'
import { EncoderWatch, ExportStalledError, throwIfAborted, yieldToUi } from './watch'

export { ExportStalledError }

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

/**
 * The child's recorded voice (src/story/voice.ts `makeVoiceTrack`). A voiced story plays in story
 * time (src/story/story-time.ts): `speech` feeds the timeline, and `mix` places the voice's kept
 * record spans at their story times, which are the video's times.
 */
export interface VoiceTrack {
  /** Where the child talks, on the record clock. */
  readonly speech: readonly Span[]
  mix(ctx: OfflineAudioContext, spans: readonly KeptSpan[]): void
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
  /**
   * The share page's one voice file (the whole record timeline from record t = 0), used instead of
   * the record's local clips, which a share page does not have.
   */
  voiceFile?: Blob | null
}

export interface ExportResult {
  blob: Blob
  seconds: number
  frames: number
  /** 'aac', or null when no AAC encoder can run here or the AAC config read back broken (see notes). */
  audioCodec: string | null
  /** The AAC encoder used: the browser's own, or the wasm fallback. */
  audioEncoder: 'native' | 'wasm' | null
  /** Things worth a line in the debug report (e.g. no AAC encoder). */
  notes: string[]
}

export class ExportUnsupportedError extends Error {}

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
const AUDIO_BITRATE = 128_000

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
  // With voice the video is in story time, like replay: the drawing under the words, dead air
  // squeezed. Voice decode is deterministic for the same file, so the export stays deterministic.
  const hasVoice = record.voice !== undefined && record.voice.clips.length > 0
  let voice = opts.voice
  if (voice === undefined && opts.voiceFile) voice = await makeVoiceTrackFromBlob(opts.voiceFile)
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
  const plan = replayPlan(events, voice ? voice.speech : null)
  const times = plan.eventAt
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
  // The page settles and holds after the last event and after the voice's last words.
  const lastEventMs = Math.max(times[times.length - 1] ?? 0, plan.lengthMs)

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
    // Story time is video time: the voice's kept spans go in at their story starts.
    const spans = plan.spans
    // Offline rendering has no output to watch; the race only keeps Cancel live while it runs.
    const audio = await new EncoderWatch(signal, 'audio render').race(
      renderAudioCues(
        cues.cues,
        seconds,
        record.seed,
        voice && spans ? (ctx) => voice.mix(ctx, spans) : undefined
      )
    )
    throwIfAborted(signal)

    const aac = await encodeAac(audio, { bitrate: AUDIO_BITRATE, signal })
    throwIfAborted(signal)
    const audioPackets = aac?.packets ?? null
    if (!aac) notes.push('video export: no AAC encoder (native or wasm) in this browser; the video has no sound')
    else if (aac.encoder === 'wasm') notes.push('video export: no native AAC encoder, used the wasm one')

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
    // Never claim sound we did not write: read the AAC track's config back out of the file.
    const aacProblem = audioPackets ? muxedAacProblem(new Uint8Array(buffer)) : null
    if (aacProblem)
      notes.push(`video export: the AAC track's AudioSpecificConfig is broken (${aacProblem}); the video may play silent`)
    report('mux', 1, true)
    return {
      blob: new Blob([buffer], { type: 'video/mp4' }),
      seconds,
      frames,
      audioCodec: audioPackets && !aacProblem ? 'aac' : null,
      audioEncoder: aac?.encoder ?? null,
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
