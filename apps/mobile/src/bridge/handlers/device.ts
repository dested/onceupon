import * as Application from 'expo-application'
import * as Crypto from 'expo-crypto'
import { getStorefront } from 'expo-iap'
import { getLocales } from 'expo-localization'
import * as SecureStore from 'expo-secure-store'
import { Platform } from 'react-native'
import { type Handler } from '../host'

const INSTALL_ID_KEY = 'installId'

async function installId(): Promise<string> {
  const existing = await SecureStore.getItemAsync(INSTALL_ID_KEY)
  if (existing) return existing
  const created = Crypto.randomUUID()
  await SecureStore.setItemAsync(INSTALL_ID_KEY, created)
  return created
}

async function storefront(): Promise<string | null> {
  try {
    const code = await getStorefront()
    return code.length > 0 ? code : null
  } catch {
    return null
  }
}

function localeInfo(): { locale: string; region: string | null } {
  const [first] = getLocales()
  return { locale: first.languageTag, region: first.regionCode ?? null }
}

export const deviceInfo: Handler<'device.info'> = async (_input, ctx) => ({
  installId: await installId(),
  platform: ctx.platform,
  appVersion: Application.nativeApplicationVersion ?? '0',
  buildNumber: Application.nativeBuildVersion ?? '0',
  // expo-device is not a dependency; the coarse OS + version is enough for the studio's analytics.
  model: `${Platform.OS} ${String(Platform.Version)}`,
  storefront: await storefront(),
  online: ctx.getOnline(),
  source: ctx.getSource(),
  ...localeInfo(),
})
