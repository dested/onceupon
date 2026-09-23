import type { Director } from '~/llm/director'
import type { VoicePlayer } from './voice'
import type { StoryEvent, StoryRecord } from './storage'

const MAX_GAP_MS = 1400
const MIN_GAP_MS = 30

/**
 * Wait after event i before the next one. Normally the recorded gap with dead air squeezed out; in
 * real time (a story with the child's voice) the full recorded gap stays so words and voice line up.
 */
function gapAfter(ev: StoryEvent, next: StoryEvent, realTime: boolean): number {
  const raw = next.t - ev.t
  return realTime ? Math.max(MIN_GAP_MS, raw) : Math.min(MAX_GAP_MS, Math.max(MIN_GAP_MS, raw))
}

/**
 * The child's voice starts before the first event: a clip begins when the mic opens, the first `words`
 * event only when the recognizer has finished that sentence (seconds later). A replay that started at
 * the first event would enter the first clip mid-way (cutting the first words and forcing a seek into
 * a MediaRecorder file, which WebKit does badly), so voiced replays start this much earlier. Capped so
 * a child who sat quietly with the mic open does not get a long blank page.
 */
const MAX_VOICE_LEAD_MS = 8000

/** Ms of the child's voice before the first event (0 without voice), capped at MAX_VOICE_LEAD_MS. */
export function voiceLeadMs(record: StoryRecord): number {
  const first = record.events[0]
  const clips = record.voice?.clips ?? []
  if (!first || clips.length === 0) return 0
  const earliest = clips.reduce((m, c) => Math.min(m, c.t), Infinity)
  return Math.max(0, Math.min(MAX_VOICE_LEAD_MS, first.t - earliest))
}

/**
 * When each event plays, in ms from the start of a replay. The video export uses the same times.
 * `leadMs` (real time only, see voiceLeadMs) delays everything so the voice before the first event fits.
 */
export function replaySchedule(
  events: readonly StoryEvent[],
  opts: { realTime?: boolean; leadMs?: number } = {}
): number[] {
  const realTime = opts.realTime ?? false
  const out: number[] = []
  let t = realTime ? (opts.leadMs ?? 0) : 0
  for (let i = 0; i < events.length; i++) {
    out.push(t)
    const ev = events[i]
    const next = events[i + 1]
    if (ev && next) t += gapAfter(ev, next, realTime)
  }
  return out
}

/**
 * The record-clock time a replay starts at: the first event, or earlier by the voice lead-in. The
 * exporter maps record time to real-time video time from here.
 */
export function recordClockOffset(record: StoryRecord): number {
  return (record.events[0]?.t ?? 0) - voiceLeadMs(record)
}

/** How often the voice is re-synced between events (clips can start inside a long real-time gap). */
const VOICE_SYNC_MS = 200

/** Plays a saved story back through a Director with dead air squeezed out (kept, in real time, with voice). */
export class Replayer {
  private timer = 0
  private idx = 0
  private stopped = true
  private readonly realTime: boolean
  private readonly voice: VoicePlayer | null
  /** Voice lead-in before event 0 (real time only). */
  private readonly leadMs: number
  private voiceTimer = 0
  /** Record-clock time of the event most recently fired, and the performance.now() it fired at. */
  private curT = 0
  private stepAt = 0

  constructor(
    private record: StoryRecord,
    private director: Director,
    private handlers: {
      onWords: (final: string, chunk: string) => void
      onProgress: (i: number, n: number) => void
      onEnd: (seed: number) => void
      onDone: () => void
    },
    opts: { voice?: VoicePlayer | null } = {}
  ) {
    this.voice = opts.voice ?? null
    // A recorded voice plays in real time so the words and the drawing stay under the child's narration.
    this.realTime = (record.voice?.clips.length ?? 0) > 0
    this.leadMs = this.realTime ? voiceLeadMs(record) : 0
  }

  /** Record-clock time replay is at when it is about to fire event i (event 0 includes the lead-in). */
  private tAt(i: number): number {
    const events = this.record.events
    if (i === 0) return (events[0]?.t ?? 0) - this.leadMs
    return events[i]?.t ?? events[events.length - 1]?.t ?? 0
  }

  /** Continue from the current position (the start, or wherever seek() put it). */
  play(): void {
    this.stopped = false
    clearTimeout(this.timer)
    this.curT = this.tAt(this.idx)
    this.stepAt = performance.now()
    this.voice?.sync(this.recordMs(this.stepAt), true)
    if (this.voice) {
      window.clearInterval(this.voiceTimer)
      this.voiceTimer = window.setInterval(() => {
        if (!this.stopped) this.voice?.sync(this.recordMs(performance.now()), true)
      }, VOICE_SYNC_MS)
    }
    if (this.idx === 0 && this.leadMs > 0) this.timer = window.setTimeout(() => this.step(), this.leadMs)
    else this.step()
  }

  stop(): void {
    this.stopped = true
    clearTimeout(this.timer)
    window.clearInterval(this.voiceTimer)
    this.voiceTimer = 0
    this.voice?.sync(this.recordMs(performance.now()), false)
  }

  get position(): number {
    return this.idx
  }

  get length(): number {
    return this.record.events.length
  }

  /** Set the next event to play. The caller rebuilds the page up to here first. */
  seek(i: number): void {
    clearTimeout(this.timer)
    const events = this.record.events
    this.idx = Math.max(0, Math.min(events.length, i))
    this.curT = this.tAt(this.idx)
    this.stepAt = performance.now()
    this.voice?.sync(this.recordMs(this.stepAt), !this.stopped)
  }

  private recordMs(now: number): number {
    return this.curT + (now - this.stepAt)
  }

  private step(): void {
    if (this.stopped) return
    const events = this.record.events
    const ev = events[this.idx]
    if (!ev) {
      window.clearInterval(this.voiceTimer)
      this.voiceTimer = 0
      this.handlers.onDone()
      return
    }
    this.curT = ev.t
    this.stepAt = performance.now()
    if (ev.k === 'words') {
      const soFar = events
        .slice(0, this.idx + 1)
        .filter((e) => e.k === 'words')
        .map((e) => (e.k === 'words' ? e.text : ''))
        .join(' ')
      this.handlers.onWords(soFar, ev.text)
    } else if (ev.k === 'end') {
      this.handlers.onEnd(this.record.seed)
    } else {
      this.director.execute(ev.line)
    }
    this.voice?.sync(this.recordMs(this.stepAt), true)
    this.handlers.onProgress(this.idx + 1, events.length)
    this.idx++
    const next = events[this.idx]
    const gap = next ? gapAfter(ev, next, this.realTime) : 600
    this.timer = window.setTimeout(() => this.step(), gap)
  }
}
