import { requireNativeModule } from 'expo-modules-core'
import { Platform } from 'react-native'

interface AppleAttributionNativeModule {
  attributionToken(): Promise<string | null>
}

let cached: AppleAttributionNativeModule | null | undefined

function nativeModule(): AppleAttributionNativeModule | null {
  if (cached !== undefined) return cached
  try {
    cached = requireNativeModule<AppleAttributionNativeModule>('AppleAttribution')
  } catch {
    cached = null
  }
  return cached
}

/** The Apple AdServices attribution token, or null off-iOS or when unavailable. Never throws. */
export async function attributionToken(): Promise<string | null> {
  if (Platform.OS !== 'ios') return null
  const module = nativeModule()
  if (!module) return null
  try {
    return await module.attributionToken()
  } catch {
    return null
  }
}
