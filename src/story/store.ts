import { useSyncExternalStore } from 'react'
import { z } from 'zod'
import { DEFAULT_MODEL, isProvider, type Provider } from '~/llm/models'
import { isDialectId, type DialectId } from '~/llm/dialect'
import type { SttTraceKind } from '~/speech/recognition'
import type { ClipResult } from '~/speech/clip-lab'
import type { ApiKeys } from '~/llm/providers'
import type { CallStat, DirectorStatus } from '~/llm/director'
import type { StoryMeta } from './storage'
import { HOSTED, NATIVE } from '~/backend/config'
import type { ClientConfig, EndReason } from '../../packages/shared/src/api'
import type { PackId } from '../../packages/shared/src/packs'

// Re-exported so UI code can import these hosted-mode types straight from the store.
export type { ClientConfig, EndReason, PackId }

export const STT_MODES = ['auto', 'browser', 'openai', 'deepgram'] as const
export type SttMode = (typeof STT_MODES)[number]

export type SttKind = 'browser' | 'openai' | 'deepgram'

export interface Settings {
  provider: Provider
  model: string
  /** Which drawing language the model speaks; fixed per story. */
  dialect: DialectId
  keys: ApiKeys
  sound: boolean
  /** Kid-safe moderation: safety section in the prompt + bad-word masking. Off for testing. */
  moderation: boolean
  /** auto = OpenAI (key), else Deepgram (key), else Chrome's recognizer. */
  stt: SttMode
  /** OpenAI STT model (OpenAI ears only). */
  sttModel: string
  /** Deepgram STT model (Deepgram ears only). */
  deepgramModel: string
  /** USD per minute of audio; null = the resolved vendor's default (see sttRateFor). */
  sttRateOverride: number | null
  /** Microphone device id (OpenAI or Deepgram ears; Chrome's recognizer always uses the default). */
  micDeviceId: string
}

export const DEFAULT_STT_MODEL = 'gpt-live-transcribe'
export const DEFAULT_DEEPGRAM_MODEL = 'nova-3'

export function resolveStt(s: Settings): SttKind {
  if (s.stt === 'auto') return s.keys.openai ? 'openai' : s.keys.deepgram ? 'deepgram' : 'browser'
  return s.stt
}

/** Vendor list price per minute of audio, by resolved ears and model. */
export function sttRateFor(kind: SttKind, model: string): number {
  if (kind === 'browser') return 0
  if (kind === 'openai') return /live/.test(model) ? 0.017 : 0.006
  return 0.0077 // deepgram nova-3 streaming, list
}

/** The rate the spend chip uses: the user's override if set, else the resolved vendor default. */
export function effectiveSttRate(s: Settings): number {
  if (s.sttRateOverride !== null) return s.sttRateOverride
  const kind = resolveStt(s)
  return sttRateFor(kind, kind === 'deepgram' ? s.deepgramModel : s.sttModel)
}

export interface PageThumb {
  index: number
  title: string
  thumb: string
}

export interface LineLog {
  id: number
  /** `performance.now()` when the line landed. */
  t: number
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
  /** The child said "The End": the finale is drawing (`ending`), then the closing card shows (`ended`). */
  ending: boolean
  ended: boolean
  /** Words of the model call in flight (being drawn) and words heard but not sent yet. */
  drawingWords: string
  queuedWords: string
  transcriptFinal: string
  transcriptInterim: string
  settings: Settings
  settingsOpen: boolean
  /** The "bring your own key" gate was satisfied or skipped this session; don't nag again. */
  keyGateDismissed: boolean
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
  // --- Hosted mode (all inert without VITE_HOSTED) ---
  /** Build flag: the studio talks to the server relay/meter instead of a browser-direct key. */
  hosted: boolean
  /** Running inside the native shell (the bridge is present). */
  native: boolean
  /** Network reachable (navigator.onLine + bridge net events). */
  online: boolean
  /** Seconds of mic time on the device account. */
  balanceSec: number
  /** Seconds left in the current story session; null until a session starts. */
  remainingSec: number | null
  /** Has ever bought a pack or redeemed a gift (unlocks share-with-voice). */
  paying: boolean
  /** Parent turned on "share with voice". */
  shareVoice: boolean
  /** 8-char device code shown to the parent for the web shop / support. */
  deviceCode: string
  /** The pack most recently bought, for the paywall's default. */
  lastPack: PackId | null
  /** Server config (model, ears vendor, urls, silence timings); null until device init or offline. */
  config: ClientConfig | null
  /** How the last story ended, once the finale finished. */
  endReason: EndReason | null
  /** The crayon is running low (remaining <= SLEEPY_AT_SEC). */
  sleepy: boolean
  paywallOpen: boolean
  parentOpen: boolean
  shareOpen: boolean
  tutorialOpen: boolean
  /** Bumped to ask the UI to run the parent gate (a math challenge before parent-only actions). */
  gateRequest: number
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
  VITE_DEEPGRAM_API_KEY: z.string().optional(),
})

const settingsSchema = z.object({
  provider: z.string(),
  model: z.string(),
  dialect: z.string().optional(),
  // deepgram optional so settings stored before it existed still parse.
  keys: z.object({
    anthropic: z.string(),
    openrouter: z.string(),
    openai: z.string(),
    deepgram: z.string().optional(),
  }),
  sound: z.boolean(),
  moderation: z.boolean().optional(),
  stt: z.string().optional(),
  sttModel: z.string().optional(),
  deepgramModel: z.string().optional(),
  sttRatePerMin: z.number().optional(),
  sttRateOverride: z.number().nullable().optional(),
  micDeviceId: z.string().optional(),
})

const SETTINGS_KEY = 'onceupon.settings'

function loadSettings(): Settings {
  const env = envSchema.safeParse(import.meta.env)
  const envKeys: ApiKeys = {
    anthropic: env.success ? (env.data.VITE_ANTHROPIC_API_KEY ?? '') : '',
    openrouter: env.success ? (env.data.VITE_OPENROUTER_API_KEY ?? '') : '',
    openai: env.success ? (env.data.VITE_OPENAI_API_KEY ?? '') : '',
    deepgram: env.success ? (env.data.VITE_DEEPGRAM_API_KEY ?? '') : '',
  }
  const base: Settings = {
    provider: DEFAULT_MODEL.provider,
    model: DEFAULT_MODEL.id,
    dialect: 'ops',
    keys: envKeys,
    sound: true,
    moderation: true,
    stt: 'auto',
    sttModel: DEFAULT_STT_MODEL,
    deepgramModel: DEFAULT_DEEPGRAM_MODEL,
    sttRateOverride: null,
    micDeviceId: '',
  }
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    if (!raw) return base
    const parsed = settingsSchema.safeParse(JSON.parse(raw))
    if (!parsed.success) return base
    const d = parsed.data
    // Rate migration: prefer a stored override; else the old flat rate, where the old default 0.006
    // means "no override" and any other saved value becomes the explicit override.
    const sttRateOverride =
      d.sttRateOverride !== undefined
        ? d.sttRateOverride
        : d.sttRatePerMin === undefined
          ? null
          : d.sttRatePerMin === 0.006
            ? null
            : d.sttRatePerMin
    return {
      provider: isProvider(d.provider) ? d.provider : base.provider,
      model: d.model || base.model,
      dialect: d.dialect && isDialectId(d.dialect) ? d.dialect : 'ops',
      keys: {
        anthropic: d.keys.anthropic || envKeys.anthropic,
        openrouter: d.keys.openrouter || envKeys.openrouter,
        openai: d.keys.openai || envKeys.openai,
        deepgram: d.keys.deepgram || envKeys.deepgram,
      },
      sound: d.sound,
      // Hosted mode always moderates; the toggle is a dev-only affordance in BYO builds.
      moderation: HOSTED ? true : (d.moderation ?? true),
      stt: d.stt === 'browser' || d.stt === 'openai' || d.stt === 'deepgram' ? d.stt : 'auto',
      sttModel: d.sttModel && d.sttModel !== 'gpt-4o-transcribe' ? d.sttModel : DEFAULT_STT_MODEL,
      deepgramModel: d.deepgramModel || DEFAULT_DEEPGRAM_MODEL,
      sttRateOverride,
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
  ending: false,
  ended: false,
  drawingWords: '',
  queuedWords: '',
  transcriptFinal: '',
  transcriptInterim: '',
  settings: loadSettings(),
  settingsOpen: false,
  keyGateDismissed: false,
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
  hosted: HOSTED,
  native: NATIVE,
  online: typeof navigator !== 'undefined' ? navigator.onLine : true,
  balanceSec: 0,
  remainingSec: null,
  paying: false,
  shareVoice: false,
  deviceCode: '',
  lastPack: null,
  config: null,
  endReason: null,
  sleepy: false,
  paywallOpen: false,
  parentOpen: false,
  shareOpen: false,
  tutorialOpen: false,
  gateRequest: 0,
})

export function useApp<S>(selector: (s: AppState) => S): S {
  return useSyncExternalStore(appStore.subscribe, () => selector(appStore.get()))
}
