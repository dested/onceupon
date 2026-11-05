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

/** An mp4 box: its type and its payload (after the 8- or 16-byte header). */
interface Box {
  type: string
  body: Uint8Array
}

function boxes(data: Uint8Array): Box[] {
  const out: Box[] = []
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  let at = 0
  while (at + 8 <= data.length) {
    let size = view.getUint32(at)
    const type = String.fromCharCode(data[at + 4] ?? 0, data[at + 5] ?? 0, data[at + 6] ?? 0, data[at + 7] ?? 0)
    let head = 8
    if (size === 1) {
      if (at + 16 > data.length) break
      size = Number(view.getBigUint64(at + 8))
      head = 16
    } else if (size === 0) size = data.length - at
    if (size < head || at + size > data.length) break
    out.push({ type, body: data.subarray(at + head, at + size) })
    at += size
  }
  return out
}

function child(data: Uint8Array | undefined, type: string): Uint8Array | undefined {
  return data ? boxes(data).find((b) => b.type === type)?.body : undefined
}

/** An MPEG-4 descriptor at `at`: its tag and payload. */
function descriptor(data: Uint8Array, at: number): { tag: number; body: Uint8Array } | null {
  const tag = data[at]
  if (tag === undefined) return null
  let len = 0
  let i = at + 1
  for (let n = 0; n < 4; n++, i++) {
    const b = data[i]
    if (b === undefined) return null
    len = (len << 7) | (b & 0x7f)
    if ((b & 0x80) === 0) {
      i++
      break
    }
  }
  if (i + len > data.length) return null
  return { tag, body: data.subarray(i, i + len) }
}

/** The AudioSpecificConfig inside an esds payload (ES_Descriptor → DecoderConfig → DecoderSpecificInfo). */
function ascFromEsds(esds: Uint8Array): Uint8Array | null {
  const es = descriptor(esds, 4) // after the full-box version and flags
  if (!es || es.tag !== 0x03) return null
  const flags = es.body[2] ?? 0
  let at = 3
  if (flags & 0x80) at += 2
  if (flags & 0x40) at += 1 + (es.body[at] ?? 0)
  if (flags & 0x20) at += 2
  const dc = descriptor(es.body, at)
  if (!dc || dc.tag !== 0x04) return null
  const dsi = descriptor(dc.body, 13)
  return dsi && dsi.tag === 0x05 ? dsi.body : null
}

/** What is wrong with an AAC AudioSpecificConfig, or null when it reads as playable AAC. */
export function aacConfigProblem(asc: Uint8Array): string | null {
  const b0 = asc[0]
  const b1 = asc[1]
  if (b0 === undefined || b1 === undefined) return 'no AudioSpecificConfig'
  const objectType = b0 >> 3
  const rateIndex = ((b0 & 0x07) << 1) | (b1 >> 7)
  const channels = (b1 >> 3) & 0x0f
  if (objectType === 0) return 'object type 0'
  if (rateIndex === 15 ? asc.length < 5 : rateIndex > 12) return `sample rate index ${rateIndex}`
  if (channels === 0) return '0 channels'
  return null
}

/**
 * Read the muxed mp4's AAC track back (moov → trak → … → stsd → mp4a → esds) and say what is wrong
 * with its AudioSpecificConfig, or null when it is fine. The guard against shipping another silent
 * video: TestFlight build 3's esds said "object type 0, 0 channels" and Photos played it mute.
 */
export function muxedAacProblem(mp4: Uint8Array): string | null {
  const moov = child(mp4, 'moov')
  if (!moov) return 'no moov box'
  for (const trak of boxes(moov)) {
    if (trak.type !== 'trak') continue
    const stbl = child(child(child(trak.body, 'mdia'), 'minf'), 'stbl')
    const stsd = child(stbl, 'stsd')
    if (!stsd) continue
    // stsd: version/flags (4), entry count (4), then sample entries.
    const mp4a = boxes(stsd.subarray(8)).find((b) => b.type === 'mp4a')?.body
    if (!mp4a) continue
    // SampleEntry (8) + AudioSampleEntry (20); a QuickTime version 1 entry carries 16 more bytes.
    const version = ((mp4a[8] ?? 0) << 8) | (mp4a[9] ?? 0)
    const esds = child(mp4a.subarray(version === 1 ? 44 : 28), 'esds')
    if (!esds) return 'no esds box'
    const asc = ascFromEsds(esds)
    return asc ? aacConfigProblem(asc) : 'unreadable esds'
  }
  return 'no AAC track'
}
