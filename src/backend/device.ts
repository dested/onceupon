import { bridgeCall } from './bridge'
import { NATIVE } from './config'
import { api, ApiError } from './api'
import { getKv, setKv } from '~/story/storage'
import { addMaskWords } from '~/story/clean'
import { appStore } from '~/story/store'
import { reconcileConsent } from './consent'
import { finishPendingPurchases } from './purchases'
import type { DeviceState, Platform } from '../../packages/shared/src/api'

/**
 * The device account: an opaque token minted once at first launch and stored in kv (native storage
 * on the shell, localStorage on the web). Hosted mode only. Boot starts initDevice() without waiting
 * for it (first paint never waits on the network); api() waits on deviceTokenSettled() so no call
 * goes out tokenless while registration is in flight. A failure retries with backoff (1 s, 3 s, 10 s,
 * then every 30 s): a network failure reads as offline, anything else as "can't reach the crayon".
 */

const INSTALL_ID_KEY = 'onceupon.installId'
const INIT_TIMEOUT_MS = 8000
// A cold-booted phone can take ~15 s to get a network: keep the early retries close together, and
// retryDeviceNow() runs one at once when the network or the app comes back.
const RETRY_DELAYS_MS = [1000, 2000, 4000, 8000]
const RETRY_EVERY_MS = 10_000

let deviceToken: string | null = null
let tokenStep: Promise<void> = Promise.resolve()

/** Resolves once the device token is known or registration gave up (capped by INIT_TIMEOUT_MS). */
export function deviceTokenSettled(): Promise<void> {
  return tokenStep
}

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

async function ensureToken(): Promise<void> {
  let token = await getKv('deviceToken')
  if (!token) {
    const info = await installInfo()
    const reg = await api('device.register', info)
    token = reg.deviceToken
    await setKv('deviceToken', token)
  }
  deviceToken = token
}

/** Copy a DeviceState from the server into the store (and reconcile the AI consent with it). */
function applyDeviceState(state: DeviceState): void {
  appStore.set({
    balanceSec: state.balanceSec,
    balanceAt: Date.now(),
    paying: state.paying,
    comped: state.comped,
    shareVoice: state.shareVoice,
    deviceCode: state.code,
    lastPack: state.lastPack,
  })
  void reconcileConsent(state.aiConsent)
}

/** Pull state, config and the mask list once the token is known. */
async function pull(): Promise<void> {
  if (deviceToken === null) throw new Error('no device token')
  const [state, config, masks] = await Promise.all([
    api('device.state', {}),
    api('config', {}),
    api('mask.list', {}),
  ])
  applyDeviceState(state)
  appStore.set({ config })
  addMaskWords(masks.words)
}

let retryTimer = 0
let pendingChecked = false

function connected(): void {
  window.clearTimeout(retryTimer)
  appStore.set({ online: true, deviceTrouble: false })
  // Once per launch, with a device token: credit and finish any purchase a crash left open.
  if (!pendingChecked) {
    pendingChecked = true
    void finishPendingPurchases()
  }
}

/**
 * The device is offline → the usual offline note. Online but the server (or the shell) failed, the
 * server unreachable included → "can't reach the crayon".
 */
function failed(e: unknown): void {
  const offline = !navigator.onLine || (e instanceof ApiError && e.status === 0 && !appStore.get().online)
  appStore.set(offline ? { online: false } : { deviceTrouble: true })
}

/** One attempt at a time: two overlapping registrations would make two devices. */
let attemptInFlight = false

function scheduleRetry(attempt: number): void {
  window.clearTimeout(retryTimer)
  retryTimer = window.setTimeout(
    () => {
      if (attemptInFlight) return
      attemptInFlight = true
      ensureToken()
        .then(pull)
        .then(connected, (e: unknown) => {
          failed(e)
          scheduleRetry(attempt + 1)
        })
        .finally(() => {
          attemptInFlight = false
        })
    },
    RETRY_DELAYS_MS[attempt] ?? RETRY_EVERY_MS
  )
}

/** Retry now if the last attempt failed (network back, app foregrounded). No-op when connected. */
export function retryDeviceNow(): void {
  const s = appStore.get()
  if (!s.hosted || (s.online && !s.deviceTrouble)) return
  scheduleRetry(0)
}

/**
 * Register or restore the device, then pull state/config/masks. A failure keeps retrying in the
 * background (the bookshelf and replay still work meanwhile). Capped at 8 s so boot never hangs on a
 * slow network.
 */
export async function initDevice(): Promise<void> {
  const timeout = new Promise<void>((resolve) => window.setTimeout(resolve, INIT_TIMEOUT_MS))
  attemptInFlight = true
  const token = ensureToken()
  tokenStep = Promise.race([token.catch(() => undefined), timeout])
  const full = token.then(pull)
  full
    .then(connected, (e: unknown) => {
      failed(e)
      scheduleRetry(0)
    })
    .finally(() => {
      attemptInFlight = false
    })
  await Promise.race([full.catch(() => undefined), timeout])
}

export async function refreshDevice(): Promise<DeviceState | null> {
  try {
    const state = await api('device.state', {})
    applyDeviceState(state)
    return state
  } catch {
    return null
  }
}

export async function setShareVoice(on: boolean): Promise<void> {
  const state = await api('device.consent', { shareVoice: on })
  applyDeviceState(state)
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
