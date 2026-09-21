import { useSyncExternalStore } from 'react'
import { z } from 'zod'
import { DEFAULT_MODEL, isProvider, type Provider } from '~/llm/models'
import { isDialectId, type DialectId } from '~/llm/dialect'
import type { SttTraceKind } from '~/speech/recognition'
import type { ClipResult } from '~/speech/clip-lab'
import type { ApiKeys } from '~/llm/providers'
import type { CallStat, DirectorStatus } from '~/llm/director'
import type { StoryMeta } from './storage'

export const STT_MODES = ['auto', 'browser', 'openai'] as const
export type SttMode = (typeof STT_MODES)[number]

export interface Settings {
  provider: Provider
  model: string
  /** Which drawing language the model speaks; fixed per story. */
  dialect: DialectId
  keys: ApiKeys
  sound: boolean
  /** Kid-safe moderation: safety section in the prompt + bad-word masking. Off for testing. */
  moderation: boolean
  /** auto = OpenAI Realtime when an OpenAI key exists, else Chrome's recognizer. */
  stt: SttMode
  sttModel: string
  /** USD per minute of audio sent to the transcriber; an estimate the user can edit. */
  sttRatePerMin: number
  /** Microphone device id (OpenAI ears only; Chrome's recognizer always uses the default). */
  micDeviceId: string
}

export const DEFAULT_STT_MODEL = 'gpt-live-transcribe'
export const DEFAULT_STT_RATE = 0.006

export function resolveStt(s: Settings): 'browser' | 'openai' {
  if (s.stt === 'auto') return s.keys.openai ? 'openai' : 'browser'
  return s.stt
}

export interface PageThumb {
  index: number
  title: string
  thumb: string
}

export interface LineLog {
  id: number
  line: string
  ok: boolean
  error: string | null
}

export interface AppState {
  screen: 'story' | 'shelf' | 'replay'
  micSupported: boolean
  listening: boolean
  /** Mic clicked, session not yet confirmed ready. */
  micStarting: boolean
  status: DirectorStatus
  /** Words of the model call in flight (being drawn) and words heard but not sent yet. */
  drawingWords: string
  queuedWords: string
  transcriptFinal: string
  transcriptInterim: string
  settings: Settings
  settingsOpen: boolean
  debug: boolean
  calls: CallStat[]
  lines: LineLog[]
  warnings: string[]
  /** Gentle one-liner near the mic ("the crayon skipped that part"). */
  note: string
  pages: PageThumb[]
  stories: StoryMeta[]
  replayId: string | null
  replayPlaying: boolean
  /** Bumped to remount the story screen with a fresh session. */
  storyNonce: number
  spend: Spend
  /** The words chunk most recently played back, for the replay caption. */
  replayCaption: string
  /** Scrubber: next event index and total events of the story being replayed. */
  replayPos: number
  replayLen: number
  /** Voice lab: mic loudness 0..1, the transcriber's recent events, and clip comparison results. */
  micLevel: number
  sttLog: SttTrace[]
  clipResults: ClipResult[]
  clipBusy: boolean
}

export interface SttTrace {
  id: number
  /** ms since listening started */
  t: number
  kind: SttTraceKind
  text: string
}

export interface Spend {
  calls: number
  unpriced: number
  input: number
  cached: number
  output: number
  usd: number
  firstTokenTotalMs: number
  firstTokenSamples: number
  /** Audio sent to a paid transcriber. */
  audioMs: number
}

export const EMPTY_SPEND: Spend = {
  calls: 0,
  unpriced: 0,
  input: 0,
  cached: 0,
  output: 0,
  usd: 0,
  firstTokenTotalMs: 0,
  firstTokenSamples: 0,
  audioMs: 0,
}

const envSchema = z.object({
  VITE_ANTHROPIC_API_KEY: z.string().optional(),
  VITE_OPENROUTER_API_KEY: z.string().optional(),
  VITE_OPENAI_API_KEY: z.string().optional(),
})

const settingsSchema = z.object({
  provider: z.string(),
  model: z.string(),
  dialect: z.string().optional(),
  keys: z.object({ anthropic: z.string(), openrouter: z.string(), openai: z.string() }),
  sound: z.boolean(),
  moderation: z.boolean().optional(),
  stt: z.string().optional(),
  sttModel: z.string().optional(),
  sttRatePerMin: z.number().optional(),
  micDeviceId: z.string().optional(),
})

const SETTINGS_KEY = 'onceupon.settings'

function loadSettings(): Settings {
  const env = envSchema.safeParse(import.meta.env)
  const envKeys: ApiKeys = {
    anthropic: env.success ? (env.data.VITE_ANTHROPIC_API_KEY ?? '') : '',
    openrouter: env.success ? (env.data.VITE_OPENROUTER_API_KEY ?? '') : '',
    openai: env.success ? (env.data.VITE_OPENAI_API_KEY ?? '') : '',
  }
  const base: Settings = {
    provider: DEFAULT_MODEL.provider,
    model: DEFAULT_MODEL.id,
    dialect: 'lines',
    keys: envKeys,
    sound: true,
    moderation: true,
    stt: 'auto',
    sttModel: DEFAULT_STT_MODEL,
    sttRatePerMin: DEFAULT_STT_RATE,
    micDeviceId: '',
  }
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    if (!raw) return base
    const parsed = settingsSchema.safeParse(JSON.parse(raw))
    if (!parsed.success) return base
    const d = parsed.data
    return {
      provider: isProvider(d.provider) ? d.provider : base.provider,
      model: d.model || base.model,
      dialect: d.dialect && isDialectId(d.dialect) ? d.dialect : 'lines',
      keys: {
        anthropic: d.keys.anthropic || envKeys.anthropic,
        openrouter: d.keys.openrouter || envKeys.openrouter,
        openai: d.keys.openai || envKeys.openai,
      },
      sound: d.sound,
      moderation: d.moderation ?? true,
      stt: d.stt === 'browser' || d.stt === 'openai' ? d.stt : 'auto',
      sttModel: d.sttModel && d.sttModel !== 'gpt-4o-transcribe' ? d.sttModel : DEFAULT_STT_MODEL,
      sttRatePerMin: d.sttRatePerMin ?? DEFAULT_STT_RATE,
      micDeviceId: d.micDeviceId ?? '',
    }
  } catch {
    return base
  }
}

export function persistSettings(s: Settings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s))
  } catch {
    // storage full or blocked; settings just will not survive reload
  }
}

class Store<T extends object> {
  private listeners = new Set<() => void>()
  constructor(private state: T) {}
  get = (): T => this.state
  set = (patch: Partial<T> | ((s: T) => Partial<T>)): void => {
    const p = typeof patch === 'function' ? patch(this.state) : patch
    this.state = { ...this.state, ...p }
    for (const l of this.listeners) l()
  }
  subscribe = (l: () => void): (() => void) => {
    this.listeners.add(l)
    return () => this.listeners.delete(l)
  }
}

export const appStore = new Store<AppState>({
  screen: 'story',
  micSupported: false,
  listening: false,
  micStarting: false,
  status: 'idle',
  drawingWords: '',
  queuedWords: '',
  transcriptFinal: '',
  transcriptInterim: '',
  settings: loadSettings(),
  settingsOpen: false,
  debug: false,
  calls: [],
  lines: [],
  warnings: [],
  note: '',
  pages: [],
  stories: [],
  replayId: null,
  replayPlaying: false,
  storyNonce: 0,
  spend: EMPTY_SPEND,
  replayCaption: '',
  replayPos: 0,
  replayLen: 0,
  micLevel: 0,
  sttLog: [],
  clipResults: [],
  clipBusy: false,
})

export function useApp<S>(selector: (s: AppState) => S): S {
  return useSyncExternalStore(appStore.subscribe, () => selector(appStore.get()))
}
