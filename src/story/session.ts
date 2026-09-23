import { CrayonAudio } from '~/engine/audio'
import { Scene } from '~/engine/scene'
import { Stage } from '~/engine/stage'
import { Director, type DirectorEvent } from '~/llm/director'
import { makeHostedProvider, makeProvider, type LlmProvider } from '~/llm/providers'
import {
  CHROME_TRACKER,
  createRecognizer,
  DEEPGRAM_TRACKER,
  LIVE_TRACKER,
  PHRASE_TRACKER,
  speechSupported,
  TranscriptTracker,
  type Recognizer,
  type RecognizerHandlers,
  type SttTraceKind,
  type TrackerOptions,
} from '~/speech/recognition'
import { trackerOptionsFor, VOICE_HOLD_MS, VOICE_LEVEL } from '~/speech/beat-rules'
import { buildDebugReport } from './debug-report'
import { appStore, resolveStt, type SttKind } from './store'
import { createOpenAiRealtimeRecognizer, isLiveModel } from '~/speech/openai-realtime'
import { createDeepgramRecognizer } from '~/speech/deepgram'
import { currentMicStream, warmMic } from '~/speech/pcm-mic'
import {
  getStory,
  listStories,
  newStoryId,
  putVoiceClip,
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
import { HOSTED } from '~/backend/config'
import { ApiError } from '~/backend/api'
import { StoryMeter, type MeterHandlers } from '~/backend/meter'
import { VoicePlayer, VoiceRecorder } from '~/story/voice'
import { playCoachLine } from '~/tutorial/coach'
import { SLEEPY_AT_SEC } from '../../packages/shared/src/packs'
import type { EarsToken, EarsVendor, EndReason, SessionStart } from '../../packages/shared/src/api'

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

/** The meter of the live session, read lazily by the relay provider so it always has the session id. */
let activeMeter: StoryMeter | null = null
const relayProvider = makeHostedProvider(() => activeMeter?.sessionId ?? null)

function currentProvider(): LlmProvider | null {
  if (HOSTED) return relayProvider
  const { settings } = appStore.get()
  return makeProvider(settings.provider, settings.model, settings.keys)
}

/** Tracker rules for the ears the relay handed us (hosted mode; the vendor is not in settings). */
function hostedTrackerOptions(ears: EarsToken | null): TrackerOptions {
  if (!ears) return CHROME_TRACKER
  if (ears.vendor === 'openai') return isLiveModel(ears.model) ? LIVE_TRACKER : PHRASE_TRACKER
  return DEEPGRAM_TRACKER
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
  /** Hosted metering (null in bring-your-own-key builds). */
  private readonly meter: StoryMeter | null
  private readonly voice = new VoiceRecorder()
  private voiceClipIndex = 0
  /** When words last arrived; drives the silence nudge and auto-end. */
  private lastWordsAt = performance.now()
  private nudged = false
  private endReason: EndReason = 'the-end'

  constructor(canvas: HTMLCanvasElement) {
    const seed = Math.floor(Math.random() * 1e9)
    // Hosted mode may override the drawing language via server config; else the local setting.
    const dialect = appStore.get().config?.dialect ?? appStore.get().settings.dialect
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
    this.meter = HOSTED ? new StoryMeter(this.story.id, this.meterHandlers()) : null
    activeMeter = this.meter
    appStore.set({
      micSupported: speechSupported() || resolveStt(appStore.get().settings) !== 'browser',
      status: 'idle',
      ending: false,
      ended: false,
      transcriptFinal: '',
      transcriptInterim: '',
      pages: [],
      warnings: [],
      endReason: null,
      remainingSec: null,
      sleepy: false,
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
      this.lastWordsAt = performance.now()
      this.record({ k: 'words', t: this.now(), text: before })
      appStore.set((s) => ({
        transcriptFinal: s.transcriptFinal ? `${s.transcriptFinal} ${before}` : before,
      }))
      this.director.feed(before)
    }
    if (ended) this.endStory('the-end')
  }

  private meterHandlers(): MeterHandlers {
    return {
      onRemaining: (sec) => {
        const wasSleepy = appStore.get().sleepy
        const sleepy = sec <= SLEEPY_AT_SEC
        appStore.set({ remainingSec: sec, sleepy })
        if (sleepy && !wasSleepy) this.showNote('the crayon is getting sleepy…', 5000)
      },
      onExhausted: () => this.endStory('sleepy'),
      onError: (code, message) =>
        appStore.set((s) => ({ warnings: [...s.warnings.slice(-9), `meter: ${message} (${code})`] })),
    }
  }

  private showNote(text: string, ms: number): void {
    appStore.set({ note: text })
    clearTimeout(this.noteTimer)
    this.noteTimer = window.setTimeout(() => appStore.set({ note: '' }), ms)
  }

  /**
   * End the story. `the-end` records the phrase; `sleepy` (out of minutes) and `silence` (no words for
   * a long time) do not. All three record the `end` event, play the finale, then settle the meter.
   */
  private endStory(reason: EndReason = 'the-end'): void {
    if (this.ended) return
    this.ended = true
    this.stopListening()
    if (reason === 'the-end') {
      this.record({ k: 'words', t: this.now(), text: 'The End' })
      appStore.set((s) => ({
        transcriptFinal: s.transcriptFinal ? `${s.transcriptFinal} The End` : 'The End',
      }))
    }
    this.endReason = reason
    appStore.set({ ending: true })
    this.pendingFinale = true
    if (this.directorIdle) this.playFinale()
  }

  private playFinale(): void {
    if (!this.pendingFinale) return
    this.pendingFinale = false
    this.record({ k: 'end', t: this.now() })
    this.audio.pageFlip()
    void this.stage.finale(this.story.seed).then(() => {
      appStore.set({ ending: false, ended: true, endReason: this.endReason })
      this.save()
      if (this.endReason === 'sleepy')
        this.showNote('the crayon fell asleep… ask a grown-up for more minutes', 6000)
      void this.meter?.stop(this.endReason)
    })
  }

  /** Stop the voice recorder and save the finished clip beside the record. */
  private async captureVoice(): Promise<void> {
    const clip = await this.voice.stop()
    if (!clip) return
    const file = await putVoiceClip(this.story.id, ++this.voiceClipIndex, clip.blob, clip.blob.type)
    this.story.voice = {
      mime: clip.blob.type,
      clips: [...(this.story.voice?.clips ?? []), { t: clip.t, ms: clip.ms, file }],
    }
    clearTimeout(this.saveTimer)
    this.saveTimer = window.setTimeout(() => this.save(), 1500)
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

  /**
   * Typed words draw exactly like spoken ones. They never count as listening time; in hosted mode each
   * message is charged as talking time by the server from its words (a lone "The End" is free).
   */
  typeWords(text: string): void {
    void this.audio.start()
    const meter = HOSTED ? this.meter : null
    if (meter) {
      void meter
        .ensureStarted('browser')
        .then(() => {
          if (this.ended) return
          const { before } = splitTheEnd(cleanText(text))
          this.feed(text)
          if (before) void meter.typed(before)
        })
        .catch((e: unknown) => this.handleStartError(e))
      return
    }
    this.feed(text)
  }

  private sttKind: SttKind | null = null

  private recognizerHandlers(streaming: boolean): RecognizerHandlers {
    return {
      onResult: (results) => {
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
            streaming ? 800 : 120
          )
        } else appStore.set({ listening: false, micStarting: false, micLevel: 0 })
      },
      onReady: () => {
        if (this.wantListening) appStore.set({ listening: true, micStarting: false })
        this.meter?.setListening(true)
        const stream = currentMicStream()
        if (stream) this.voice.start(stream, this.now())
        this.lastWordsAt = performance.now()
        this.nudged = false
      },
      onAudio: (ms) => {
        appStore.set((s) => ({ spend: { ...s.spend, audioMs: s.spend.audioMs + ms } }))
      },
      onLevel: (level) => {
        if (level >= VOICE_LEVEL) this.lastLoudAt = performance.now()
        appStore.set({ micLevel: level })
      },
      onTrace: (kind: SttTraceKind, text: string) => {
        const t = Math.round(performance.now() - this.listenT0)
        appStore.set((s) => ({
          sttLog: [...s.sttLog.slice(-59), { id: ++traceCounter, t, kind, text }],
        }))
      },
      onError: (err) => {
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
        } else if (streaming) {
          appStore.set((s) => ({ warnings: [...s.warnings, `speech: ${err}`] }))
        }
      },
    }
  }

  /** Build (or reuse) the recognizer for `kind`, aborting the previous one if the kind changed. */
  private setRecognizer(kind: SttKind, make: () => Recognizer | null, tracker: TrackerOptions): void {
    if (this.recognizer && this.sttKind !== kind) {
      this.recognizer.abort()
      this.recognizer = null
    }
    if (this.recognizer) return
    this.recognizer = make()
    if (!this.recognizer) return
    this.tracker.configure(tracker)
    this.sttKind = kind
  }

  private handleStartError(e: unknown): void {
    if (e instanceof ApiError && e.code === 'exhausted') {
      appStore.set({ paywallOpen: true })
    } else if (e instanceof ApiError && (e.code === 'paused' || e.code === 'read_only')) {
      this.showNote('the crayon is taking a nap, try again soon', 5000)
    } else {
      const msg = e instanceof Error ? e.message : String(e)
      appStore.set((s) => ({ warnings: [...s.warnings.slice(-9), `session: ${msg}`] }))
    }
  }

  async startListening(): Promise<void> {
    void this.audio.start()
    const settings = appStore.get().settings
    if (HOSTED && this.meter) {
      let start: SessionStart
      try {
        start = await this.meter.ensureStarted(appStore.get().config?.earsVendor ?? 'browser')
      } catch (e) {
        this.handleStartError(e)
        return
      }
      const ears = start.ears
      const kind: SttKind = ears ? ears.vendor : 'browser'
      this.setRecognizer(
        kind,
        () => {
          const handlers = this.recognizerHandlers(kind !== 'browser')
          if (kind === 'openai')
            return createOpenAiRealtimeRecognizer(handlers, {
              apiKey: ears?.token ?? '',
              model: ears?.model || settings.sttModel,
              prompt: '',
              silenceMs: 350,
              maxTurnMs: 2500,
              deviceId: settings.micDeviceId,
            })
          if (kind === 'deepgram')
            return createDeepgramRecognizer(handlers, {
              auth: { kind: 'bearer', value: ears?.token ?? '' },
              model: ears?.model || settings.deepgramModel,
              deviceId: settings.micDeviceId,
            })
          return createRecognizer(handlers)
        },
        hostedTrackerOptions(ears)
      )
      if (!this.recognizer) {
        appStore.set((s) => ({ warnings: [...s.warnings, 'speech recognition needs Chrome'] }))
        return
      }
      this.beginListening()
      return
    }

    const kind = resolveStt(settings)
    this.setRecognizer(
      kind,
      () => {
        const handlers = this.recognizerHandlers(kind === 'openai' || kind === 'deepgram')
        if (kind === 'openai')
          return createOpenAiRealtimeRecognizer(handlers, {
            apiKey: settings.keys.openai,
            model: settings.sttModel,
            prompt: '',
            silenceMs: 350,
            maxTurnMs: 2500,
            deviceId: settings.micDeviceId,
          })
        if (kind === 'deepgram')
          return createDeepgramRecognizer(handlers, {
            auth: { kind: 'token', value: settings.keys.deepgram },
            model: settings.deepgramModel,
            deviceId: settings.micDeviceId,
          })
        return createRecognizer(handlers)
      },
      trackerOptionsFor(settings)
    )
    if (!this.recognizer) {
      appStore.set((s) => ({
        warnings: [
          ...s.warnings,
          'speech recognition needs Chrome, an OpenAI key, or a Deepgram key',
        ],
      }))
      return
    }
    this.beginListening()
  }

  private beginListening(): void {
    this.wantListening = true
    this.tracker.reset()
    this.listenT0 = performance.now()
    appStore.set({ micStarting: true, sttLog: [], micLevel: 0 })
    this.safeStart()
    clearInterval(this.tickTimer)
    this.tickTimer = window.setInterval(() => this.tick(), 250)
  }

  private tick(): void {
    const now = performance.now()
    // The mic was loud a moment ago: the child is still talking, hold the quiet-window release.
    this.tracker.tick(now, now - this.lastLoudAt < VOICE_HOLD_MS)
    appStore.set({ transcriptInterim: cleanText(this.tracker.interim) })
    if (!this.wantListening) return
    const cfg = appStore.get().config
    const nudgeMs = cfg?.silenceNudgeMs ?? 90000
    const endMs = cfg?.silenceEndMs ?? 210000
    const silent = now - this.lastWordsAt
    if (!this.nudged && silent > nudgeMs) {
      this.nudged = true
      this.showNote('all done? just say "The End"', 8000)
      void playCoachLine(4)
    }
    if (silent > endMs) this.endStory('silence')
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
    this.meter?.setListening(false)
    void this.captureVoice()
    appStore.set({ listening: false, micStarting: false, transcriptInterim: '' })
  }

  destroy(): void {
    exposeDebugHandle(null)
    this.stopListening()
    this.director.stop()
    this.stage.stop()
    clearTimeout(this.saveTimer)
    this.save()
    if (!this.ended) void this.meter?.stop(null)
    if (activeMeter === this.meter) activeMeter = null
  }
}

/** Plays a saved story back on its own canvas. */
export class ReplaySession {
  readonly stage: Stage
  private director: Director
  private replayer: Replayer | null = null
  private record: StoryRecord | null
  /** The child's recorded voice for this story, loaded once; null when there is none. */
  private voice: Promise<VoicePlayer | null>
  private voicePlayer: VoicePlayer | null = null
  private disposed = false
  /** Bumped by every play/pause/resume/seek so a pending async voice-load play doesn't override intent. */
  private playToken = 0

  constructor(canvas: HTMLCanvasElement, storyId: string) {
    this.record = getStory(storyId)
    const seed = this.record?.seed ?? 1
    this.stage = new Stage(canvas, { seed, audio: null })
    this.director = this.freshDirector()
    this.voice = this.record ? VoicePlayer.load(this.record) : Promise.resolve(null)
    void this.voice.then((v) => {
      this.voicePlayer = v
    })
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
    return new Replayer(
      record,
      this.director,
      {
        onWords: (final, chunk) => appStore.set({ transcriptFinal: final, replayCaption: chunk }),
        onProgress: (i) => appStore.set({ replayPos: i }),
        onEnd: (seed) => void this.stage.finale(seed),
        onDone: () => appStore.set({ replayPlaying: false }),
      },
      { voice: this.voicePlayer }
    )
  }

  play(): void {
    if (!this.record) return
    const record = this.record
    const token = ++this.playToken
    this.replayer?.stop()
    appStore.set({ replayPlaying: true })
    // Wait for the recorded voice before the first play so it is heard; guard unmount / pause races.
    void this.voice.then((voice) => {
      if (this.disposed || token !== this.playToken) return
      this.voicePlayer = voice
      this.replayer = this.makeReplayer(record)
      this.replayer.play()
    })
  }

  pause(): void {
    this.playToken++
    this.replayer?.stop()
    appStore.set({ replayPlaying: false })
  }

  resume(): void {
    if (!this.record) return
    this.playToken++
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
    this.playToken++
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
    this.disposed = true
    this.playToken++
    this.replayer?.stop()
    this.stage.stop()
    void this.voice.then((v) => v?.dispose())
    appStore.set({ replayPlaying: false })
  }
}
