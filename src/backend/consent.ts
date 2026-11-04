import { z } from 'zod'
import { KV_KEYS } from '../../packages/shared/src/bridge'
import { api } from './api'
import { bridgeCall } from './bridge'
import { NATIVE } from './config'
import { getKv, setKv } from '~/story/storage'
import { appStore } from '~/story/store'
import { gate } from '~/ui/hosted'

/**
 * The grown-up's one-time "yes" before story words go to our server and on to Claude (Kids Category,
 * 5.1.2(i)). Flow on the first mic tap or typed story: parental gate → consent card → (mic prompt).
 * kv `aiConsent` = `{"v":1,"at":"<iso>"}` remembers it on the device; the server keeps its own flag
 * (`device.consent {aiConsent}`) and refuses to draw without it (`consent_required`). The old
 * `micGateDone` key no longer counts: a device that passed the old mic gate sees the card once.
 * Bring-your-own-key builds (not hosted) need none of this.
 */

const consentSchema = z.object({ v: z.literal(1), at: z.string() })
const LEGACY_MIC_GATE_KEY = 'micGateDone'
/** The on-device recognizers speak en-US (matches session.ts). */
const EARS_LOCALE = 'en-US'

let loaded: Promise<void> | null = null

/** Read kv once (boot calls it; everything else awaits the same promise). Never throws. */
export function loadConsent(): Promise<void> {
  if (!loaded) {
    loaded = getKv(KV_KEYS.aiConsent)
      .then((raw) => {
        appStore.set({ aiConsent: parseConsent(raw) })
      })
      .catch(() => undefined)
  }
  return loaded
}

function parseConsent(raw: string | null): boolean {
  if (raw === null) return false
  try {
    return consentSchema.safeParse(JSON.parse(raw)).success
  } catch {
    return false
  }
}

/**
 * The server's view of consent, from any DeviceState. The server wins: it said no (withdrawn on the
 * website, or a fresh account) → the device forgets its yes and shows the "Not now" state; it said yes
 * while kv lost the key (reinstall with a kept token) → kv is restored.
 */
export async function reconcileConsent(server: boolean | undefined): Promise<void> {
  // A server from before the field: nothing to compare.
  if (server === undefined || !appStore.get().hosted) return
  await loadConsent()
  const local = appStore.get().aiConsent
  if (server === local) return
  if (server) {
    await writeConsentKv()
    appStore.set({ aiConsent: true, consentBlocked: false })
  } else {
    await setKv(KV_KEYS.aiConsent, null).catch(() => undefined)
    appStore.set({ aiConsent: false, consentBlocked: true })
  }
}

async function writeConsentKv(): Promise<void> {
  const value = JSON.stringify({ v: 1, at: new Date().toISOString() })
  await setKv(KV_KEYS.aiConsent, value).catch(() => undefined)
  await setKv(LEGACY_MIC_GATE_KEY, null).catch(() => undefined)
}

// --- The card (ConsentCard renders `consentOpen` and calls agree/decline) ---

let resolver: ((ok: boolean) => void) | null = null

/** Show the consent card (the caller has already passed the gate). Resolves true on "I agree". */
export function askConsent(): Promise<boolean> {
  resolver?.(false)
  resolver = null
  return new Promise<boolean>((resolve) => {
    resolver = resolve
    appStore.set({ consentOpen: true })
  })
}

function settle(ok: boolean): void {
  const r = resolver
  resolver = null
  appStore.set({ consentOpen: false })
  r?.(ok)
}

/**
 * Before story words leave the device: true when consent is already given, else gate → card. In
 * bring-your-own-key builds it is always true.
 */
export async function ensureConsent(): Promise<boolean> {
  if (!appStore.get().hosted) return true
  await loadConsent()
  if (appStore.get().aiConsent) return true
  if (!(await gate())) return false
  return askConsent()
}

/**
 * "I agree": tell the server first (it is the one that enforces), then remember it on the device, then
 * (in the app) start the on-device language model download in the background. Throws when the server
 * could not be told; the card shows that and stays open.
 */
export async function agreeConsent(): Promise<void> {
  await api('device.consent', { aiConsent: true })
  await writeConsentKv()
  appStore.set({ aiConsent: true, consentBlocked: false })
  if (NATIVE) void bridgeCall('speech.prepare', { locale: EARS_LOCALE }).catch(() => undefined)
  settle(true)
}

/** "Not now": mic and typing stay off until a grown-up says yes. */
export function declineConsent(): void {
  appStore.set({ consentBlocked: true })
  settle(false)
}

/** Grown-ups → "Turn off": the server stops drawing for this device, and the device forgets the yes. */
export async function withdrawConsent(): Promise<void> {
  await api('device.consent', { aiConsent: false })
  await setKv(KV_KEYS.aiConsent, null).catch(() => undefined)
  appStore.set({ aiConsent: false, consentBlocked: true })
}

/** The server answered `consent_required`: the same state as "Not now". */
export function consentRequired(): void {
  void setKv(KV_KEYS.aiConsent, null).catch(() => undefined)
  appStore.set({ aiConsent: false, consentBlocked: true })
}
