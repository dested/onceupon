import { bridgeCall } from './bridge'
import { NATIVE } from './config'
import { api } from './api'
import { getKv, setKv } from '~/story/storage'
import { addMaskWords } from '~/story/clean'
import { appStore } from '~/story/store'
import type { DeviceState, Platform } from '../../packages/shared/src/api'

/**
 * The device account: an opaque token minted once at first launch and stored in kv (native storage
 * on the shell, localStorage on the web). Hosted mode only. Boot calls initDevice(); everything else
 * runs after the app has already opened, so a failure here just leaves the app offline, never stuck.
 */

const INSTALL_ID_KEY = 'onceupon.installId'
const INIT_TIMEOUT_MS = 8000

let deviceToken: string | null = null

/** The in-memory device token, or null before registration / when offline. */
export function getDeviceToken(): string | null {
  return deviceToken
}

interface InstallInfo {
  installId: string
  platform: Platform
  appVersion: string | null
  storefront: string | null
}

async function installInfo(): Promise<InstallInfo> {
  if (NATIVE) {
    const info = await bridgeCall('device.info', {})
    return {
      installId: info.installId,
      platform: info.platform,
      appVersion: info.appVersion,
      storefront: info.storefront,
    }
  }
  let installId: string | null = null
  try {
    installId = localStorage.getItem(INSTALL_ID_KEY)
  } catch {
    installId = null
  }
  if (!installId) {
    installId = crypto.randomUUID()
    try {
      localStorage.setItem(INSTALL_ID_KEY, installId)
    } catch {
      // storage blocked: a fresh install id each launch is acceptable, the server dedupes on token.
    }
  }
  return { installId, platform: 'web', appVersion: null, storefront: null }
}

async function run(): Promise<void> {
  let token = await getKv('deviceToken')
  if (!token) {
    const info = await installInfo()
    const reg = await api('device.register', info)
    token = reg.deviceToken
    await setKv('deviceToken', token)
  }
  deviceToken = token
  const [state, config, masks] = await Promise.all([
    api('device.state', {}),
    api('config', {}),
    api('mask.list', {}),
  ])
  appStore.set({
    balanceSec: state.balanceSec,
    paying: state.paying,
    shareVoice: state.shareVoice,
    deviceCode: state.code,
    lastPack: state.lastPack,
    config,
  })
  addMaskWords(masks.words)
}

/**
 * Register or restore the device, then pull state/config/masks. Any failure leaves the app offline
 * (the bookshelf and replay still work). Capped at 8 s so boot never hangs on a slow network.
 */
export async function initDevice(): Promise<void> {
  const timeout = new Promise<void>((resolve) => window.setTimeout(resolve, INIT_TIMEOUT_MS))
  await Promise.race([
    run().catch(() => {
      appStore.set({ online: false })
    }),
    timeout,
  ])
}

export async function refreshDevice(): Promise<DeviceState | null> {
  try {
    const state = await api('device.state', {})
    appStore.set({
      balanceSec: state.balanceSec,
      paying: state.paying,
      shareVoice: state.shareVoice,
      deviceCode: state.code,
      lastPack: state.lastPack,
    })
    return state
  } catch {
    return null
  }
}

export async function setShareVoice(on: boolean): Promise<void> {
  const state = await api('device.consent', { shareVoice: on })
  appStore.set({
    balanceSec: state.balanceSec,
    paying: state.paying,
    shareVoice: state.shareVoice,
    deviceCode: state.code,
    lastPack: state.lastPack,
  })
}

/** Apple AdServices attribution, once per install (native only). Best-effort; never throws. */
export async function sendAttributionOnce(): Promise<void> {
  if (!NATIVE) return
  const done = await getKv('attributionSent')
  if (done) return
  try {
    const { token } = await bridgeCall('attribution.token', {})
    if (token) await api('device.attribution', { token })
    await setKv('attributionSent', '1')
  } catch {
    // try again next launch
  }
}
