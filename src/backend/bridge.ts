import { z } from 'zod'
import {
  BRIDGE_EVENT_NAMES,
  SHELL_QUERY,
  type BridgeDown,
  type BridgeErrorCode,
  type BridgeEventName,
  type BridgeInput,
  type BridgeName,
  type BridgeOutput,
  type BridgeRequest,
} from '../../packages/shared/src/bridge'

/**
 * The studio's side of the native bridge (packages/shared/src/bridge.ts). Requests go up through
 * `window.ReactNativeWebView.postMessage`; the shell answers by injecting
 * `window.__onceuponBridge.receive(msg)`. Output shapes are trusted to the shell's typing except for
 * the envelope, which is zod-checked because it crosses a process boundary.
 */

const REQUEST_TIMEOUT_MS = 20_000
/** Calls that wait on a person (StoreKit sheet, share sheet, Photos prompt) get a generous timeout. */
const INTERACTIVE_TIMEOUT_MS = 10 * 60_000
const INTERACTIVE: ReadonlySet<BridgeName> = new Set<BridgeName>([
  'iap.purchase',
  'iap.restore',
  'share.url',
  'share.file',
  'media.saveVideo',
  'notify.permission',
  'speech.start',
])
/** How long a request waits for `window.ReactNativeWebView` if the shell flagged itself but the handler is late. */
const HANDLER_WAIT_MS = 3_000

export class BridgeError extends Error {
  constructor(
    readonly code: BridgeErrorCode,
    message: string
  ) {
    super(message)
  }
}

const responseSchema = z.discriminatedUnion('ok', [
  z.object({ v: z.literal(1), id: z.string(), ok: z.literal(true), output: z.unknown() }),
  z.object({
    v: z.literal(1),
    id: z.string(),
    ok: z.literal(false),
    error: z.object({
      code: z.enum(['cancelled', 'unsupported', 'failed', 'bad_request']),
      message: z.string(),
    }),
  }),
])
const eventSchema = z.object({
  v: z.literal(1),
  event: z.enum(BRIDGE_EVENT_NAMES),
  data: z.unknown(),
})

interface Pending {
  resolve: (output: unknown) => void
  reject: (err: BridgeError) => void
  timer: number
}

const pending = new Map<string, Pending>()
const listeners = new Map<BridgeEventName, Set<(data: unknown) => void>>()
let counter = 0

interface NativePort {
  postMessage: (msg: string) => void
}

interface ShellWindow {
  ReactNativeWebView?: NativePort
  __onceuponBridge?: { receive: (msg: unknown) => void }
  /** Set by the shell's injectedJavaScriptBeforeContentLoaded, before any studio script runs. */
  __onceuponShell?: unknown
}

function shell(): ShellWindow {
  const w: unknown = window
  return typeof w === 'object' && w !== null ? (w as ShellWindow) : {}
}

/**
 * True inside the native shell: the shell flagged the URL (`shell=native`) and one of its injected
 * markers is present. `__onceuponShell` is set before any page script, so detection does not depend
 * on the order in which WebKit installs `ReactNativeWebView`; a request waits briefly for that.
 */
export function hasBridge(): boolean {
  if (typeof window === 'undefined') return false
  if (!window.location.search.includes(SHELL_QUERY)) return false
  const w = shell()
  return w.ReactNativeWebView !== undefined || w.__onceuponShell !== undefined
}

function nativePort(): Promise<NativePort | null> {
  const now = shell().ReactNativeWebView
  if (now) return Promise.resolve(now)
  if (!hasBridge()) return Promise.resolve(null)
  return new Promise((resolve) => {
    const started = Date.now()
    const tick = () => {
      const port = shell().ReactNativeWebView
      if (port) resolve(port)
      else if (Date.now() - started >= HANDLER_WAIT_MS) resolve(null)
      else window.setTimeout(tick, 25)
    }
    tick()
  })
}

function receive(msg: unknown): void {
  const res = responseSchema.safeParse(msg)
  if (res.success) {
    const p = pending.get(res.data.id)
    if (!p) return
    pending.delete(res.data.id)
    window.clearTimeout(p.timer)
    if (res.data.ok) p.resolve(res.data.output)
    else p.reject(new BridgeError(res.data.error.code, res.data.error.message))
    return
  }
  const ev = eventSchema.safeParse(msg)
  if (ev.success) {
    for (const fn of listeners.get(ev.data.event) ?? []) fn(ev.data.data)
  }
}

/** Installs the receiver; safe to call more than once. Called from boot() before any request. */
export function installBridge(): void {
  if (typeof window === 'undefined') return
  const w = shell()
  if (!w.__onceuponBridge) w.__onceuponBridge = { receive }
}

export async function bridgeCall<K extends BridgeName>(type: K, input: BridgeInput<K>): Promise<BridgeOutput<K>> {
  const rn = await nativePort()
  if (!rn) throw new BridgeError('unsupported', 'no native shell')
  installBridge()
  const id = `${Date.now().toString(36)}-${++counter}`
  const req: BridgeRequest = { v: 1, id, type, input }
  const timeoutMs = INTERACTIVE.has(type) ? INTERACTIVE_TIMEOUT_MS : REQUEST_TIMEOUT_MS
  return new Promise<BridgeOutput<K>>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      pending.delete(id)
      reject(new BridgeError('failed', `${type} timed out`))
    }, timeoutMs)
    pending.set(id, {
      // The shell is typed against the same BridgeApi map; the envelope was checked above.
      resolve: (output) => resolve(output as BridgeOutput<K>),
      reject,
      timer,
    })
    rn.postMessage(JSON.stringify(req))
  })
}

export function onBridgeEvent(name: BridgeEventName, fn: (data: unknown) => void): () => void {
  let set = listeners.get(name)
  if (!set) {
    set = new Set()
    listeners.set(name, set)
  }
  set.add(fn)
  return () => {
    set?.delete(fn)
  }
}

/** For tests and the debug panel: feed a message as the shell would. */
export function receiveFromShell(msg: BridgeDown): void {
  receive(msg)
}

export async function blobToBase64(blob: Blob): Promise<string> {
  const buf = new Uint8Array(await blob.arrayBuffer())
  let s = ''
  const CHUNK = 0x8000
  for (let i = 0; i < buf.length; i += CHUNK) {
    s += String.fromCharCode(...buf.subarray(i, i + CHUNK))
  }
  return btoa(s)
}

export function base64ToBlob(b64: string, mime: string): Blob {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new Blob([bytes], { type: mime })
}
