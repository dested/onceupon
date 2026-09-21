import type { Scene } from '~/engine/scene'
import type { Command } from '~/engine/types'
import type { Dialect } from './dialect'
import type { Stage } from '~/engine/stage'
import type { LlmProvider } from './providers'
import { estimateCost, type Usage } from './models'

export interface CallStat {
  id: number
  model: string
  sentAt: number
  firstTokenMs: number | null
  doneMs: number | null
  chars: number
  lines: number
  words: string
  error: string | null
  usage: Usage | null
  costUsd: number | null
}

export type DirectorStatus = 'idle' | 'thinking' | 'drawing'

export type DirectorEvent =
  /** `drawing` = words of the call in flight; `queued` = words heard but not sent yet. */
  | { k: 'status'; status: DirectorStatus; drawing: string; queued: string }
  | { k: 'line'; line: string; ok: boolean; error: string | null }
  | { k: 'call'; stat: CallStat }
  | { k: 'warn'; message: string }
  /** The model declined the new words as not okay for a small child. */
  | { k: 'skip'; words: string }
  /** More words arrived early in a call: it was thrown away and re-sent with the whole text. */
  | { k: 'restart'; words: string }

/** A call is cheap to throw away until it has drawn this many lines, at most this many times per beat. */
const RESTART_MAX_LINES = 3
const RESTART_MAX = 2

export interface DirectorDeps {
  scene: Scene
  stage: Stage
  dialect: Dialect
  getProvider: () => LlmProvider | null
  onEvent: (e: DirectorEvent) => void
}

/**
 * Turns words into drawing. One model call in flight at a time; words that arrive during a call
 * pile up and go out together in the next one. Each streamed line executes the moment it lands.
 */
export class Director {
  private pending = ''
  private current = ''
  private inFlight = false
  /** Lines the in-flight call has executed; a restart is only cheap while this is small. */
  private linesThisCall = 0
  private restarts = 0
  private restarting = false
  /** Every chunk sent so far, in order; the prompt caches them as a prefix. */
  private storyChunks: string[] = []
  private callId = 0
  private abort: AbortController | null = null
  private stopped = false

  constructor(private deps: DirectorDeps) {
    deps.dialect.later = (cmds) => {
      if (this.stopped) return
      for (const c of cmds) this.applyCmd(c)
    }
  }

  get dialect(): Dialect {
    return this.deps.dialect
  }

  private applyCmd(cmd: Command): void {
    for (const ev of this.deps.scene.apply(cmd)) {
      if (ev.k === 'warn') this.deps.onEvent({ k: 'warn', message: ev.message })
      this.deps.stage.handle(ev)
    }
  }

  get story(): string {
    return this.storyChunks.join(' ')
  }

  private dropLastChunk(words: string): void {
    if (this.storyChunks[this.storyChunks.length - 1] === words) this.storyChunks.pop()
  }

  /**
   * New finalized words from speech or typing. If a call is in flight but has barely started
   * (the child paused mid-sentence and went on), throw it away and re-send with the whole text so
   * the beat is drawn once, from the full sentence. Deep into a drawing, the words just queue.
   */
  feed(words: string): void {
    const w = words.trim()
    if (!w) return
    if (this.inFlight && this.abort && this.linesThisCall < RESTART_MAX_LINES && this.restarts < RESTART_MAX) {
      this.restarts++
      this.restarting = true
      this.dropLastChunk(this.current)
      this.pending = [this.current, this.pending, w].filter(Boolean).join(' ')
      this.deps.onEvent({ k: 'restart', words: this.pending })
      this.abort.abort()
      return
    }
    this.pending = this.pending ? `${this.pending} ${w}` : w
    if (this.inFlight) this.emitStatus('drawing')
    void this.kick()
  }

  private emitStatus(status: DirectorStatus): void {
    this.deps.onEvent({ k: 'status', status, drawing: this.current, queued: this.pending })
  }

  /** Execute a DSL line directly (replay, or tests). Returns whether it parsed. */
  execute(line: string): boolean {
    const res = this.deps.dialect.parse(line)
    if (!res.ok) {
      this.deps.onEvent({ k: 'line', line, ok: false, error: res.error })
      return false
    }
    for (const cmd of res.cmds) this.applyCmd(cmd)
    this.deps.onEvent({ k: 'line', line, ok: true, error: null })
    return true
  }

  /** A `skip` line ends the call: the words leave the story and the session hears about it. */
  private isSkip(line: string, words: string): boolean {
    if (!this.deps.dialect.isSkip(line)) return false
    this.dropLastChunk(words)
    this.deps.onEvent({ k: 'line', line: 'skip', ok: true, error: null })
    this.deps.onEvent({ k: 'skip', words })
    this.abort?.abort()
    return true
  }

  reset(): void {
    this.abort?.abort()
    this.abort = null
    this.pending = ''
    this.current = ''
    this.storyChunks = []
    this.inFlight = false
    this.restarts = 0
    this.restarting = false
    this.stopped = false
    this.deps.dialect.reset()
    this.emitStatus('idle')
  }

  stop(): void {
    this.stopped = true
    this.abort?.abort()
  }

  private async kick(): Promise<void> {
    if (this.inFlight || !this.pending || this.stopped) return
    const provider = this.deps.getProvider()
    if (!provider) {
      this.deps.onEvent({ k: 'warn', message: 'no API key for the selected provider (open settings)' })
      return
    }
    const words = this.pending
    this.pending = ''
    this.current = words
    this.inFlight = true
    this.linesThisCall = 0
    const wasRestart = this.restarting
    this.restarting = false
    const stat: CallStat = {
      id: ++this.callId,
      model: provider.label,
      sentAt: performance.now(),
      firstTokenMs: null,
      doneMs: null,
      chars: 0,
      lines: 0,
      words,
      error: null,
      usage: null,
      costUsd: null,
    }
    this.emitStatus('thinking')
    this.deps.onEvent({ k: 'call', stat: { ...stat } })
    const dialect = this.deps.dialect
    const user = dialect.buildUser({ storyChunks: this.storyChunks, newWords: words })
    this.storyChunks.push(words)
    this.abort = new AbortController()
    let buf = ''
    try {
      for await (const chunk of provider.stream({ system: dialect.system, user, maxTokens: dialect.maxTokens, signal: this.abort.signal })) {
        if (chunk.k === 'usage') {
          stat.usage = chunk.usage
          stat.costUsd = estimateCost(provider.model, chunk.usage)
          continue
        }
        const delta = chunk.text
        if (stat.firstTokenMs === null) {
          stat.firstTokenMs = performance.now() - stat.sentAt
          this.emitStatus('drawing')
        }
        stat.chars += delta.length
        buf += delta
        let nl = buf.indexOf('\n')
        while (nl >= 0) {
          const line = buf.slice(0, nl)
          buf = buf.slice(nl + 1)
          nl = buf.indexOf('\n')
          if (line.trim()) {
            stat.lines++
            this.linesThisCall++
            if (this.isSkip(line, words)) break
            this.execute(line)
          }
        }
      }
      if (buf.trim() && !this.isSkip(buf, words)) {
        stat.lines++
        this.execute(buf)
      }
    } catch (e: unknown) {
      // Our own abort (skip, restart, stop): the SDK throws its own error type, so ask the signal.
      if (this.abort?.signal.aborted || (e instanceof DOMException && e.name === 'AbortError')) {
        if (this.restarting) stat.error = 'restarted: more words came in'
      } else {
        stat.error = e instanceof Error ? e.message : String(e)
        this.deps.onEvent({ k: 'warn', message: stat.error })
      }
    } finally {
      stat.doneMs = performance.now() - stat.sentAt
      this.deps.onEvent({ k: 'call', stat: { ...stat } })
      if (!this.restarting && stat.error === null) this.restarts = 0
      if (wasRestart && stat.error === null) this.deps.onEvent({ k: 'restart', words: '' })
      this.inFlight = false
      this.current = ''
      this.abort = null
      this.emitStatus(this.pending ? 'thinking' : 'idle')
      if (this.pending && !this.stopped) void this.kick()
    }
  }
}
