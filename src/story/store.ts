import { useSyncExternalStore } from 'react'
import { z } from 'zod'
import { DEFAULT_MODEL, isProvider, type Provider } from '~/llm/models'
import type { ApiKeys } from '~/llm/providers'
import type { CallStat, DirectorStatus } from '~/llm/director'
import type { StoryMeta } from './storage'

export const STT_MODES = ['auto', 'browser', 'openai'] as const
export type SttMode = (typeof STT_MODES)[number]

export interface Settings {
  provider: Provider
  model: string
  keys: ApiKeys
  sound: boolean
  /** auto = OpenAI Realtime when an OpenAI key exists, else Chrome's recognizer. */
  stt: SttMode
  sttModel: string
  /** USD per minute of audio sent to the transcriber; an estimate the user can edit. */
  sttRatePerMin: number
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
  keys: z.object({ anthropic: z.string(), openrouter: z.string(), openai: z.string() }),
  sound: z.boolean(),
  stt: z.string().optional(),
  sttModel: z.string().optional(),
  sttRatePerMin: z.number().optional(),
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
    keys: envKeys,
    sound: true,
    stt: 'auto',
    sttModel: DEFAULT_STT_MODEL,
    sttRatePerMin: DEFAULT_STT_RATE,
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
      keys: {
        anthropic: d.keys.anthropic || envKeys.anthropic,
        openrouter: d.keys.openrouter || envKeys.openrouter,
        openai: d.keys.openai || envKeys.openai,
      },
      sound: d.sound,
      stt: d.stt === 'browser' || d.stt === 'openai' ? d.stt : 'auto',
      sttModel: d.sttModel && d.sttModel !== 'gpt-4o-transcribe' ? d.sttModel : DEFAULT_STT_MODEL,
      sttRatePerMin: d.sttRatePerMin ?? DEFAULT_STT_RATE,
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
})

export function useApp<S>(selector: (s: AppState) => S): S {
  return useSyncExternalStore(appStore.subscribe, () => selector(appStore.get()))
}
