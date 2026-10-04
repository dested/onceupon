import { requireNativeModule } from 'expo-modules-core'
import { Platform } from 'react-native'
import type { EarsNativeModule } from '../on-device-ears'

let cached: EarsNativeModule | null | undefined

/** The Whistle module (same events and calls as the SpeechAnalyzer one), or null off-iOS and in builds from before it existed. */
export function whistleEars(): EarsNativeModule | null {
  if (cached !== undefined) return cached
  if (Platform.OS !== 'ios') {
    cached = null
    return cached
  }
  try {
    cached = requireNativeModule<EarsNativeModule>('WhistleEars')
  } catch {
    cached = null
  }
  return cached
}

/** True when this build bundles the Whistle weights and the model speaks the locale's language. Never throws. */
export async function whistleAvailable(locale: string): Promise<boolean> {
  const mod = whistleEars()
  if (!mod) return false
  try {
    return await mod.isAvailable(locale)
  } catch {
    return false
  }
}
