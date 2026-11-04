import { NativeModule, requireNativeModule } from 'expo-modules-core'
import { Platform } from 'react-native'

export interface EarsResultEvent {
  /** Every finalized segment so far, in order. */
  finals: string[]
  /** The live, still-changing tail ('' between phrases). */
  volatile: string
}

type EarsEvents = {
  onReady: (e: Record<string, never>) => void
  onResult: (e: EarsResultEvent) => void
  onLevel: (e: { level: number }) => void
  onError: (e: { code: string; message: string }) => void
  onEnd: (e: Record<string, never>) => void
}

/** The native shape both ears modules share (modules/whistle-ears speaks it too). */
export declare class EarsNativeModule extends NativeModule<EarsEvents> {
  isAvailable(locale: string): Promise<boolean>
  start(locale: string, recordPath: string | null): Promise<boolean>
  stop(): Promise<{ uri: string; ms: number } | null>
}

declare class OnDeviceEarsNative extends EarsNativeModule {
  /** Downloads and installs the locale's model if missing; no prompt, no mic. False when it cannot. */
  prepare(locale: string): Promise<boolean>
  /** SFSpeechRecognizer for this locale exists, is available, and (with onDevice) runs on device. */
  sfspeechAvailable(locale: string, onDevice: boolean): Promise<boolean>
}

let cached: OnDeviceEarsNative | null | undefined

/** The SpeechAnalyzer module, or null off-iOS and in builds from before it existed. */
export function onDeviceEars(): OnDeviceEarsNative | null {
  if (cached !== undefined) return cached
  if (Platform.OS !== 'ios') {
    cached = null
    return cached
  }
  try {
    cached = requireNativeModule<OnDeviceEarsNative>('OnDeviceEars')
  } catch {
    cached = null
  }
  return cached
}

/** True when SpeechAnalyzer can really run here (iOS 26+, transcriber available on this device, the locale model installed or installable). Never throws. */
export async function analyzerAvailable(locale: string): Promise<boolean> {
  const mod = onDeviceEars()
  if (!mod) return false
  try {
    return await mod.isAvailable(locale)
  } catch {
    return false
  }
}

/**
 * Gets the analyzer's language model onto the device without prompting or listening. False when the
 * locale has no model, the download fails (offline) or the build predates `prepare`. Never throws.
 */
export async function analyzerPrepare(locale: string): Promise<boolean> {
  const mod = onDeviceEars()
  if (!mod) return false
  try {
    return await mod.prepare(locale)
  } catch {
    return false
  }
}

/**
 * The native per-locale SFSpeechRecognizer check, or null when this build predates it (the caller falls
 * back to expo-speech-recognition's default-locale checks). Never throws.
 */
export async function sfspeechNativeAvailable(locale: string, onDevice: boolean): Promise<boolean | null> {
  const mod = onDeviceEars()
  if (!mod) return null
  try {
    return await mod.sfspeechAvailable(locale, onDevice)
  } catch {
    return null
  }
}
