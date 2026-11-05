import { describe, expect, test } from 'bun:test'
import { aacConfigProblem, muxedAacProblem } from './aac'

const u8 = (...b: number[]): Uint8Array => new Uint8Array(b)
const cat = (...parts: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.length
  }
  return out
}
const box = (type: string, ...body: Uint8Array[]): Uint8Array => {
  const payload = cat(...body)
  const head = new Uint8Array(8)
  new DataView(head.buffer).setUint32(0, payload.length + 8)
  for (let i = 0; i < 4; i++) head[4 + i] = type.charCodeAt(i)
  return cat(head, payload)
}
/** An MPEG-4 descriptor with the 4-byte length form WebKit and Mediabunny write. */
const desc = (tag: number, body: Uint8Array): Uint8Array =>
  cat(u8(tag, 0x80, 0x80, 0x80, body.length), body)

/** A minimal mp4 whose one audio track carries `asc` as its DecoderSpecificInfo. */
function mp4With(asc: Uint8Array): Uint8Array {
  const dcd = desc(0x04, cat(u8(0x40, 0x15, 0, 0, 0, 0, 1, 0xf4, 0, 0, 1, 0xf4, 0), desc(0x05, asc)))
  const esds = box('esds', u8(0, 0, 0, 0), desc(0x03, cat(u8(0, 2, 0), dcd, desc(0x06, u8(2)))))
  const mp4a = box('mp4a', new Uint8Array(8), u8(0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 0, 16, 0, 0, 0, 0, 0xbb, 0x80, 0, 0), esds)
  const stsd = box('stsd', u8(0, 0, 0, 0, 0, 0, 0, 1), mp4a)
  const trak = box('trak', box('tkhd', new Uint8Array(84)), box('mdia', box('minf', box('stbl', stsd))))
  return cat(box('ftyp', u8(0x69, 0x73, 0x6f, 0x6d)), box('moov', box('mvhd', new Uint8Array(100)), trak), box('mdat', u8(1, 2, 3)))
}

describe('AAC config guard', () => {
  test('AAC-LC stereo 48 kHz reads as fine', () => {
    expect(aacConfigProblem(u8(0x11, 0x90))).toBe(null)
    expect(muxedAacProblem(mp4With(u8(0x11, 0x90)))).toBe(null)
  })

  test("WebKit's ES_Descriptor written as the config (TestFlight build 3) is caught", () => {
    const webkit = u8(0x03, 0x80, 0x80, 0x80, 0x22, 0x00, 0x00, 0x00, 0x04, 0x80, 0x80, 0x80, 0x14, 0x40, 0x14)
    expect(muxedAacProblem(mp4With(webkit))).toBe('object type 0')
  })

  test('0 channels and a missing track are caught', () => {
    expect(aacConfigProblem(u8(0x11, 0x80))).toBe('0 channels')
    expect(muxedAacProblem(box('moov', box('mvhd', new Uint8Array(100))))).toBe('no AAC track')
    expect(muxedAacProblem(u8(1, 2, 3))).toBe('no moov box')
  })
})
