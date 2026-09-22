import type { Director } from '~/llm/director'
import type { StoryEvent, StoryRecord } from './storage'

const MAX_GAP_MS = 1400
const MIN_GAP_MS = 30

/** Wait after event i before the next one: the recorded gap with dead air squeezed out. */
function gapAfter(ev: StoryEvent, next: StoryEvent): number {
  return Math.min(MAX_GAP_MS, Math.max(MIN_GAP_MS, next.t - ev.t))
}

/** When each event plays, in ms from the start of a replay. The video export uses the same times. */
export function replaySchedule(events: readonly StoryEvent[]): number[] {
  const out: number[] = []
  let t = 0
  for (let i = 0; i < events.length; i++) {
    out.push(t)
    const ev = events[i]
    const next = events[i + 1]
    if (ev && next) t += gapAfter(ev, next)
  }
  return out
}

/** Plays a saved story back through a Director with dead air squeezed out. */
export class Replayer {
  private timer = 0
  private idx = 0
  private stopped = false

  constructor(
    private record: StoryRecord,
    private director: Director,
    private handlers: {
      onWords: (final: string, chunk: string) => void
      onProgress: (i: number, n: number) => void
      onEnd: (seed: number) => void
      onDone: () => void
    }
  ) {}

  /** Continue from the current position (the start, or wherever seek() put it). */
  play(): void {
    this.stopped = false
    clearTimeout(this.timer)
    this.step()
  }

  stop(): void {
    this.stopped = true
    clearTimeout(this.timer)
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
    this.idx = Math.max(0, Math.min(this.record.events.length, i))
  }

  private step(): void {
    if (this.stopped) return
    const events = this.record.events
    const ev = events[this.idx]
    if (!ev) {
      this.handlers.onDone()
      return
    }
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
    this.handlers.onProgress(this.idx + 1, events.length)
    this.idx++
    const next = events[this.idx]
    const gap = next ? gapAfter(ev, next) : 600
    this.timer = window.setTimeout(() => this.step(), gap)
  }
}
