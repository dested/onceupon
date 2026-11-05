import type { Director } from '~/llm/director'
import type { VoicePlayer } from './voice'
import type { StoryEvent, StoryRecord } from './storage'
import { storyTime, type KeptSpan, type Span } from './story-time'

const MAX_GAP_MS = 1400
const MIN_GAP_MS = 30
/** After the last event, a replay is done this much later (or when the voice ends, if later). */
const DONE_AFTER_MS = 600

/**
 * When each event of an unvoiced story plays, in ms from the start of a replay: the recorded gaps
 * with dead air capped (MIN_GAP_MS..MAX_GAP_MS).
 */
export function replaySchedule(events: readonly StoryEvent[]): number[] {
  const out: number[] = []
  let t = 0
  for (let i = 0; i < events.length; i++) {
    out.push(t)
    const ev = events[i]
    const next = events[i + 1]
    if (ev && next) t += Math.min(MAX_GAP_MS, Math.max(MIN_GAP_MS, next.t - ev.t))
  }
  return out
}

/** How a replay (and the mp4, and the share page) plays a record. */
export interface ReplayPlan {
  /** Ms from the start of playback each event fires at. */
  eventAt: number[]
  /** Story time's kept record spans, which the voice plays; null for an unvoiced story. */
  spans: KeptSpan[] | null
  /** Ms of playback the events and the voice fill. */
  lengthMs: number
}

/**
 * With the child's voice (`speech` found in it, even if empty) a story plays in story time
 * (src/story/story-time.ts); without voice to play it keeps the capped gaps.
 */
export function replayPlan(events: readonly StoryEvent[], speech: readonly Span[] | null): ReplayPlan {
  if (speech) {
    const tl = storyTime(events, speech)
    const lastAt = tl.eventAt[tl.eventAt.length - 1] ?? 0
    return { eventAt: tl.eventAt, spans: tl.spans, lengthMs: Math.max(tl.lengthMs, lastAt) }
  }
  const eventAt = replaySchedule(events)
  return { eventAt, spans: null, lengthMs: eventAt[eventAt.length - 1] ?? 0 }
}

/**
 * Plays a saved story back through a Director. A story with the child's voice plays in story time
 * (the voice waits to be decoded first: `play()` starts once it is); one without keeps capped gaps.
 * One clock: playback ms since `play()`, from wherever `seek()` put it.
 */
export class Replayer {
  private timer = 0
  private idx = 0
  private stopped = true
  /** Bumped by play/stop/seek so a play() still waiting for the voice does not start late. */
  private run = 0
  private plan: ReplayPlan | null
  private readonly voice: VoicePlayer | null
  /** Playback ms the clock started from, and the performance.now() it started at. */
  private clockFrom = 0
  private clockAt = 0
  /** Where a paused voiced replay picks up (mid-sentence); null = at the next event. */
  private resumeFrom: number | null = null

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
    // Without a voice the plan is known now; with one it waits for the decoded speech.
    this.plan = this.voice ? null : replayPlan(record.events, null)
  }

  /** Continue from the current position (the start, or wherever seek() put it). */
  play(): void {
    this.stopped = false
    clearTimeout(this.timer)
    const run = ++this.run
    if (this.plan) {
      this.begin(this.plan)
      return
    }
    const voice = this.voice
    if (!voice) return
    void voice.ready.then(() => {
      if (this.stopped || run !== this.run) return
      const plan = replayPlan(this.record.events, voice.hasAudio ? voice.speech : null)
      this.plan = plan
      this.begin(plan)
    })
  }

  stop(): void {
    // A voiced replay resumes where it was paused, not at the next event: that would skip words.
    if (!this.stopped && this.plan?.spans) this.resumeFrom = this.nowMs()
    this.stopped = true
    this.run++
    clearTimeout(this.timer)
    this.voice?.stop()
  }

  get position(): number {
    return this.idx
  }

  get length(): number {
    return this.record.events.length
  }

  /** Playback ms now (story time for a voiced story), or null before the plan is known. */
  get playbackMs(): number | null {
    if (!this.plan) return null
    return this.stopped ? this.startMs(this.plan) : this.nowMs()
  }

  /** Total playback ms, or null before the plan is known (a voice still decoding). */
  get lengthMs(): number | null {
    return this.plan?.lengthMs ?? null
  }

  /** Set the next event to play. The caller rebuilds the page up to here first. */
  seek(i: number): void {
    clearTimeout(this.timer)
    this.idx = Math.max(0, Math.min(this.record.events.length, i))
    this.resumeFrom = null
    if (!this.stopped) this.play()
  }

  /** Where playback starts: where a voiced replay was paused, else the very start or event idx's time. */
  private startMs(plan: ReplayPlan): number {
    if (plan.spans && this.resumeFrom !== null) return this.resumeFrom
    if (this.idx === 0) return 0
    return plan.eventAt[this.idx] ?? plan.lengthMs
  }

  private begin(plan: ReplayPlan): void {
    this.clockFrom = this.startMs(plan)
    this.clockAt = performance.now()
    this.resumeFrom = null
    if (plan.spans) this.voice?.play(this.clockFrom, plan.spans)
    this.step()
  }

  private nowMs(): number {
    return this.clockFrom + (performance.now() - this.clockAt)
  }

  private step(): void {
    const plan = this.plan
    if (this.stopped || !plan) return
    const events = this.record.events
    const now = this.nowMs()
    // Every event that is due fires now, in order (a late timer catches up instead of drifting).
    while (this.idx < events.length && (plan.eventAt[this.idx] ?? 0) <= now + 1) {
      this.fire(this.idx)
      this.idx++
    }
    if (this.idx >= events.length) {
      const doneAt = Math.max((plan.eventAt[events.length - 1] ?? 0) + DONE_AFTER_MS, plan.lengthMs)
      this.timer = window.setTimeout(() => {
        if (!this.stopped) this.handlers.onDone()
      }, Math.max(0, doneAt - now))
      return
    }
    this.timer = window.setTimeout(() => this.step(), Math.max(0, (plan.eventAt[this.idx] ?? 0) - now))
  }

  private fire(i: number): void {
    const events = this.record.events
    const ev = events[i]
    if (!ev) return
    if (ev.k === 'words') {
      const soFar = events
        .slice(0, i + 1)
        .filter((e) => e.k === 'words')
        .map((e) => (e.k === 'words' ? e.text : ''))
        .join(' ')
      this.handlers.onWords(soFar, ev.text)
    } else if (ev.k === 'end') {
      this.handlers.onEnd(this.record.seed)
    } else {
      this.director.execute(ev.line)
    }
    this.handlers.onProgress(i + 1, events.length)
  }
}
