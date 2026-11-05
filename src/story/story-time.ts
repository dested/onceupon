import type { StoryEvent } from './storage'

/**
 * Story time: how a story told out loud plays back (in-app replay, Save video, the share page).
 *
 * A record is real time: the voice lead-in before recognition finished, every pause, every wait for
 * the drawing. Story time keeps what the child said and what the crayon drew and squeezes the rest:
 * 1. Speech is found in the decoded voice (`findSpeech`).
 * 2. The drawing is pulled under the words that asked for it: the draw events after a `words` event
 *    start PULL_TO_MS after it, keeping their spacing and order.
 * 3. Activity = speech ∪ [t, t + DRAW_ACTIVE_MS] per draw event ∪ [t, t + MARK_ACTIVE_MS] per words /
 *    end event. Every stretch with no activity longer than MAX_QUIET_MS plays as MAX_QUIET_MS (half
 *    kept after the activity, half before the next), and the story starts START_LEAD_MS before the
 *    first activity.
 * The result is the kept record-time spans (each with its story-time start) and each event's story
 * time. The voice plays only the kept spans; speech always lies inside one, so no word is cut.
 * Unvoiced stories do not use this (replay.ts keeps their capped gaps).
 */

/** A stretch of record time (ms, the StoryEvent.t clock). */
export interface Span {
  from: number
  to: number
}

/** A kept stretch of record time and the story time (ms) it starts at. */
export interface KeptSpan extends Span {
  at: number
}

export interface StoryTimeline {
  /** Story ms each event fires at, index-aligned with the events; never decreasing. */
  eventAt: number[]
  /** Kept record spans in order, back to back in story time. */
  spans: KeptSpan[]
  /** Story ms the last kept span ends. */
  lengthMs: number
}

/** One piece of a voice clip to play: `durMs` from `offsetMs` into clip `clip`, at story ms `atMs`. */
export interface VoicePiece {
  clip: number
  offsetMs: number
  durMs: number
  atMs: number
}

export const SPEECH_WINDOW_MS = 20
/** Speech runs closer than this are one span (breaths between words). */
export const SPEECH_MERGE_MS = 300
/** Each speech span grows this much on both sides (soft word starts and ends). */
export const SPEECH_PAD_MS = 150
/** A run of loud windows shorter than this is a click or a bump, not speech. */
const MIN_SPEECH_RUN_MS = 60
/** Windows below this are digital silence (the gaps between clips in a share file), not room noise. */
const DIGITAL_SILENCE_DB = -100
/** Loudest minus noise floor must reach this, or the clip holds no speech (steady noise, an open mic). */
const MIN_SPREAD_DB = 12
/** The speech level sits this far from the noise floor towards the loudest part. */
const LEVEL_FRACTION = 0.3

export const PULL_TO_MS = 300
export const DRAW_ACTIVE_MS = 1000
export const MARK_ACTIVE_MS = 300
export const MAX_QUIET_MS = 500
export const START_LEAD_MS = 300

/**
 * Speech in one decoded clip, as record-time spans. `channels` are the clip's samples (mixed to mono
 * here); `startMs` is the clip's record time. The level comes from the clip's own loudness (its noise
 * floor and its loudest part), so a quiet mic still finds its words.
 */
export function findSpeech(
  channels: readonly Float32Array[],
  sampleRate: number,
  startMs: number
): Span[] {
  const first = channels[0]
  if (!first || sampleRate <= 0) return []
  const length = first.length
  const win = Math.max(1, Math.round((sampleRate * SPEECH_WINDOW_MS) / 1000))
  const count = Math.floor(length / win)
  if (count === 0) return []

  const db = new Float64Array(count)
  for (let w = 0; w < count; w++) {
    let sum = 0
    for (const ch of channels) {
      for (let i = w * win, end = i + win; i < end; i++) {
        const v = ch[i] ?? 0
        sum += v * v
      }
    }
    db[w] = 10 * Math.log10(sum / (win * channels.length) + 1e-14)
  }

  const live: number[] = []
  for (const v of db) if (v > DIGITAL_SILENCE_DB) live.push(v)
  if (live.length === 0) return []
  live.sort((a, b) => a - b)
  const floor = live[Math.floor(0.1 * (live.length - 1))] ?? DIGITAL_SILENCE_DB
  // Loudest part, after a 3-window median so a single click does not set it.
  let peak = -Infinity
  for (let w = 0; w < count; w++) {
    const a = db[w - 1] ?? db[w] ?? 0
    const b = db[w] ?? 0
    const c = db[w + 1] ?? db[w] ?? 0
    const med = Math.max(Math.min(a, b), Math.min(Math.max(a, b), c))
    if (med > peak) peak = med
  }
  if (peak - floor < MIN_SPREAD_DB) return []
  const level = floor + LEVEL_FRACTION * (peak - floor)

  // Loud runs, in windows.
  const runs: [number, number][] = []
  let runStart = -1
  for (let w = 0; w <= count; w++) {
    const loud = w < count && (db[w] ?? -Infinity) > level
    if (loud && runStart < 0) runStart = w
    else if (!loud && runStart >= 0) {
      if ((w - runStart) * SPEECH_WINDOW_MS >= MIN_SPEECH_RUN_MS) runs.push([runStart, w])
      runStart = -1
    }
  }

  const clipEnd = startMs + (length / sampleRate) * 1000
  const spans: Span[] = []
  for (const [a, b] of runs) {
    const from = startMs + a * SPEECH_WINDOW_MS
    const to = startMs + b * SPEECH_WINDOW_MS
    const last = spans[spans.length - 1]
    if (last && from - last.to < SPEECH_MERGE_MS) last.to = to
    else spans.push({ from, to })
  }
  return spans.map((s) => ({
    from: Math.max(startMs, s.from - SPEECH_PAD_MS),
    to: Math.min(clipEnd, s.to + SPEECH_PAD_MS),
  }))
}

/**
 * Record times with the drawing pulled under its words: the draw events after each `words` event
 * (up to the next non-draw event) move earlier together so the first lands PULL_TO_MS after the words,
 * when it was later than that. Spacing and order are kept; nothing moves before its words.
 */
export function pulledTimes(events: readonly StoryEvent[]): number[] {
  const t = events.map((e) => e.t)
  for (let i = 0; i < events.length; i++) {
    const w = events[i]
    if (w?.k !== 'words') continue
    let j = i + 1
    while (events[j]?.k === 'cmd') j++
    const firstAt = t[i + 1]
    if (j === i + 1 || firstAt === undefined) continue
    const shift = firstAt - (w.t + PULL_TO_MS)
    if (shift <= 0) continue
    for (let k = i + 1; k < j; k++) t[k] = (t[k] ?? 0) - shift
  }
  return t
}

/** Story ms for a record time on a timeline. A time inside a squeezed stretch maps to its far edge. */
export function toStoryMs(spans: readonly KeptSpan[], recordMs: number): number {
  let lo = 0
  let hi = spans.length - 1
  if (hi < 0) return 0
  const first = spans[0]
  if (first && recordMs <= first.from) return 0
  // The last span starting at or before recordMs.
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if ((spans[mid]?.from ?? Infinity) <= recordMs) lo = mid
    else hi = mid - 1
  }
  const s = spans[lo]
  if (!s) return 0
  return s.at + Math.min(recordMs, s.to) - s.from
}

/** The story-time timeline for a voiced record: `speech` are the record-time spans findSpeech found. */
export function storyTime(events: readonly StoryEvent[], speech: readonly Span[]): StoryTimeline {
  const pulled = pulledTimes(events)
  const activity: Span[] = speech.map((s) => ({ from: s.from, to: s.to }))
  events.forEach((e, i) => {
    const at = pulled[i] ?? e.t
    activity.push({ from: at, to: at + (e.k === 'cmd' ? DRAW_ACTIVE_MS : MARK_ACTIVE_MS) })
  })
  activity.sort((a, b) => a.from - b.from || a.to - b.to)

  const merged: Span[] = []
  for (const a of activity) {
    const last = merged[merged.length - 1]
    if (last && a.from <= last.to) last.to = Math.max(last.to, a.to)
    else merged.push({ ...a })
  }
  const head = merged[0]
  if (!head) return { eventAt: events.map(() => 0), spans: [], lengthMs: 0 }

  const half = MAX_QUIET_MS / 2
  const kept: Span[] = []
  let cur: Span = { from: head.from - START_LEAD_MS, to: head.to }
  for (let k = 1; k < merged.length; k++) {
    const a = merged[k]
    if (!a) continue
    if (a.from - cur.to <= MAX_QUIET_MS) cur.to = a.to
    else {
      kept.push({ from: cur.from, to: cur.to + half })
      cur = { from: a.from - half, to: a.to }
    }
  }
  kept.push(cur)

  const spans: KeptSpan[] = []
  let at = 0
  for (const s of kept) {
    spans.push({ from: s.from, to: s.to, at })
    at += s.to - s.from
  }

  let prev = 0
  const eventAt = pulled.map((r) => {
    prev = Math.max(prev, toStoryMs(spans, r))
    return prev
  })
  return { eventAt, spans, lengthMs: at }
}

/**
 * Which parts of which voice clip play when: the overlap of every clip ({ t, ms } on the record clock)
 * with every kept span, in story order. Back-to-back pieces of one clip meet where a quiet stretch
 * was squeezed.
 */
export function voicePieces(
  clips: readonly { t: number; ms: number }[],
  spans: readonly KeptSpan[]
): VoicePiece[] {
  const pieces: VoicePiece[] = []
  for (const s of spans) {
    clips.forEach((c, clip) => {
      const from = Math.max(s.from, c.t)
      const to = Math.min(s.to, c.t + c.ms)
      if (to - from < 1) return
      pieces.push({ clip, offsetMs: from - c.t, durMs: to - from, atMs: s.at + (from - s.from) })
    })
  }
  return pieces.sort((a, b) => a.atMs - b.atMs || a.clip - b.clip)
}
