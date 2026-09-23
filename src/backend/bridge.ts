import { z } from 'zod'
import {
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
  event: z.enum(['net', 'foreground', 'background']),
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

interface ShellWindow {
  ReactNativeWebView?: { postMessage: (msg: string) => void }
  __onceuponBridge?: { receive: (msg: unknown) => void }
}

function shell(): ShellWindow {
  const w: unknown = window
  return typeof w === 'object' && w !== null ? (w as ShellWindow) : {}
}

/** True inside the native shell: the WebView bridge exists and the shell said so in the query. */
export function hasBridge(): boolean {
  if (typeof window === 'undefined') return false
  return Boolean(shell().ReactNativeWebView) && window.location.search.includes(SHELL_QUERY)
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

export function bridgeCall<K extends BridgeName>(type: K, input: BridgeInput<K>): Promise<BridgeOutput<K>> {
  const w = shell()
  const rn = w.ReactNativeWebView
  if (!rn) return Promise.reject(new BridgeError('unsupported', 'no native shell'))
  installBridge()
  const id = `${Date.now().toString(36)}-${++counter}`
  const req: BridgeRequest = { v: 1, id, type, input }
  return new Promise<BridgeOutput<K>>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      pending.delete(id)
      reject(new BridgeError('failed', `${type} timed out`))
    }, REQUEST_TIMEOUT_MS)
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
