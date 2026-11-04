import { FAKE_ANTHROPIC_PORT } from './setup'

/**
 * A local stand-in for `POST /v1/messages` (streaming). The relay's real SDK client talks to it through
 * ANTHROPIC_BASE_URL. `mode` picks the behaviour of the next calls.
 * - ok: two drawing lines, end_turn
 * - error: HTTP 500 (the SDK retries once, then the relay reports upstream)
 * - slow: headers, then nothing for 10 s (the relay's first-token deadline ends it)
 * - drip: a line every 100 ms for 10 s (for the client-abort test)
 * - nothing: the model's "nothing fit to draw" reply (`# nothing`)
 * - wait: the prompt's no-op line (`wait`), which is not a skip
 */
export type FakeMode = 'ok' | 'error' | 'slow' | 'drip' | 'nothing' | 'wait'

export const fake = {
  mode: 'ok' as FakeMode,
  requests: 0,
  /** Streams whose client (the relay) hung up before the fake finished. */
  closedEarly: 0,
  lastSystem: '',
  lastModel: '',
}

const enc = new TextEncoder()
const sse = (type: string, data: Record<string, unknown>): Uint8Array =>
  enc.encode(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`)

const start = (): Uint8Array =>
  sse('message_start', {
    message: {
      id: 'msg_fake',
      type: 'message',
      role: 'assistant',
      model: 'fake',
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: 100, output_tokens: 1, cache_read_input_tokens: 5000, cache_creation_input_tokens: 0 },
    },
  })
const blockStart = (): Uint8Array => sse('content_block_start', { index: 0, content_block: { type: 'text', text: '' } })
const delta = (text: string): Uint8Array => sse('content_block_delta', { index: 0, delta: { type: 'text_delta', text } })
const end = (output: number): Uint8Array[] => [
  sse('content_block_stop', { index: 0 }),
  sse('message_delta', { delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: output } }),
  sse('message_stop', {}),
]

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

let server: ReturnType<typeof Bun.serve> | null = null

export function startFakeAnthropic(): void {
  if (server) return
  server = Bun.serve({
    port: FAKE_ANTHROPIC_PORT,
    hostname: '127.0.0.1',
    idleTimeout: 30,
    async fetch(req) {
      fake.requests++
      const body: unknown = await req.json()
      const system = typeof body === 'object' && body !== null ? Reflect.get(body, 'system') : undefined
      fake.lastSystem = JSON.stringify(system ?? '')
      const model = typeof body === 'object' && body !== null ? Reflect.get(body, 'model') : undefined
      fake.lastModel = typeof model === 'string' ? model : ''
      const mode = fake.mode
      if (mode === 'error') {
        return Response.json({ type: 'error', error: { type: 'api_error', message: 'boom' } }, { status: 500 })
      }
      const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
          let closed = false
          req.signal.addEventListener('abort', () => {
            if (!closed) fake.closedEarly++
            closed = true
          })
          const push = (b: Uint8Array): boolean => {
            if (closed) return false
            try {
              controller.enqueue(b)
              return true
            } catch {
              closed = true
              return false
            }
          }
          push(start())
          if (mode === 'slow') {
            await sleep(10_000)
          } else if (mode === 'drip') {
            push(blockStart())
            for (let i = 0; i < 100 && !closed; i++) {
              push(delta(`star s${i} 10 10\n`))
              await sleep(100)
            }
          } else if (mode === 'nothing' || mode === 'wait') {
            push(blockStart())
            push(delta(mode === 'nothing' ? '# nothing\n' : 'wait\n'))
          } else {
            push(blockStart())
            push(delta('place beach\n'))
            push(delta('cat c1 left\n'))
          }
          for (const b of end(12)) push(b)
          if (!closed) {
            closed = true
            controller.close()
          }
        },
      })
      return new Response(stream, { headers: { 'content-type': 'text/event-stream' } })
    },
  })
}

export function stopFakeAnthropic(): void {
  server?.stop(true)
  server = null
}
