import { type SpeechEngine } from '../../../../../packages/shared/src/bridge'

// Which on-device engines the shell offers. Pure, so bun test covers it; speech.ts gathers the probes.
// An engine is listed only when it can actually start here: the Simulator, for one, reports Apple's
// recognizers as present while every start fails.

export interface EngineProbe {
  /** SpeechAnalyzer: transcriber available on this device and the locale's model installed or installable. */
  analyzer: boolean
  /** On-device SFSpeechRecognizer usable for the locale (see sfspeechUsable). */
  sfspeech: boolean
  /** Whistle weights bundled and the locale's language spoken. */
  whistle: boolean
}

export interface SfSpeechProbe {
  /** The shell's per-locale check (recognizer for the locale, isAvailable, on-device); null on builds without it. */
  native: boolean | null
  /** expo-speech-recognition, default locale only: a recognizer exists and is available. */
  recognitionAvailable: boolean
  /** expo-speech-recognition, default locale only: it can recognize on device. */
  onDeviceSupported: boolean
  /** Whether the caller needs on-device recognition. */
  onDevice: boolean
}

/** The per-locale native answer when there is one, else the default-locale checks. */
export function sfspeechUsable(p: SfSpeechProbe): boolean {
  if (p.native !== null) return p.native
  return p.recognitionAvailable && (!p.onDevice || p.onDeviceSupported)
}

/** Every engine that can run, in the shell's order of preference. */
export function listEngines(p: EngineProbe): SpeechEngine[] {
  const out: SpeechEngine[] = []
  if (p.analyzer) out.push('analyzer')
  if (p.sfspeech) out.push('sfspeech')
  if (p.whistle) out.push('whistle')
  return out
}

/** The asked-for engine when it can run, else the shell's pick (never whistle by itself). */
export function pickEngine(engines: SpeechEngine[], want?: SpeechEngine): SpeechEngine | null {
  if (want && engines.includes(want)) return want
  return engines.find((e) => e !== 'whistle') ?? null
}
