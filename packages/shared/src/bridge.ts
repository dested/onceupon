/**
 * The studio <-> native shell protocol over react-native-webview.
 * Up (studio -> native): `window.ReactNativeWebView.postMessage(JSON.stringify(BridgeRequest))`.
 * Down (native -> studio): the shell injects
 *   `window.__onceuponBridge.receive(<JSON of BridgeResponse | BridgeEvent>); true;`
 * The studio installs `window.__onceuponBridge` before its first request. The shell is detected by
 * `shell=native` in the page query AND either `window.__onceuponShell` (the shell's
 * injectedJavaScriptBeforeContentLoaded) or `window.ReactNativeWebView` being present; a request
 * made before ReactNativeWebView appears waits briefly for it.
 */
export interface BridgeApi {
  /** The studio has rendered its first screen: hide the native splash. */
  ready: { input: Record<string, never>; output: Record<string, never> }
  'device.info': {
    input: Record<string, never>
    output: {
      installId: string
      platform: 'ios' | 'android'
      appVersion: string
      buildNumber: string
      model: string
      storefront: string | null
      online: boolean
      /** 'remote' when the WebView loaded the hosted studio, 'local' for the bundled copy. */
      source: 'remote' | 'local'
      /** BCP-47 tag of the device's first preferred language, e.g. `en-US`. */
      locale: string
      /** ISO region of the device (settings region), null when the OS does not say. */
      region: string | null
    }
  }
  'kv.get': { input: { key: string }; output: { value: string | null } }
  'kv.set': { input: { key: string; value: string | null }; output: Record<string, never> }
  /** Every saved story as JSON text (small: words + DSL lines). */
  'stories.list': { input: Record<string, never>; output: { records: string[] } }
  'stories.put': { input: { id: string; json: string }; output: Record<string, never> }
  /** Also removes the story's voice clips. */
  'stories.delete': { input: { id: string }; output: Record<string, never> }
  /** Binary files (voice clips); `path` is relative, e.g. `voice/<storyId>/1.m4a`. */
  'blob.put': { input: { path: string; base64: string }; output: Record<string, never> }
  'blob.get': { input: { path: string }; output: { base64: string | null } }
  'blob.delete': { input: { path: string }; output: Record<string, never> }
  'iap.products': {
    input: { productIds: string[] }
    output: { products: Array<{ productId: string; localizedPrice: string; currency: string }> }
  }
  /** Resolves with the StoreKit 2 signed transaction (JWS). Rejects with code 'cancelled' when the parent backs out. */
  'iap.purchase': { input: { productId: string }; output: { jws: string; transactionId: string } }
  'iap.restore': { input: Record<string, never>; output: { jws: string[] } }
  'iap.finish': { input: { transactionId: string }; output: Record<string, never> }
  'share.url': { input: { url: string; title: string }; output: { completed: boolean } }
  'share.file': {
    input: { base64: string; mime: string; filename: string }
    output: { completed: boolean }
  }
  /** Opens in the system browser (web checkout, privacy policy). */
  'open.url': { input: { url: string }; output: Record<string, never> }
  haptic: { input: { kind: 'light' | 'success' | 'warning' }; output: Record<string, never> }
  /** Apple AdServices attribution token, null off-iOS or when unavailable. */
  'attribution.token': { input: Record<string, never>; output: { token: string | null } }
  'net.state': { input: Record<string, never>; output: { online: boolean } }
  /**
   * Saves an mp4 to the camera roll (add-only Photos permission). `saved: false` means the grown-up
   * denied Photos access; any other failure rejects.
   */
  'media.saveVideo': { input: { base64: string; filename: string }; output: { saved: boolean } }
  /** The shell's audio session: `playsInSilent` lets story sounds play with the silent switch on. */
  'audio.mode': { input: { playsInSilent: boolean }; output: Record<string, never> }
  /** Keep the screen awake (live story, replay, export). */
  'awake.set': { input: { on: boolean }; output: Record<string, never> }
  'orientation.lock': { input: { mode: 'any' | 'landscape' | 'portrait' }; output: Record<string, never> }
  /** The system review prompt; iOS decides whether it actually shows, so `shown` means "asked". */
  'review.request': { input: Record<string, never>; output: { shown: boolean } }
  /** Never prompts unless `request` is true (kids app: a grown-up action only). */
  'notify.permission': {
    input: { request: boolean }
    output: { status: 'granted' | 'denied' | 'undetermined' }
  }
  /**
   * On-device speech recognition (SFSpeechRecognizer). Results arrive as `speech.result` events,
   * then `speech.end`; failures as `speech.error`. `available: false` when the OS cannot do it.
   */
  'speech.start': { input: { locale: string; onDevice: boolean }; output: { available: boolean } }
  'speech.stop': { input: Record<string, never>; output: Record<string, never> }
}

/** Event payloads pushed by the shell (`BridgeEvent.data`), per event name. */
export interface BridgeEventMap {
  net: { online: boolean }
  foreground: Record<string, never>
  background: Record<string, never>
  /** Safe-area insets in CSS px, also written as `--shell-inset-*` vars on <html>. */
  insets: { top: number; right: number; bottom: number; left: number }
  /** Same shape as the studio's RecResult list: every segment so far, the last may be interim. */
  'speech.result': { results: Array<{ transcript: string; isFinal: boolean }>; isFinal: boolean }
  'speech.end': Record<string, never>
  'speech.error': { code: string; message: string }
}

export type BridgeName = keyof BridgeApi
export type BridgeInput<K extends BridgeName> = BridgeApi[K]['input']
export type BridgeOutput<K extends BridgeName> = BridgeApi[K]['output']

export type BridgeErrorCode = 'cancelled' | 'unsupported' | 'failed' | 'bad_request'

export interface BridgeRequest {
  v: 1
  id: string
  type: BridgeName
  input: unknown
}

export type BridgeResponse =
  | { v: 1; id: string; ok: true; output: unknown }
  | { v: 1; id: string; ok: false; error: { code: BridgeErrorCode; message: string } }

export type BridgeEventName = keyof BridgeEventMap

/** Every event name, for runtime validation on the studio side. */
export const BRIDGE_EVENT_NAMES = [
  'net',
  'foreground',
  'background',
  'insets',
  'speech.result',
  'speech.end',
  'speech.error',
] as const satisfies readonly BridgeEventName[]
// Fails to compile if BridgeEventMap gains an event missing from BRIDGE_EVENT_NAMES.
type MissingEvent = Exclude<BridgeEventName, (typeof BRIDGE_EVENT_NAMES)[number]>
const _allEventsCovered: MissingEvent extends never ? true : never = true
void _allEventsCovered

export interface BridgeEvent {
  v: 1
  event: BridgeEventName
  /** See BridgeEventMap for the shape per event. */
  data: unknown
}

/** CSS custom properties the shell writes on <html>; the studio uses max(env(safe-area-inset-*), var). */
export const SHELL_INSET_VARS = {
  top: '--shell-inset-top',
  right: '--shell-inset-right',
  bottom: '--shell-inset-bottom',
  left: '--shell-inset-left',
} as const

export type BridgeDown = BridgeResponse | BridgeEvent

export const BRIDGE_VERSION = 1 as const
/** Query flag the shell appends to the studio URL. */
export const SHELL_QUERY = 'shell=native'
/** kv keys the studio keeps on the shell. */
export const KV_KEYS = {
  deviceToken: 'deviceToken',
  settings: 'settings',
  tutorialDone: 'tutorialDone',
} as const
