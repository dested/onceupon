import { z } from 'zod'
import {
  type BridgeDown,
  type BridgeErrorCode,
  type BridgeEvent,
  type BridgeEventMap,
  type BridgeEventName,
  type BridgeName,
  type BridgeOutput,
  type BridgeResponse,
} from '../../../../packages/shared/src/bridge'

// The native side of packages/shared/src/bridge.ts. The studio posts a BridgeRequest up through
// `window.ReactNativeWebView.postMessage`; the shell answers by injecting
// `window.__onceuponBridge.receive(<BridgeDown>)`. Handlers are passed in (real wiring lives in
// handlers/index.ts) so the host can be unit-tested against fakes.

/** Runtime facts a handler may need that only the WebView host knows. */
export interface HostContext {
  readonly platform: 'ios' | 'android'
  /** 'remote' when the WebView loaded the hosted studio, 'local' for the bundled copy. */
  getSource(): 'remote' | 'local'
  getOnline(): boolean
}

/** Pushes a typed event down to the studio. */
export type Emit = <E extends BridgeEventName>(event: E, data: BridgeEventMap[E]) => void

/** What a handler sees: the host facts plus a way to push events (speech results) later. */
export interface HandlerContext extends HostContext {
  readonly emit: Emit
}

/**
 * A single bridge handler. Input is `unknown` because it crosses the postMessage boundary; each
 * handler validates its own input with zod. The output is typed per bridge method.
 */
export type Handler<K extends BridgeName> = (input: unknown, ctx: HandlerContext) => Promise<BridgeOutput<K>>

/**
 * Bridge methods in the shared contract that this shell deliberately does not implement; the host
 * answers them `unsupported`. `media.saveVideo`: Save video left 1.0 (d78bc47), and with it Photos
 * (no expo-media-library, no photo-library purpose strings). Marketing renders still call it from Chrome.
 */
export const OMITTED_NAMES = ['media.saveVideo'] as const satisfies readonly BridgeName[]
export type OmittedName = (typeof OMITTED_NAMES)[number]
/** The bridge methods this shell answers. */
export type ShellName = Exclude<BridgeName, OmittedName>

export type Handlers = { [K in ShellName]: Handler<K> }

/** Thrown by handlers to control the error code reported to the studio. */
export class BridgeHostError extends Error {
  constructor(
    readonly code: BridgeErrorCode,
    message: string
  ) {
    super(message)
    this.name = 'BridgeHostError'
  }
}

/** Every bridge method the shell answers, kept in sync with ShellName by the compile-time check below. */
export const BRIDGE_NAMES = [
  'ready',
  'device.info',
  'kv.get',
  'kv.set',
  'stories.list',
  'stories.put',
  'stories.delete',
  'blob.put',
  'blob.get',
  'blob.delete',
  'iap.products',
  'iap.purchase',
  'iap.restore',
  'iap.finish',
  'iap.pending',
  'share.url',
  'share.file',
  'open.url',
  'settings.open',
  'haptic',
  'attribution.token',
  'net.state',
  'awake.set',
  'speech.available',
  'speech.start',
  'speech.prepare',
  'speech.stop',
] as const satisfies readonly ShellName[]

// Fails to compile if bridge.ts adds a method that is neither in BRIDGE_NAMES nor in OMITTED_NAMES.
type MissingName = Exclude<ShellName, (typeof BRIDGE_NAMES)[number]>
const _allNamesCovered: MissingName extends never ? true : never = true
void _allNamesCovered

const NAME_SET: ReadonlySet<string> = new Set(BRIDGE_NAMES)
const OMITTED_SET: ReadonlySet<string> = new Set(OMITTED_NAMES)

function isShellName(type: string): type is ShellName {
  return NAME_SET.has(type)
}

const envelopeSchema = z.object({
  v: z.literal(1),
  id: z.string(),
  type: z.string(),
  input: z.unknown(),
})

/** Validate a handler's input, mapping a schema failure to a `bad_request` error. */
export function parseInput<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input)
  if (!result.success) throw new BridgeHostError('bad_request', result.error.message)
  return result.data
}

function toError(err: unknown): { code: BridgeErrorCode; message: string } {
  if (err instanceof BridgeHostError) return { code: err.code, message: err.message }
  if (err instanceof Error) return { code: 'failed', message: err.message }
  return { code: 'failed', message: 'unknown error' }
}

export class BridgeHost {
  private readonly ctx: HandlerContext

  constructor(
    private readonly send: (js: string) => void,
    private readonly handlers: Partial<Handlers>,
    host: HostContext
  ) {
    this.ctx = {
      platform: host.platform,
      getSource: () => host.getSource(),
      getOnline: () => host.getOnline(),
      emit: (event, data) => this.emit(event, data),
    }
  }

  /** Handle one raw postMessage payload from the studio. Never throws. */
  handle(raw: string): void {
    let json: unknown
    try {
      json = JSON.parse(raw)
    } catch {
      return
    }
    const parsed = envelopeSchema.safeParse(json)
    if (!parsed.success) return
    const { id, type, input } = parsed.data
    void this.dispatch(id, type, input)
  }

  /** Push an unsolicited event (net, lifecycle, insets, speech) down to the studio. */
  emit<E extends BridgeEventName>(event: E, data: BridgeEventMap[E]): void {
    const message: BridgeEvent = { v: 1, event, data }
    this.inject(message)
  }

  private async dispatch(id: string, type: string, input: unknown): Promise<void> {
    if (OMITTED_SET.has(type)) {
      this.reply({ v: 1, id, ok: false, error: { code: 'unsupported', message: `${type} is not in this app` } })
      return
    }
    const handler = this.lookup(type)
    if (!handler) {
      this.reply({ v: 1, id, ok: false, error: { code: 'bad_request', message: `unknown bridge type: ${type}` } })
      return
    }
    try {
      const output: unknown = await handler(input, this.ctx)
      this.reply({ v: 1, id, ok: true, output })
    } catch (err) {
      this.reply({ v: 1, id, ok: false, error: toError(err) })
    }
  }

  private lookup(type: string): Handler<ShellName> | undefined {
    if (!isShellName(type)) return undefined
    return this.handlers[type]
  }

  private reply(message: BridgeResponse): void {
    this.inject(message)
  }

  private inject(message: BridgeDown): void {
    // Escape `<` so a story/blob payload containing `</script>` cannot break out of the injected JS.
    const json = JSON.stringify(message).replace(/</g, '\\u003c')
    this.send(`window.__onceuponBridge && window.__onceuponBridge.receive(${json}); true;`)
  }
}
