/**
 * Where the engine gets its time. Live play uses the real clock; video export drives a VirtualClock
 * frame by frame so the same record always renders the same pixels.
 */
export interface Clock {
  /** Milliseconds, same origin as `after`. */
  now(): number
  after(ms: number, fn: () => void): number
  cancel(id: number): void
}

export const realClock: Clock = {
  now: () => performance.now(),
  after: (ms, fn) => window.setTimeout(fn, ms),
  cancel: (id) => window.clearTimeout(id),
}

interface Timer {
  id: number
  at: number
  fn: () => void
}

/** Manual time. `advanceTo` fires due timers in time order (ties in scheduling order), each at its own due time. */
export class VirtualClock implements Clock {
  private t = 0
  private nextId = 1
  private timers: Timer[] = []

  now(): number {
    return this.t
  }

  after(ms: number, fn: () => void): number {
    const id = this.nextId++
    this.timers.push({ id, at: this.t + Math.max(0, ms), fn })
    return id
  }

  /** Schedule at an absolute time (clamped to now). */
  at(time: number, fn: () => void): number {
    return this.after(time - this.t, fn)
  }

  cancel(id: number): void {
    this.timers = this.timers.filter((x) => x.id !== id)
  }

  advanceTo(time: number): void {
    for (;;) {
      let next: Timer | null = null
      for (const x of this.timers)
        if (x.at <= time && (!next || x.at < next.at || (x.at === next.at && x.id < next.id)))
          next = x
      if (!next) break
      const due = next
      this.timers = this.timers.filter((x) => x !== due)
      this.t = Math.max(this.t, due.at)
      due.fn()
    }
    this.t = Math.max(this.t, time)
  }
}
