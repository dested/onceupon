import { z } from 'zod'
import type { BridgeEventName, SpeechEngine } from '../../packages/shared/src/bridge'

/**
 * Dev only: a fake native shell in the browser, so the app's shell paths (on-device ears, permission
 * denied, interruptions, model download, unfinished purchases) can be driven from bx without an
 * iPhone. Open the studio with `?shell=native&fakeshell=1`; it installs the shell markers before
 * config.ts decides NATIVE, answers bridge calls, and exposes `window.__fakeShell`:
 *
 *   __fakeShell.cfg.permission = 'denied'      // speech.available reports it; speech.start fails not-allowed
 *   __fakeShell.cfg.readyMs = null             // speech.start never sends speech.ready (model download)
 *   __fakeShell.say('a big red dog', true)     // a speech.result (final), as the shell would send it
 *   __fakeShell.emit('speech.error', { code: 'interrupted', message: 'call' }); __fakeShell.emit('speech.end', {})
 *   __fakeShell.cfg.stopMs = 1500             // speech.stop answers late (pause, then a quick tap again)
 *   __fakeShell.cfg.pending = [{ jws, transactionId, productId }]   // iap.pending at boot
 *   __fakeShell.calls                          // every request the studio made: [{ type, input }]
 *
 * Storage (kv, stories, blobs) lives in localStorage under `fakeshell.*`. Never in a production build.
 */

interface FakeShellConfig {
  engine: SpeechEngine | null
  engines: SpeechEngine[]
  permission: 'granted' | 'denied' | 'undetermined'
  /** ms from speech.start to speech.ready; null = never (a model download that hangs). */
  readyMs: number | null
  /** speech.start answers `available: false` (old OS, broken engine). */
  startUnavailable: boolean
  /** How long speech.stop takes to answer (the analyzer finalizing), ms. */
  stopMs: number
  pending: Array<{ jws: string; transactionId: string; productId: string }>
}

interface FakeShell {
  cfg: FakeShellConfig
  calls: Array<{ type: string; input: unknown }>
  emit(event: BridgeEventName, data: unknown): void
  say(text: string, isFinal: boolean): void
  listening: boolean
}

interface FakeShellWindow {
  __onceuponShell?: unknown
  ReactNativeWebView?: { postMessage: (msg: string) => void }
  __onceuponBridge?: { receive: (msg: unknown) => void }
  __fakeShell?: FakeShell
}

const requestSchema = z.object({ v: z.literal(1), id: z.string(), type: z.string(), input: z.unknown() })
type FakeRequest = z.infer<typeof requestSchema>

const KV = 'fakeshell.kv.'
const STORY = 'fakeshell.story.'
const BLOB = 'fakeshell.blob.'

function keysWith(prefix: string): string[] {
  const out: string[] = []
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)
    if (k?.startsWith(prefix)) out.push(k)
  }
  return out
}

function install(w: FakeShellWindow): void {
  const segments: Array<{ transcript: string; isFinal: boolean }> = []
  let readyTimer = 0
  const deliver = (msg: unknown, ms = 5): void => {
    window.setTimeout(() => w.__onceuponBridge?.receive(msg), ms)
  }
  const shell: FakeShell = {
    cfg: {
      engine: 'analyzer',
      engines: ['analyzer', 'sfspeech'],
      permission: 'granted',
      readyMs: 300,
      startUnavailable: false,
      stopMs: 5,
      pending: [],
    },
    calls: [],
    listening: false,
    emit: (event, data) => deliver({ v: 1, event, data }),
    say: (text, isFinal) => {
      const last = segments[segments.length - 1]
      if (last && !last.isFinal) segments[segments.length - 1] = { transcript: text, isFinal }
      else segments.push({ transcript: text, isFinal })
      shell.emit('speech.result', { results: segments.slice(), isFinal })
    },
  }

  const answer = (req: FakeRequest): unknown => {
    const input: unknown = req.input
    const field = (name: string): string => {
      if (typeof input !== 'object' || input === null) return ''
      const v: unknown = Reflect.get(input, name)
      return typeof v === 'string' ? v : ''
    }
    switch (req.type) {
      case 'device.info': {
        let installId = localStorage.getItem('fakeshell.installId')
        if (!installId) {
          installId = crypto.randomUUID()
          localStorage.setItem('fakeshell.installId', installId)
        }
        return {
          installId,
          platform: 'ios',
          appVersion: '1.0.0',
          buildNumber: '1',
          model: 'FakePhone',
          storefront: 'USA',
          online: true,
          source: 'remote',
          locale: 'en-US',
          region: 'US',
        }
      }
      case 'kv.get':
        return { value: localStorage.getItem(KV + field('key')) }
      case 'kv.set': {
        const value: unknown = typeof input === 'object' && input !== null ? Reflect.get(input, 'value') : null
        if (typeof value === 'string') localStorage.setItem(KV + field('key'), value)
        else localStorage.removeItem(KV + field('key'))
        return {}
      }
      case 'stories.list':
        return { records: keysWith(STORY).map((k) => localStorage.getItem(k) ?? '') }
      case 'stories.put':
        localStorage.setItem(STORY + field('id'), field('json'))
        return {}
      case 'stories.delete':
        localStorage.removeItem(STORY + field('id'))
        for (const k of keysWith(`${BLOB}voice/${field('id')}/`)) localStorage.removeItem(k)
        return {}
      case 'blob.put':
        localStorage.setItem(BLOB + field('path'), field('base64'))
        return {}
      case 'blob.get':
        return { base64: localStorage.getItem(BLOB + field('path')) }
      case 'blob.delete':
        localStorage.removeItem(BLOB + field('path'))
        return {}
      case 'speech.available':
        return { engine: shell.cfg.engine, engines: shell.cfg.engines, permission: shell.cfg.permission }
      case 'speech.start': {
        segments.length = 0
        if (shell.cfg.permission === 'denied') {
          shell.emit('speech.error', { code: 'not-allowed', message: 'fake shell: permission denied' })
          return { available: false }
        }
        if (shell.cfg.startUnavailable || !shell.cfg.engine) return { available: false }
        shell.listening = true
        const ms = shell.cfg.readyMs
        window.clearTimeout(readyTimer)
        if (ms !== null) readyTimer = window.setTimeout(() => shell.emit('speech.ready', {}), ms)
        return { available: true, engine: shell.cfg.engine }
      }
      case 'speech.stop':
        shell.listening = false
        window.clearTimeout(readyTimer)
        return { clip: null }
      case 'speech.prepare':
        return { ready: true }
      case 'iap.pending':
        return { transactions: shell.cfg.pending }
      case 'iap.products':
        return { products: [] }
      case 'attribution.token':
        return { token: null }
      case 'net.state':
        return { online: true }
      case 'notify.permission':
        return { status: 'denied' }
      default:
        return {}
    }
  }

  // Settings that must hold from boot (e.g. `pending`) can be stored first: localStorage `fakeshell.cfg`.
  try {
    Object.assign(shell.cfg, JSON.parse(localStorage.getItem('fakeshell.cfg') ?? '{}'))
  } catch {
    // ignore a bad stored cfg
  }
  w.__onceuponShell = { fake: true }
  w.ReactNativeWebView = {
    postMessage: (raw: string) => {
      const parsed = requestSchema.safeParse(JSON.parse(raw))
      if (!parsed.success) return
      const r = parsed.data
      shell.calls.push({ type: r.type, input: r.input })
      deliver({ v: 1, id: r.id, ok: true, output: answer(r) }, r.type === 'speech.stop' ? shell.cfg.stopMs : 5)
    },
  }
  w.__fakeShell = shell
}

if (
  import.meta.env.DEV &&
  typeof window !== 'undefined' &&
  new URLSearchParams(window.location.search).get('fakeshell') === '1'
) {
  const w: unknown = window
  if (typeof w === 'object' && w !== null) install(w as FakeShellWindow)
}
