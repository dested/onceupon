import {
  AudioSample,
  AudioSampleSource,
  canEncodeAudio,
  EncodedPacket,
  Mp4OutputFormat,
  NullTarget,
  Output,
} from 'mediabunny'
import { EncoderWatch, throwIfAborted, yieldToUi } from './watch'

/**
 * Rendered audio → AAC packets, up front, for a fixed-order mux (the mp4 export, the share voice file).
 *
 * Encoding goes through Mediabunny's own pipeline (an AudioSampleSource on a throwaway Output whose
 * packets we collect), not raw WebCodecs, because WebKit's AAC AudioEncoder is broken in ways
 * Mediabunny repairs: its `description` is a whole ES_Descriptor instead of an AudioSpecificConfig
 * (WebKit bug 302253; written as-is, the mp4's esds read "object type 0, 0 channels" and Photos played
 * the video silent), and its first frame needs a silence prefix (bug 328491). Packets are handed back
 * rather than muxed here, so the caller interleaves them with video in a fixed order (Mediabunny's
 * live audio sources made the chunk layout vary run to run).
 *
 * Native WebCodecs AAC first. Where the browser has none (iOS before 26, Firefox, Linux Chrome) the
 * wasm encoder (`@mediabunny/aac-encoder`, FFmpeg's AAC-LC) is imported on first need and registered.
 */

export interface AacPacket {
  packet: EncodedPacket
  meta: EncodedAudioChunkMetadata | undefined
}

export interface AacTrack {
  packets: AacPacket[]
  /** Which encoder made it: the browser's (WebCodecs) or the wasm fallback. */
  encoder: 'native' | 'wasm'
}

/** Seconds of audio per sample handed to the encoder: Cancel and the stall clock are checked between them. */
const BLOCK_SECONDS = 1

let wasmRegistered = false
let wasmLoading: Promise<boolean> | null = null

/** Import and register the wasm AAC encoder, once. False when this page cannot run it. */
function loadWasmAac(): Promise<boolean> {
  if (typeof WebAssembly === 'undefined' || typeof Worker === 'undefined') return Promise.resolve(false)
  wasmLoading ??= import('@mediabunny/aac-encoder').then(
    (m) => {
      m.registerAacEncoder()
      wasmRegistered = true
      return true
    },
    (e: unknown) => {
      console.warn('wasm AAC encoder failed to load', e)
      wasmLoading = null
      return false
    }
  )
  return wasmLoading
}

/**
 * Which AAC encoder this page will use for these parameters, loading the wasm one if needed; null =
 * none. Once the wasm encoder is registered Mediabunny prefers it for every AAC encode, so that sticks.
 */
export async function pickAacEncoder(
  numberOfChannels: number,
  sampleRate: number,
  bitrate: number
): Promise<'native' | 'wasm' | null> {
  if (wasmRegistered) return 'wasm'
  const native = await canEncodeAudio('aac', { numberOfChannels, sampleRate, bitrate }).catch(() => false)
  if (native) return 'native'
  return (await loadWasmAac()) ? 'wasm' : null
}

/** Encode `audio` to AAC-LC at `bitrate`. Null when no AAC encoder can run here. */
export async function encodeAac(
  audio: AudioBuffer,
  opts: { bitrate: number; signal?: AbortSignal }
): Promise<AacTrack | null> {
  const { signal } = opts
  const channels = audio.numberOfChannels
  const sampleRate = audio.sampleRate
  const encoder = await pickAacEncoder(channels, sampleRate, opts.bitrate)
  throwIfAborted(signal)
  if (!encoder) return null

  // Units are audio frames: fed per block, out per packet's duration.
  const watch = new EncoderWatch(signal, 'audio')
  const packets: AacPacket[] = []
  const source = new AudioSampleSource({
    codec: 'aac',
    bitrate: opts.bitrate,
    onEncodedPacket: (packet, meta) => {
      watch.output(Math.max(1, Math.round(packet.duration * sampleRate)))
      packets.push({ packet, meta })
    },
  })
  const output = new Output({ format: new Mp4OutputFormat(), target: new NullTarget() })
  output.addAudioTrack(source)
  try {
    await watch.race(output.start())
    const block = Math.max(1, Math.round(BLOCK_SECONDS * sampleRate))
    for (let from = 0; from < audio.length; from += block) {
      const n = Math.min(block, audio.length - from)
      const data = new Float32Array(n * channels)
      for (let ch = 0; ch < channels; ch++)
        data.set(audio.getChannelData(ch).subarray(from, from + n), ch * n)
      const sample = new AudioSample({
        data,
        format: 'f32-planar',
        numberOfChannels: channels,
        sampleRate,
        timestamp: from / sampleRate,
      })
      watch.input(n)
      try {
        await watch.race(source.add(sample))
      } finally {
        sample.close()
      }
      await yieldToUi()
    }
    source.close()
    await watch.race(output.finalize())
  } catch (e) {
    await output.cancel().catch(() => undefined)
    throw e
  }
  return { packets, encoder }
}
