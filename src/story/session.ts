import { CrayonAudio } from '~/engine/audio'
import { Scene } from '~/engine/scene'
import { Stage } from '~/engine/stage'
import { Director, type DirectorEvent } from '~/llm/director'
import { makeProvider, type LlmProvider } from '~/llm/providers'
import { CHROME_TRACKER, createRecognizer, LIVE_TRACKER, PHRASE_TRACKER, speechSupported, TranscriptTracker, type Recognizer, type RecResult } from '~/speech/recognition'
import { appStore, resolveStt } from './store'
import { createOpenAiRealtimeRecognizer, isLiveModel, warmMic } from '~/speech/openai-realtime'
import { getStory, listStories, newStoryId, saveStory, titleFromWords, type StoryEvent, type StoryRecord } from './storage'
import { Replayer } from './replay'
import { exposeDebugHandle } from '~/debug-handle'
import { isDialectId, makeDialect } from '~/llm/dialect'
import { cleanText } from './clean'

let lineCounter = 0

/** Stands in for words the model skipped, so a replay is honest about the gap. */
export const SKIPPED_MARK = '(the crayon skipped a part)'

function pushDirectorEvent(e: DirectorEvent): void {
  switch (e.k) {
    case 'status':
      appStore.set({ status: e.status, drawingWords: e.drawing, queuedWords: e.queued })
      break
    case 'line':
      appStore.set((s) => ({
        lines: [...s.lines.slice(-199), { id: ++lineCounter, line: e.line, ok: e.ok, error: e.error }],
      }))
      break
    case 'call':
      appStore.set((s) => {
        const others = s.calls.filter((c) => c.id !== e.stat.id)
        const st = e.stat
        // The completion event is the one with doneMs set; count spend once, there.
        const spend =
          st.doneMs === null
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
  private saveTimer = 0
  private noteTimer = 0
  private wantListening = false
  private story: StoryRecord
  private t0 = performance.now()
  private covers: string[] = []

  constructor(canvas: HTMLCanvasElement) {
    const seed = Math.floor(Math.random() * 1e9)
    const dialect = appStore.get().settings.dialect
    this.story = { id: newStoryId(), title: '', createdAt: Date.now(), updatedAt: Date.now(), seed, cover: null, dialect, events: [] }
    this.stage = new Stage(canvas, { seed, audio: this.audio })
    this.stage.onPageSnapshot = (thumb, pageIndex) => {
      const title = this.scene.pages[pageIndex - 1]?.title ?? ''
      appStore.set((s) => ({ pages: [...s.pages, { index: pageIndex, title, thumb }] }))
      this.covers.push(thumb)
    }
    this.director = new Director({
      scene: this.scene,
      stage: this.stage,
      dialect: makeDialect(dialect, this.scene),
      getProvider: currentProvider,
      onEvent: (e) => {
        pushDirectorEvent(e)
        if (e.k === 'line' && e.ok && e.line !== 'skip') this.record({ k: 'cmd', t: this.now(), line: e.line })
        if (e.k === 'skip') this.skip(e.words)
      },
    })
    this.tracker = new TranscriptTracker((words) => this.feed(words), CHROME_TRACKER)
    appStore.set({ micSupported: speechSupported() || resolveStt(appStore.get().settings) === 'openai', status: 'idle', transcriptFinal: '', transcriptInterim: '', pages: [], warnings: [] })
    this.stage.start()
    this.audio.setEnabled(appStore.get().settings.sound)
    exposeDebugHandle({ scene: this.scene, stage: this.stage, director: this.director })
    if (resolveStt(appStore.get().settings) === 'openai') void warmMic()
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
      transcriptFinal: events.filter((e) => e.k === 'words').map((e) => (e.k === 'words' ? e.text : '')).join(' '),
      note: 'the crayon skipped that part',
    })
    clearTimeout(this.noteTimer)
    this.noteTimer = window.setTimeout(() => appStore.set({ note: '' }), 4000)
  }

  private feed(raw: string): void {
    const words = cleanText(raw)
    this.record({ k: 'words', t: this.now(), text: words })
    appStore.set((s) => ({ transcriptFinal: s.transcriptFinal ? `${s.transcriptFinal} ${words}` : words }))
    this.director.feed(words)
  }

  save(): void {
    if (this.story.events.length === 0) return
    const words = this.story.events
      .filter((e) => e.k === 'words')
      .map((e) => (e.k === 'words' ? e.text : ''))
      .filter((t) => t !== SKIPPED_MARK)
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

  private sttKind: 'browser' | 'openai' | null = null

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
            window.setTimeout(() => {
              if (this.wantListening) this.safeStart()
            }, kind === 'openai' ? 800 : 120)
          } else appStore.set({ listening: false, micStarting: false })
        },
        onReady: () => {
          if (this.wantListening) appStore.set({ listening: true, micStarting: false })
        },
        onAudio: (ms: number) => {
          appStore.set((s) => ({ spend: { ...s.spend, audioMs: s.spend.audioMs + ms } }))
        },
        onError: (err: string) => {
          if (err === 'not-allowed' || err === 'service-not-allowed' || /permission|NotAllowed/i.test(err)) {
            this.wantListening = false
            appStore.set((s) => ({ listening: false, warnings: [...s.warnings, 'microphone permission denied'] }))
          } else if (kind === 'openai') {
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
            })
          : createRecognizer(handlers)
      this.tracker.configure(kind === 'openai' ? (isLiveModel(settings.sttModel) ? LIVE_TRACKER : PHRASE_TRACKER) : CHROME_TRACKER)
      this.sttKind = kind
    }
    if (!this.recognizer) {
      appStore.set((s) => ({ warnings: [...s.warnings, 'speech recognition needs Chrome or an OpenAI key'] }))
      return
    }
    this.wantListening = true
    this.tracker.reset()
    appStore.set({ micStarting: true })
    this.safeStart()
    clearInterval(this.tickTimer)
    this.tickTimer = window.setInterval(() => {
      this.tracker.tick(performance.now())
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
    const scene = new Scene()
    const dialectId = this.record?.dialect
    this.director = new Director({
      scene,
      stage: this.stage,
      dialect: makeDialect(dialectId && isDialectId(dialectId) ? dialectId : 'lines', scene),
      getProvider: () => null,
      onEvent: () => undefined,
    })
    this.stage.start()
    appStore.set({ transcriptFinal: '', transcriptInterim: '', pages: [], replayCaption: '' })
    this.stage.onPageSnapshot = (thumb, pageIndex) => {
      const title = scene.pages[pageIndex - 1]?.title ?? ''
      appStore.set((s) => ({ pages: [...s.pages, { index: pageIndex, title, thumb }] }))
    }
  }

  play(): void {
    if (!this.record) return
    this.replayer?.stop()
    this.replayer = new Replayer(this.record, this.director, {
      onWords: (final, chunk) => appStore.set({ transcriptFinal: final, replayCaption: chunk }),
      onProgress: () => undefined,
      onDone: () => appStore.set({ replayPlaying: false }),
    })
    appStore.set({ replayPlaying: true })
    this.replayer.play()
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
