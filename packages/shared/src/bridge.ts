/**
 * The studio <-> native shell protocol over react-native-webview.
 * Up (studio -> native): `window.ReactNativeWebView.postMessage(JSON.stringify(BridgeRequest))`.
 * Down (native -> studio): the shell injects
 *   `window.__onceuponBridge.receive(<JSON of BridgeResponse | BridgeEvent>); true;`
 * The studio installs `window.__onceuponBridge` before its first request. The shell is detected by
 * `window.ReactNativeWebView` being present AND `shell=native` in the page query.
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

export type BridgeEventName = 'net' | 'foreground' | 'background'

export interface BridgeEvent {
  v: 1
  event: BridgeEventName
  /** net: { online: boolean }; foreground/background: {} */
  data: unknown
}

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
