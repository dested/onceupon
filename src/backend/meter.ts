import { api, ApiError } from './api'
import type {
  ApiErrorCode,
  EarsToken,
  EarsVendor,
  EndReason,
  SessionStart,
} from '../../packages/shared/src/api'

/**
 * The story meter: it opens a metered session on the server, reports mic-open time in beats while the
 * child talks, charges each typed message (priced by the server from its words), and closes the
 * session at the end. Beats never block the child on a flaky network (the
 * unsent time is kept and folded into the next beat or the stop), so the server settles on stop().
 */

const BEAT_EVERY_MS = 15_000

export interface MeterHandlers {
  onRemaining(sec: number): void
  onExhausted(): void
  onError(code: ApiErrorCode, message: string): void
}

export class StoryMeter {
  private _sessionId: string | null = null
  private _remainingSec: number | null = null
  private _ears: EarsToken | null = null
  private startPromise: Promise<SessionStart> | null = null
  private beatTimer = 0
  private listening = false
  private spanStart = 0
  /** Mic-open ms measured but not yet reported to the server. */
  private unsentMs = 0
  private stopped = false
  private exhaustedFired = false
  /** The ears vendor the session was opened with, reused when a stale session is reopened. */
  private vendor: EarsVendor = 'browser'

  constructor(
    private storyId: string,
    private handlers: MeterHandlers
  ) {}

  get sessionId(): string | null {
    return this._sessionId
  }
  get remainingSec(): number | null {
    return this._remainingSec
  }
  get ears(): EarsToken | null {
    return this._ears
  }

  /** Open the session (idempotent: the in-flight promise is cached). Rejects with the server's error. */
  ensureStarted(ears: EarsVendor): Promise<SessionStart> {
    if (this.startPromise) return this.startPromise
    this.vendor = ears
    const promise = (async (): Promise<SessionStart> => {
      const start = await api('session.start', { storyId: this.storyId, ears })
      this._sessionId = start.sessionId
      this._remainingSec = start.remainingSec
      this._ears = start.ears
      this.handlers.onRemaining(start.remainingSec)
      return start
    })()
    // Clear on failure so a later attempt (e.g. after a purchase) can retry.
    promise.catch(() => {
      if (this.startPromise === promise) this.startPromise = null
    })
    this.startPromise = promise
    return promise
  }

  /** Fold the currently-open listening span into the unsent total. */
  private collect(now: number): void {
    if (this.listening) {
      this.unsentMs += now - this.spanStart
      this.spanStart = now
    }
  }

  setListening(on: boolean): void {
    if (on) {
      if (this.listening || this.stopped) return
      this.listening = true
      this.spanStart = performance.now()
      window.clearInterval(this.beatTimer)
      this.beatTimer = window.setInterval(() => void this.beat(), BEAT_EVERY_MS)
    } else {
      if (!this.listening) return
      this.collect(performance.now())
      this.listening = false
      window.clearInterval(this.beatTimer)
      this.beatTimer = 0
      void this.beat()
    }
  }

  private async beat(): Promise<void> {
    const sessionId = this._sessionId
    this.collect(performance.now())
    const ms = Math.round(this.unsentMs)
    this.unsentMs = 0
    if (!sessionId || ms <= 0) return
    try {
      await this.withSession(async (id) => {
        const res = await api('session.beat', { sessionId: id, listeningMs: ms })
        this.report(res.remainingSec, res.exhausted)
      })
    } catch (e) {
      // Keep counting locally so the time is not lost; the server settles on stop.
      this.unsentMs += ms
      if (e instanceof ApiError && e.code === 'exhausted') this.report(0, true)
      else if (e instanceof ApiError) this.handlers.onError(e.code, e.message)
    }
  }

  /**
   * Charge one typed message. The server prices it from the text (talking time, see
   * packages/shared/src/typed.ts); we never report a duration. Exhausted -> the same sleepy end as a beat.
   */
  async typed(text: string): Promise<void> {
    if (this.stopped) return
    try {
      await this.withSession(async (sessionId) => {
        const res = await api('session.typed', { sessionId, text })
        this.report(res.remainingSec, res.exhausted)
      })
    } catch (e) {
      if (e instanceof ApiError && e.code === 'exhausted') this.report(0, true)
      else if (e instanceof ApiError) this.handlers.onError(e.code, e.message)
    }
  }

  private report(remainingSec: number, exhausted: boolean): void {
    this._remainingSec = remainingSec
    this.handlers.onRemaining(remainingSec)
    if (exhausted && !this.exhaustedFired) {
      this.exhaustedFired = true
      this.handlers.onExhausted()
    }
  }

  /**
   * Run a metered call against the open session. The server closes a session whose heartbeat stopped
   * for ~2 minutes (mic closed, or a slow typist); a `not_found` then opens a fresh one for the same
   * story and retries once, so a long pause never makes the rest of the story free or broken.
   */
  private async withSession(call: (sessionId: string) => Promise<void>): Promise<void> {
    const vendor = this.vendor
    await this.ensureStarted(vendor)
    const sessionId = this._sessionId
    if (!sessionId) return
    try {
      await call(sessionId)
    } catch (e) {
      if (!(e instanceof ApiError) || e.code !== 'not_found' || this.stopped) throw e
      if (this._sessionId === sessionId) {
        this._sessionId = null
        this.startPromise = null
      }
      await this.ensureStarted(vendor)
      const fresh = this._sessionId
      if (fresh) await call(fresh)
    }
  }

  async refreshEars(): Promise<EarsToken> {
    const sessionId = this._sessionId
    if (!sessionId) throw new Error('no story session')
    const token = await api('ears.token', { sessionId })
    this._ears = token
    return token
  }

  /** Close the session, folding any unsent mic time into the final report. Idempotent. */
  async stop(ended: EndReason | null): Promise<void> {
    if (this.stopped) return
    this.stopped = true
    this.collect(performance.now())
    this.listening = false
    window.clearInterval(this.beatTimer)
    this.beatTimer = 0
    const sessionId = this._sessionId
    const ms = Math.round(this.unsentMs)
    this.unsentMs = 0
    if (!sessionId) return
    try {
      const res = await api('session.stop', { sessionId, listeningMs: ms, ended })
      this._remainingSec = res.remainingSec
      this.handlers.onRemaining(res.remainingSec)
    } catch (e) {
      if (e instanceof ApiError) this.handlers.onError(e.code, e.message)
    }
  }
}
