import { describe, expect, test } from 'bun:test'
import { replayPlan, replaySchedule } from './replay'
import type { StoryEvent } from './storage'
import {
  DRAW_ACTIVE_MS,
  findSpeech,
  MARK_ACTIVE_MS,
  MAX_QUIET_MS,
  pulledTimes,
  PULL_TO_MS,
  SPEECH_PAD_MS,
  START_LEAD_MS,
  storyTime,
  toStoryMs,
  voicePieces,
} from './story-time'

const RATE = 16000

/** A mono clip: [ms, dBFS] parts; tone parts are a 220 Hz sine at that level, the rest seeded noise. */
function clip(parts: readonly (readonly [number, number, 'tone' | 'noise'])[]): Float32Array {
  const total = parts.reduce((n, [ms]) => n + Math.round((ms * RATE) / 1000), 0)
  const out = new Float32Array(total)
  let seed = 12345
  const noise = (): number => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff
    return (seed / 0x7fffffff) * 2 - 1
  }
  let i = 0
  for (const [ms, dbfs, kind] of parts) {
    const n = Math.round((ms * RATE) / 1000)
    // RMS of a sine is amp/√2, of uniform noise amp/√3.
    const amp = 10 ** (dbfs / 20) * (kind === 'tone' ? Math.SQRT2 : Math.sqrt(3))
    for (let k = 0; k < n; k++, i++)
      out[i] = kind === 'tone' ? amp * Math.sin((2 * Math.PI * 220 * i) / RATE) : amp * noise()
  }
  return out
}

const near = (got: number, want: number, tol = 25): void => {
  expect(Math.abs(got - want) <= tol).toBe(true)
}

describe('findSpeech', () => {
  const parts = [
    [500, -62, 'noise'],
    [1000, -20, 'tone'],
    [200, -62, 'noise'],
    [800, -22, 'tone'],
    [2000, -62, 'noise'],
    [500, -24, 'tone'],
    [600, -62, 'noise'],
  ] as const

  test('finds words, merges short breaths, pads both sides, on the record clock', () => {
    const spans = findSpeech([clip(parts)], RATE, 10_000)
    expect(spans.length).toBe(2)
    const [a, b] = spans
    near(a?.from ?? 0, 10_000 + 500 - SPEECH_PAD_MS)
    near(a?.to ?? 0, 10_000 + 2500 + SPEECH_PAD_MS)
    near(b?.from ?? 0, 10_000 + 4500 - SPEECH_PAD_MS)
    near(b?.to ?? 0, 10_000 + 5000 + SPEECH_PAD_MS)
  })

  test('a quiet mic finds the same words (the level follows the clip)', () => {
    const quiet = parts.map(([ms, db, kind]) => [ms, db - 30, kind] as const)
    const loud = findSpeech([clip(parts)], RATE, 0)
    const soft = findSpeech([clip(quiet)], RATE, 0)
    expect(soft.length).toBe(loud.length)
    soft.forEach((s, i) => {
      near(s.from, loud[i]?.from ?? 0)
      near(s.to, loud[i]?.to ?? 0)
    })
  })

  test('steady noise or digital silence holds no speech', () => {
    expect(findSpeech([clip([[3000, -50, 'noise']])], RATE, 0)).toEqual([])
    expect(findSpeech([new Float32Array(RATE * 2)], RATE, 0)).toEqual([])
  })

  test('digital silence between clips (a share file) does not lower the level into room noise', () => {
    const file = clip([
      [2000, -200, 'noise'],
      [400, -60, 'noise'],
      [700, -20, 'tone'],
      [400, -60, 'noise'],
      [3000, -200, 'noise'],
    ])
    const spans = findSpeech([file], RATE, 0)
    expect(spans.length).toBe(1)
    near(spans[0]?.from ?? 0, 2400 - SPEECH_PAD_MS)
    near(spans[0]?.to ?? 0, 3100 + SPEECH_PAD_MS)
  })

  test('a click is not speech', () => {
    const spans = findSpeech([clip([[1000, -60, 'noise'], [20, -10, 'tone'], [1000, -60, 'noise'], [600, -20, 'tone'], [500, -60, 'noise']])], RATE, 0)
    expect(spans.length).toBe(1)
    near(spans[0]?.from ?? 0, 2020 - SPEECH_PAD_MS)
  })
})

const words = (t: number, text = 'w'): StoryEvent => ({ k: 'words', t, text })
const cmd = (t: number, line = 'x'): StoryEvent => ({ k: 'cmd', t, line })
const end = (t: number): StoryEvent => ({ k: 'end', t })

describe('pulledTimes', () => {
  test('the drawing after a words event starts PULL_TO_MS after it, spacing kept', () => {
    const t = pulledTimes([words(1000), cmd(4000), cmd(4010), cmd(4500), words(9000), cmd(9100)])
    expect(t).toEqual([1000, 1000 + PULL_TO_MS, 1010 + PULL_TO_MS, 1500 + PULL_TO_MS, 9000, 9100])
  })

  test('nothing before the first words moves, and nothing moves past a non-draw event', () => {
    const t = pulledTimes([cmd(500), words(1000), end(1000), cmd(5000)])
    expect(t).toEqual([500, 1000, 1000, 5000])
  })

  test('order holds and nothing lands before its words', () => {
    const events = [words(0), cmd(2000), cmd(2600), words(3000), cmd(7000), cmd(7001), words(7100), end(7100)]
    const t = pulledTimes(events)
    for (let i = 1; i < t.length; i++) expect((t[i] ?? 0) >= (t[i - 1] ?? 0)).toBe(true)
    expect(t[1]).toBe(PULL_TO_MS)
    expect(t[4]).toBe(3000 + PULL_TO_MS)
  })
})

describe('storyTime', () => {
  test('starts START_LEAD_MS before the first activity (no 8 s voice lead)', () => {
    const tl = storyTime([words(11_000), cmd(11_300)], [{ from: 6_000, to: 10_900 }])
    expect(tl.spans[0]?.from).toBe(6_000 - START_LEAD_MS)
    expect(tl.eventAt[0]).toBe(11_000 - (6_000 - START_LEAD_MS))
  })

  test('quiet longer than MAX_QUIET_MS plays as MAX_QUIET_MS', () => {
    // words at 0 (active to 300) then words at 10 000: 9.7 s of nothing becomes 0.5 s.
    const tl = storyTime([words(0), words(10_000)], [])
    expect(tl.spans.length).toBe(2)
    expect((tl.eventAt[1] ?? 0) - (tl.eventAt[0] ?? 0)).toBe(MARK_ACTIVE_MS + MAX_QUIET_MS)
    expect(tl.lengthMs).toBe(START_LEAD_MS + MARK_ACTIVE_MS + MAX_QUIET_MS + MARK_ACTIVE_MS)
  })

  test('short quiet is kept as recorded', () => {
    const tl = storyTime([words(0), cmd(PULL_TO_MS), words(PULL_TO_MS + DRAW_ACTIVE_MS + 400)], [])
    expect(tl.spans.length).toBe(1)
    expect((tl.eventAt[2] ?? 0) - (tl.eventAt[1] ?? 0)).toBe(DRAW_ACTIVE_MS + 400)
  })

  test('every speech span plays whole and in one piece', () => {
    const speech = [
      { from: 1_000, to: 4_000 },
      { from: 9_000, to: 12_500 },
      { from: 30_000, to: 31_000 },
    ]
    const tl = storyTime([words(4_200), cmd(6_000), words(12_700), cmd(15_000), words(31_100), end(31_100)], speech)
    for (const s of speech) {
      const holder = tl.spans.find((k) => k.from <= s.from && k.to >= s.to)
      expect(holder !== undefined).toBe(true)
    }
    // Spans are back to back in story time.
    tl.spans.forEach((s, i) => {
      const prev = tl.spans[i - 1]
      if (prev) expect(s.at).toBe(prev.at + (prev.to - prev.from))
    })
    for (let i = 1; i < tl.eventAt.length; i++) expect((tl.eventAt[i] ?? 0) >= (tl.eventAt[i - 1] ?? 0)).toBe(true)
    expect(tl.lengthMs < 31_400 - 700).toBe(true)
  })

  test('a slow beat: drawing pulled under the words, dead air squeezed', () => {
    // A child says a sentence (speech 5-9 s), recognition lands at 9.6 s, the drawing streams 3-5 s later.
    const events = [words(9_600), cmd(12_800), cmd(12_900), cmd(14_000), words(20_500), cmd(23_000), end(26_000)]
    const speech = [
      { from: 5_000, to: 9_300 },
      { from: 16_000, to: 20_100 },
      { from: 24_000, to: 25_800 },
    ]
    const tl = storyTime(events, speech)
    const at = (i: number): number => tl.eventAt[i] ?? 0
    expect(at(1) - at(0)).toBe(PULL_TO_MS)
    expect(at(2) - at(1)).toBe(100)
    expect(tl.lengthMs < 26_300 - 4_700 - 3_000).toBe(true)
    // Every event sits inside a kept span.
    for (const r of pulledTimes(events)) expect(tl.spans.some((s) => s.from <= r && r <= s.to)).toBe(true)
  })

  test('no events and no speech', () => {
    expect(storyTime([], [])).toEqual({ eventAt: [], spans: [], lengthMs: 0 })
  })
})

describe('toStoryMs and voicePieces', () => {
  const spans = [
    { from: 1_000, to: 3_000, at: 0 },
    { from: 8_000, to: 9_000, at: 2_000 },
  ]

  test('maps kept time 1:1 and a squeezed stretch to its edge', () => {
    expect(toStoryMs(spans, 500)).toBe(0)
    expect(toStoryMs(spans, 2_000)).toBe(1_000)
    expect(toStoryMs(spans, 5_000)).toBe(2_000)
    expect(toStoryMs(spans, 8_500)).toBe(2_500)
    expect(toStoryMs(spans, 20_000)).toBe(3_000)
  })

  test('a clip across a squeeze plays as two back-to-back pieces', () => {
    const pieces = voicePieces([{ t: 500, ms: 9_000 }], spans)
    expect(pieces).toEqual([
      { clip: 0, offsetMs: 500, durMs: 2_000, atMs: 0 },
      { clip: 0, offsetMs: 7_500, durMs: 1_000, atMs: 2_000 },
    ])
  })

  test('clips outside the kept spans are not played', () => {
    expect(voicePieces([{ t: 4_000, ms: 2_000 }], spans)).toEqual([])
  })
})

describe('replayPlan', () => {
  const events = [words(1_000), cmd(5_000), cmd(5_100), words(20_000), end(20_000)]

  test('without voice: the capped gaps, unchanged', () => {
    const plan = replayPlan(events, null)
    expect(plan.eventAt).toEqual([0, 1400, 1500, 2900, 2930])
    expect(plan.eventAt).toEqual(replaySchedule(events))
    expect(plan.spans).toBe(null)
  })

  test('with voice: story time, and the length covers the last words', () => {
    const speech = [{ from: 19_000, to: 21_000 }]
    const plan = replayPlan(events, speech)
    expect(plan.eventAt).toEqual(storyTime(events, speech).eventAt)
    expect((plan.spans?.length ?? 0) > 0).toBe(true)
    const last = plan.spans?.[plan.spans.length - 1]
    expect(plan.lengthMs).toBe((last?.at ?? 0) + (last?.to ?? 0) - (last?.from ?? 0))
    expect(plan.lengthMs < 20_000).toBe(true)
  })
})
