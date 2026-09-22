import { CrayonAudio } from '~/engine/audio'
import { Scene } from '~/engine/scene'
import { Stage } from '~/engine/stage'
import { Director, type DirectorEvent } from '~/llm/director'
import { makeProvider, type LlmProvider } from '~/llm/providers'
import {
  CHROME_TRACKER,
  createRecognizer,
  speechSupported,
  TranscriptTracker,
  type Recognizer,
  type RecResult,
  type SttTraceKind,
} from '~/speech/recognition'
import { trackerOptionsFor, VOICE_HOLD_MS, VOICE_LEVEL } from '~/speech/beat-rules'
import { buildDebugReport } from './debug-report'
import { appStore, resolveStt } from './store'
import { createOpenAiRealtimeRecognizer } from '~/speech/openai-realtime'
import { createDeepgramRecognizer } from '~/speech/deepgram'
import { warmMic } from '~/speech/pcm-mic'
import {
  getStory,
  listStories,
  newStoryId,
  saveStory,
  titleFromWords,
  type StoryEvent,
  type StoryRecord,
} from './storage'
import { Replayer } from './replay'
import { exposeDebugHandle, type DebugHandle } from '~/debug-handle'
import { isDialectId, makeDialect } from '~/llm/dialect'
import { cleanText, setModeration } from './clean'
import { splitTheEnd } from './the-end'

let lineCounter = 0
let traceCounter = 0

/** Stands in for words the model skipped, so a replay is honest about the gap. */
export const SKIPPED_MARK = '(the crayon skipped a part)'

function pushDirectorEvent(e: DirectorEvent): void {
  switch (e.k) {
    case 'status':
      appStore.set({ status: e.status, drawingWords: e.drawing, queuedWords: e.queued })
      break
    case 'line':
      appStore.set((s) => ({
        lines: [
          ...s.lines.slice(-199),
          { id: ++lineCounter, t: performance.now(), line: e.line, ok: e.ok, error: e.error },
        ],
      }))
      break
    case 'call':
      appStore.set((s) => {
        const others = s.calls.filter((c) => c.id !== e.stat.id)
        const st = e.stat
        // The completion event is the one with doneMs set; count spend once, there.
        // A restarted call (aborted early, no usage) is not a call worth counting.
        const spend =
          st.doneMs === null || (st.error !== null && st.usage === null)
            ? s.spend
            : {
                calls: s.spend.calls + 1,
                unpriced: s.spend.unpriced + (st.costUsd === null ? 1 : 0),
                input: s.spend.input + (st.usage?.input ?? 0) + (st.usage?.cacheWrite ?? 0),
                cached: s.spend.cached + (st.usage?.cacheRead ?? 0),
                output: s.spend.output + (st.usage?.output ?? 0),
                usd: s.spend.usd + (st.costUsd ?? 0),
                firstTokenTotalMs: s.spend.firstTokenTotalMs + (st.firstTokenMs ?? 0),
                firstTokenSamples: s.spend.firstTokenSamples + (st.firstTokenMs === null ? 0 : 1),
                audioMs: s.spend.audioMs,
              }
        return { calls: [...others.slice(-19), st], spend }
      })
      break
    case 'warn':
      appStore.set((s) => ({ warnings: [...s.warnings.slice(-9), e.message] }))
      break
    case 'restart':
      // words = the combined text being re-sent; empty = that re-sent call finished.
      appStore.set({ note: e.words ? 'hold on... drawing all of that' : '' })
      break
  }
}

function currentProvider(): LlmProvider | null {
  const { settings } = appStore.get()
  return makeProvider(settings.provider, settings.model, settings.keys)
}

/** A live storytelling session bound to one canvas: mic in, crayon out, story log saved as it goes. */
export class LiveSession {
  readonly scene = new Scene()
  readonly stage: Stage
  readonly director: Director
  readonly audio = new CrayonAudio()
  private recognizer: Recognizer | null = null
  private tracker: TranscriptTracker
  private tickTimer = 0
  /** Last time the mic level read as a voice (streaming recognizers only; Chrome reports no level). */
  private lastLoudAt = 0
  private saveTimer = 0
  private noteTimer = 0
  private listenT0 = 0
  private wantListening = false
  private story: StoryRecord
  private t0 = performance.now()
  private covers: string[] = []
  /** The child said "The End": stop taking words, play the finale, show the closing card. */
  private ended = false
  private directorIdle = true
  private pendingFinale = false

  constructor(canvas: HTMLCanvasElement) {
    const seed = Math.floor(Math.random() * 1e9)
    const dialect = appStore.get().settings.dialect
    setModeration(appStore.get().settings.moderation)
    this.story = {
      id: newStoryId(),
      title: '',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      seed,
      cover: null,
      dialect,
      events: [],
    }
    this.stage = new Stage(canvas, { seed, audio: this.audio })
    this.stage.onPageSnapshot = (thumb, pageIndex) => {
      const title = this.scene.pages[pageIndex - 1]?.title ?? ''
      appStore.set((s) => ({ pages: [...s.pages, { index: pageIndex, title, thumb }] }))
      this.covers.push(thumb)
    }
    this.director = new Director({
      scene: this.scene,
      stage: this.stage,
      dialect: makeDialect(dialect, this.scene, { moderation: appStore.get().settings.moderation }),
      getProvider: currentProvider,
      onEvent: (e) => {
        pushDirectorEvent(e)
        if (e.k === 'status') {
          this.directorIdle = e.status === 'idle'
          if (this.pendingFinale && this.directorIdle) this.playFinale()
        }
        if (e.k === 'line' && e.ok && e.line !== 'skip')
          this.record({ k: 'cmd', t: this.now(), line: e.line })
        if (e.k === 'skip') this.skip(e.words)
      },
    })
    this.tracker = new TranscriptTracker(
      {
        emit: (words) => this.feed(words),
        correct: (released, actual) => this.correct(released, actual),
      },
      CHROME_TRACKER
    )
    appStore.set({
      micSupported: speechSupported() || resolveStt(appStore.get().settings) !== 'browser',
      status: 'idle',
      ending: false,
      ended: false,
      transcriptFinal: '',
      transcriptInterim: '',
      pages: [],
      warnings: [],
    })
    this.stage.start()
    this.audio.setEnabled(appStore.get().settings.sound)
    const handle: DebugHandle = {
      scene: this.scene,
      stage: this.stage,
      director: this.director,
      story: () => this.story,
      t0: this.t0,
      listenT0: () => this.listenT0,
      report: () => buildDebugReport(appStore.get(), handle),
    }
    exposeDebugHandle(handle)
    if (resolveStt(appStore.get().settings) !== 'browser')
      void warmMic(appStore.get().settings.micDeviceId)
  }

  private now(): number {
    return Math.round(performance.now() - this.t0)
  }

  private record(ev: StoryEvent): void {
    this.story.events.push(ev)
    clearTimeout(this.saveTimer)
    this.saveTimer = window.setTimeout(() => this.save(), 1500)
  }

  /**
   * The model said the latest words are not for a picture book. Pull them out of the saved story
   * and the transcript, leave a marker so a replay shows a part was skipped, and say so on screen.
   */
  private skip(words: string): void {
    const events = this.story.events
    let i = events.length - 1
    let joined = ''
    const drop: number[] = []
    while (i >= 0 && joined.length < words.length) {
      const ev = events[i]
      if (ev?.k === 'words') {
        joined = joined ? `${ev.text} ${joined}` : ev.text
        drop.push(i)
      }
      i--
    }
    if (joined !== words) return
    for (const idx of drop) events.splice(idx, 1)
    this.record({ k: 'words', t: this.now(), text: SKIPPED_MARK })
    appStore.set({
      transcriptFinal: this.transcriptFromEvents(),
      note: 'the crayon skipped that part',
    })
    clearTimeout(this.noteTimer)
    this.noteTimer = window.setTimeout(() => appStore.set({ note: '' }), 4000)
  }

  /** The running transcript as saved: every `words` event's text, in order. */
  private transcriptFromEvents(): string {
    return this.story.events
      .filter((e) => e.k === 'words')
      .map((e) => (e.k === 'words' ? e.text : ''))
      .join(' ')
  }

  /**
   * A final disagreed with interim words already drawn (Deepgram rewrote them). The model already
   * drew from the old words, which is fine; fix the record and transcript so the replay is honest.
   * Walk the `words` events backwards until their joined text ends with `released`, then swap that
   * trailing text for `actual`, collapsing the span into one event at the earliest time.
   */
  private correct(released: string, actual: string): void {
    const target = cleanText(released)
    const replacement = cleanText(actual)
    const normWords = (s: string): string[] =>
      s
        .toLowerCase()
        .replace(/[^\p{L}\p{N}'\s]/gu, ' ')
        .split(/\s+/)
        .filter(Boolean)
    const tgt = normWords(target)
    if (tgt.length === 0) return
    const events = this.story.events
    const spanIdx: number[] = []
    let acc: string[] = []
    let found = false
    for (let i = events.length - 1; i >= 0; i--) {
      const ev = events[i]
      if (!ev || ev.k !== 'words' || ev.text === SKIPPED_MARK) continue
      spanIdx.unshift(i)
      acc = [...normWords(ev.text), ...acc]
      if (acc.length >= tgt.length && tgt.every((w, j) => acc[acc.length - tgt.length + j] === w)) {
        found = true
        break
      }
    }
    if (!found) return
    const rawWords: string[] = []
    for (const idx of spanIdx) {
      const ev = events[idx]
      if (ev && ev.k === 'words') rawWords.push(...ev.text.split(/\s+/).filter(Boolean))
    }
    const keep = rawWords.slice(0, Math.max(0, rawWords.length - tgt.length))
    const replWords = replacement.split(/\s+/).filter(Boolean)
    const newText = [...keep, ...replWords].join(' ').trim()
    const earliest = spanIdx[0]
    if (earliest === undefined) return
    for (let k = spanIdx.length - 1; k >= 1; k--) {
      const idx = spanIdx[k]
      if (idx !== undefined) events.splice(idx, 1)
    }
    const e = events[earliest]
    if (e && e.k === 'words') {
      if (newText) e.text = newText
      else events.splice(earliest, 1)
    }
    appStore.set({ transcriptFinal: this.transcriptFromEvents() })
    clearTimeout(this.saveTimer)
    this.saveTimer = window.setTimeout(() => this.save(), 1500)
  }

  private feed(raw: string): void {
    if (this.ended) return
    const { before, ended } = splitTheEnd(cleanText(raw))
    if (before) {
      this.record({ k: 'words', t: this.now(), text: before })
      appStore.set((s) => ({
        transcriptFinal: s.transcriptFinal ? `${s.transcriptFinal} ${before}` : before,
      }))
      this.director.feed(before)
    }
    if (ended) this.endStory()
  }

  /**
   * The child said "The End". Stop listening, let the current drawing finish, then play the finale
   * and show the closing card. Words that arrive afterward are ignored (feed returns early).
   */
  private endStory(): void {
    if (this.ended) return
    this.ended = true
    this.stopListening()
    this.record({ k: 'words', t: this.now(), text: 'The End' })
    appStore.set((s) => ({
      ending: true,
      transcriptFinal: s.transcriptFinal ? `${s.transcriptFinal} The End` : 'The End',
    }))
    this.pendingFinale = true
    if (this.directorIdle) this.playFinale()
  }

  private playFinale(): void {
    if (!this.pendingFinale) return
    this.pendingFinale = false
    this.record({ k: 'end', t: this.now() })
    this.audio.pageFlip()
    void this.stage.finale(this.story.seed).then(() => {
      appStore.set({ ending: false, ended: true })
      this.save()
    })
  }

  /** The id of the story being told, so the closing card can open its replay. */
  get storyId(): string {
    return this.story.id
  }

  save(): void {
    // A story nobody told (debug-driven lines, no words) is not worth a shelf slot.
    if (!this.story.events.some((e) => e.k === 'words')) return
    const words = this.story.events
      .filter((e) => e.k === 'words')
      .map((e) => (e.k === 'words' ? e.text : ''))
      .filter((t) => t !== SKIPPED_MARK && t !== 'The End')
      .join(' ')
    this.story.title = titleFromWords(words)
    this.story.updatedAt = Date.now()
    this.story.cover = this.stage.thumbnail() || this.covers[this.covers.length - 1] || null
    saveStory(this.story)
    appStore.set({ stories: listStories() })
  }

  resize(): void {
    this.stage.resize()
  }

  setSound(on: boolean): void {
    this.audio.setEnabled(on)
  }

  /** Typed words behave exactly like spoken ones. */
  typeWords(text: string): void {
    void this.audio.start()
    this.feed(text)
  }

  private sttKind: 'browser' | 'openai' | 'deepgram' | null = null

  async startListening(): Promise<void> {
    void this.audio.start()
    const settings = appStore.get().settings
    const kind = resolveStt(settings)
    if (this.recognizer && this.sttKind !== kind) {
      this.recognizer.abort()
      this.recognizer = null
    }
    if (!this.recognizer) {
      const handlers = {
        onResult: (results: RecResult[]) => {
          this.tracker.onResult(results, performance.now())
          appStore.set({ transcriptInterim: cleanText(this.tracker.interim) })
        },
        onEnd: () => {
          if (this.wantListening) {
            this.tracker.reset()
            window.setTimeout(
              () => {
                if (this.wantListening) this.safeStart()
              },
              kind === 'browser' ? 120 : 800
            )
          } else appStore.set({ listening: false, micStarting: false, micLevel: 0 })
        },
        onReady: () => {
          if (this.wantListening) appStore.set({ listening: true, micStarting: false })
        },
        onAudio: (ms: number) => {
          appStore.set((s) => ({ spend: { ...s.spend, audioMs: s.spend.audioMs + ms } }))
        },
        onLevel: (level: number) => {
          if (level >= VOICE_LEVEL) this.lastLoudAt = performance.now()
          appStore.set({ micLevel: level })
        },
        onTrace: (kind: SttTraceKind, text: string) => {
          const t = Math.round(performance.now() - this.listenT0)
          appStore.set((s) => ({
            sttLog: [...s.sttLog.slice(-59), { id: ++traceCounter, t, kind, text }],
          }))
        },
        onError: (err: string) => {
          if (
            err === 'not-allowed' ||
            err === 'service-not-allowed' ||
            /permission|NotAllowed/i.test(err)
          ) {
            this.wantListening = false
            appStore.set((s) => ({
              listening: false,
              warnings: [...s.warnings, 'microphone permission denied'],
            }))
          } else if (kind === 'openai' || kind === 'deepgram') {
            appStore.set((s) => ({ warnings: [...s.warnings, `speech: ${err}`] }))
          }
        },
      }
      this.recognizer =
        kind === 'openai'
          ? createOpenAiRealtimeRecognizer(handlers, {
              apiKey: settings.keys.openai,
              model: settings.sttModel,
              prompt: '',
              silenceMs: 350,
              maxTurnMs: 2500,
              deviceId: settings.micDeviceId,
            })
          : kind === 'deepgram'
            ? createDeepgramRecognizer(handlers, {
                apiKey: settings.keys.deepgram,
                model: settings.deepgramModel,
                deviceId: settings.micDeviceId,
              })
            : createRecognizer(handlers)
      this.tracker.configure(trackerOptionsFor(settings))
      this.sttKind = kind
    }
    if (!this.recognizer) {
      appStore.set((s) => ({
        warnings: [
          ...s.warnings,
          'speech recognition needs Chrome, an OpenAI key, or a Deepgram key',
        ],
      }))
      return
    }
    this.wantListening = true
    this.tracker.reset()
    this.listenT0 = performance.now()
    appStore.set({ micStarting: true, sttLog: [], micLevel: 0 })
    this.safeStart()
    clearInterval(this.tickTimer)
    this.tickTimer = window.setInterval(() => {
      const now = performance.now()
      // The mic was loud a moment ago: the child is still talking, hold the quiet-window release.
      this.tracker.tick(now, now - this.lastLoudAt < VOICE_HOLD_MS)
      appStore.set({ transcriptInterim: cleanText(this.tracker.interim) })
    }, 250)
  }

  private safeStart(): void {
    try {
      this.recognizer?.start()
    } catch {
      // already started; Chrome throws if start() overlaps
    }
  }

  stopListening(): void {
    this.wantListening = false
    clearInterval(this.tickTimer)
    this.recognizer?.stop()
    appStore.set({ listening: false, micStarting: false, transcriptInterim: '' })
  }

  destroy(): void {
    exposeDebugHandle(null)
    this.stopListening()
    this.director.stop()
    this.stage.stop()
    clearTimeout(this.saveTimer)
    this.save()
  }
}

/** Plays a saved story back on its own canvas. */
export class ReplaySession {
  readonly stage: Stage
  private director: Director
  private replayer: Replayer | null = null
  private record: StoryRecord | null

  constructor(canvas: HTMLCanvasElement, storyId: string) {
    this.record = getStory(storyId)
    const seed = this.record?.seed ?? 1
    this.stage = new Stage(canvas, { seed, audio: null })
    this.director = this.freshDirector()
    this.stage.start()
    appStore.set({
      transcriptFinal: '',
      transcriptInterim: '',
      pages: [],
      replayCaption: '',
      replayPos: 0,
      replayLen: this.record?.events.length ?? 0,
    })
  }

  /** A clean scene + director for this record's dialect; the stage's page snapshots follow it. */
  private freshDirector(): Director {
    const scene = new Scene()
    const dialectId = this.record?.dialect
    const director = new Director({
      scene,
      stage: this.stage,
      dialect: makeDialect(dialectId && isDialectId(dialectId) ? dialectId : 'lines', scene, {
        moderation: appStore.get().settings.moderation,
      }),
      getProvider: () => null,
      onEvent: () => undefined,
    })
    this.stage.onPageSnapshot = (thumb, pageIndex) => {
      const title = scene.pages[pageIndex - 1]?.title ?? ''
      appStore.set((s) => ({ pages: [...s.pages, { index: pageIndex, title, thumb }] }))
    }
    return director
  }

  private makeReplayer(record: StoryRecord): Replayer {
    return new Replayer(record, this.director, {
      onWords: (final, chunk) => appStore.set({ transcriptFinal: final, replayCaption: chunk }),
      onProgress: (i) => appStore.set({ replayPos: i }),
      onEnd: (seed) => void this.stage.finale(seed),
      onDone: () => appStore.set({ replayPlaying: false }),
    })
  }

  play(): void {
    if (!this.record) return
    this.replayer?.stop()
    this.replayer = this.makeReplayer(this.record)
    appStore.set({ replayPlaying: true })
    this.replayer.play()
  }

  pause(): void {
    this.replayer?.stop()
    appStore.set({ replayPlaying: false })
  }

  resume(): void {
    if (!this.record) return
    if (!this.replayer) this.replayer = this.makeReplayer(this.record)
    if (this.replayer.position >= this.replayer.length) this.seek(0)
    appStore.set({ replayPlaying: true })
    this.replayer.play()
  }

  /**
   * Scrub: rebuild the page instantly through event i (fresh scene, every line re-executed with
   * the stage settling at the end) and continue from there in whatever play state we were in.
   */
  seek(i: number): void {
    if (!this.record) return
    const playing = appStore.get().replayPlaying
    this.replayer?.stop()
    this.director.stop()
    this.stage.clear()
    appStore.set({ pages: [] })
    this.director = this.freshDirector()
    const events = this.record.events
    const to = Math.max(0, Math.min(events.length, i))
    const words: string[] = []
    this.stage.setInstant(true)
    for (let k = 0; k < to; k++) {
      const ev = events[k]
      if (!ev) break
      if (ev.k === 'words') words.push(ev.text)
      else if (ev.k === 'end') this.stage.finale(this.record.seed)
      else this.director.execute(ev.line)
    }
    this.stage.settle()
    this.stage.setInstant(false)
    appStore.set({
      transcriptFinal: words.join(' '),
      replayCaption: words[words.length - 1] ?? '',
      replayPos: to,
    })
    this.replayer = this.makeReplayer(this.record)
    this.replayer.seek(to)
    if (playing && to < events.length) this.replayer.play()
    else if (to >= events.length) appStore.set({ replayPlaying: false })
  }

  resize(): void {
    this.stage.resize()
  }

  destroy(): void {
    this.replayer?.stop()
    this.stage.stop()
    appStore.set({ replayPlaying: false })
  }
}
