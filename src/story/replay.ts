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

/** When each event plays, in ms from the start of a replay. The video export uses the same times. */
export function replaySchedule(
  events: readonly StoryEvent[],
  opts: { realTime?: boolean } = {}
): number[] {
  const realTime = opts.realTime ?? false
  const out: number[] = []
  let t = 0
  for (let i = 0; i < events.length; i++) {
    out.push(t)
    const ev = events[i]
    const next = events[i + 1]
    if (ev && next) t += gapAfter(ev, next, realTime)
  }
  return out
}

/** The record-clock time of the first event; the exporter maps record time to real-time video time from here. */
export function recordClockOffset(record: StoryRecord): number {
  return record.events[0]?.t ?? 0
}

/** Plays a saved story back through a Director with dead air squeezed out (kept, in real time, with voice). */
export class Replayer {
  private timer = 0
  private idx = 0
  private stopped = true
  private readonly realTime: boolean
  private readonly voice: VoicePlayer | null
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
  }

  /** Continue from the current position (the start, or wherever seek() put it). */
  play(): void {
    this.stopped = false
    clearTimeout(this.timer)
    const events = this.record.events
    this.curT = events[this.idx]?.t ?? events[0]?.t ?? 0
    this.stepAt = performance.now()
    this.voice?.sync(this.recordMs(this.stepAt), true)
    this.step()
  }

  stop(): void {
    this.stopped = true
    clearTimeout(this.timer)
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
    this.curT = events[this.idx]?.t ?? events[events.length - 1]?.t ?? 0
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
