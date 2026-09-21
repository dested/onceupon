/**
 * Typed boundary over the browser's (prefixed) Web Speech API. The DOM lib does not ship usable
 * types for it, so the one cast in this app lives here, at the constructor.
 */

export interface RecResult {
  transcript: string
  isFinal: boolean
}

export interface RecognizerHandlers {
  onResult: (results: RecResult[], resultIndex: number) => void
  onEnd: () => void
  onError: (message: string) => void
  /** Fires when audio is really being captured and understood; the UI says "listening" only then. */
  onReady: () => void
  /** Milliseconds of audio actually sent to a paid transcriber (Chrome's is free and never calls this). */
  onAudio?: (ms: number) => void
  /** Mic loudness 0..1 per audio chunk (about 10x a second). */
  onLevel?: (level: number) => void
  /** What the transcriber said back, for the voice lab log. */
  onTrace?: (kind: SttTraceKind, text: string) => void
}

export type SttTraceKind = 'ready' | 'speech' | 'delta' | 'final' | 'commit' | 'error'

export interface Recognizer {
  start: () => void
  stop: () => void
  abort: () => void
}

interface AlternativeLike {
  transcript: string
}
interface ResultLike {
  isFinal: boolean
  length: number
  [index: number]: AlternativeLike
}
interface ResultListLike {
  length: number
  [index: number]: ResultLike
}
interface ResultEventLike {
  resultIndex: number
  results: ResultListLike
}
interface ErrorEventLike {
  error: string
  message?: string
}
interface SpeechRecognitionLike {
  continuous: boolean
  interimResults: boolean
  lang: string
  maxAlternatives: number
  onresult: ((ev: ResultEventLike) => void) | null
  onstart: (() => void) | null
  onend: (() => void) | null
  onerror: ((ev: ErrorEventLike) => void) | null
  start: () => void
  stop: () => void
  abort: () => void
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike

function findCtor(): SpeechRecognitionCtor | null {
  const w: unknown = window
  if (typeof w !== 'object' || w === null) return null
  const bag = w as Record<string, unknown>
  const ctor = bag['SpeechRecognition'] ?? bag['webkitSpeechRecognition']
  if (typeof ctor !== 'function') return null
  // Boundary cast: the browser guarantees this shape for webkitSpeechRecognition.
  return ctor as SpeechRecognitionCtor
}

export function speechSupported(): boolean {
  return findCtor() !== null
}

export function createRecognizer(handlers: RecognizerHandlers, lang = 'en-US'): Recognizer | null {
  const Ctor = findCtor()
  if (!Ctor) return null
  const rec = new Ctor()
  rec.continuous = true
  rec.interimResults = true
  rec.lang = lang
  rec.maxAlternatives = 1
  rec.onresult = (ev) => {
    const out: RecResult[] = []
    for (let i = 0; i < ev.results.length; i++) {
      const r = ev.results[i]
      if (!r) continue
      const alt = r[0]
      out.push({ transcript: alt ? alt.transcript : '', isFinal: r.isFinal })
    }
    handlers.onResult(out, ev.resultIndex)
  }
  rec.onstart = () => handlers.onReady()
  rec.onend = () => handlers.onEnd()
  rec.onerror = (ev) => handlers.onError(ev.error)
  return {
    start: () => rec.start(),
    stop: () => rec.stop(),
    abort: () => rec.abort(),
  }
}

/**
 * Decides when spoken words are "ready to draw". Final results go out immediately. Interim text
 * goes out early once it has sat still for a moment and has enough words, holding back the last
 * word or two because the recognizer keeps revising the tail.
 */
export interface TrackerOptions {
  /** Interim text unchanged for this long counts as settled. */
  stableMs: number
  /** Settled words needed before an early release. */
  minWords: number
  /** Release regardless of stability once this many pile up. */
  maxWords: number
  /** Trailing words to keep back on an early release, in case the recognizer still rewrites them. */
  holdBack: number
}

/** Chrome rewrites the tail of an interim result as it hears more, so keep the last word back. */
export const CHROME_TRACKER: TrackerOptions = { stableMs: 700, minWords: 5, maxWords: 12, holdBack: 1 }
/**
 * OpenAI's live model appends words and never rewrites them, so nothing is held back. It never
 * produces finals here (punctuation lands on any short breath), so the quiet window is the only
 * "done talking" signal: ~0.7s without a new word, on top of the model's own ~1s lag. Guessing
 * wrong is cheap now: a call that has barely started is thrown away and re-sent with the rest of
 * the sentence (Director restart), so the window leans quick rather than sure.
 */
export const LIVE_TRACKER: TrackerOptions = { stableMs: 700, minWords: 1, maxWords: 14, holdBack: 0 }
/** Pause-gated OpenAI models return whole phrases as finals; interim is rare, so be quick with it. */
export const PHRASE_TRACKER: TrackerOptions = { stableMs: 500, minWords: 1, maxWords: 12, holdBack: 0 }

export class TranscriptTracker {
  private consumed = new Map<number, number>()
  private lastChange = new Map<number, { text: string; at: number }>()
  private latest: RecResult[] = []
  private finalText = ''

  constructor(
    private emit: (words: string) => void,
    private opts: TrackerOptions = CHROME_TRACKER
  ) {}

  /** Swap the release rules (the recognizer decides them). */
  configure(opts: TrackerOptions): void {
    this.opts = opts
  }

  /** Call whenever the recognizer restarts: result indexes start over. */
  reset(): void {
    this.consumed.clear()
    this.lastChange.clear()
    this.latest = []
  }

  get final(): string {
    return this.finalText
  }

  /** The words the child is saying right now that have not been drawn yet. */
  get interim(): string {
    const parts: string[] = []
    this.latest.forEach((r, i) => {
      if (r.isFinal) return
      const words = r.transcript.trim().split(/\s+/).filter(Boolean)
      const c = this.consumed.get(i) ?? 0
      parts.push(words.slice(c).join(' '))
    })
    return parts.filter(Boolean).join(' ')
  }

  onResult(results: RecResult[], now: number): void {
    this.latest = results
    results.forEach((r, i) => {
      const text = r.transcript.trim()
      const words = text.split(/\s+/).filter(Boolean)
      const c = this.consumed.get(i) ?? 0
      if (r.isFinal) {
        if (words.length > c) {
          const chunk = words.slice(c).join(' ')
          this.finalText = this.finalText ? `${this.finalText} ${chunk}` : chunk
          this.emit(chunk)
        }
        this.consumed.set(i, words.length)
        this.lastChange.delete(i)
      } else {
        const prev = this.lastChange.get(i)
        if (!prev || prev.text !== text) this.lastChange.set(i, { text, at: now })
      }
    })
  }

  /** Call on an interval to release stable interim words early. */
  tick(now: number): void {
    this.latest.forEach((r, i) => {
      if (r.isFinal) return
      const words = r.transcript.trim().split(/\s+/).filter(Boolean)
      const c = this.consumed.get(i) ?? 0
      const unconsumed = words.length - c
      const change = this.lastChange.get(i)
      const stable = change ? now - change.at >= this.opts.stableMs : false
      let take = 0
      if (stable && unconsumed >= this.opts.minWords) take = words.length - this.opts.holdBack
      else if (unconsumed >= this.opts.maxWords) take = words.length - this.opts.holdBack - 1
      if (take > c) {
        const chunk = words.slice(c, take).join(' ')
        this.finalText = this.finalText ? `${this.finalText} ${chunk}` : chunk
        this.consumed.set(i, take)
        this.emit(chunk)
      }
    })
  }
}
