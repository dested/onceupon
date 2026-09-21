import type { Director } from '~/llm/director'
import type { StoryRecord } from './storage'

const MAX_GAP_MS = 1400

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
      onDone: () => void
    }
  ) {}

  play(): void {
    this.stopped = false
    this.step()
  }

  stop(): void {
    this.stopped = true
    clearTimeout(this.timer)
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
    } else {
      this.director.execute(ev.line)
    }
    this.handlers.onProgress(this.idx + 1, events.length)
    this.idx++
    const next = events[this.idx]
    const gap = next ? Math.min(MAX_GAP_MS, Math.max(30, next.t - ev.t)) : 600
    this.timer = window.setTimeout(() => this.step(), gap)
  }
}
