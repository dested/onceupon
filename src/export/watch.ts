/**
 * Waiting on encoders without hanging the export: Cancel is checked at every wait, and an encoder
 * that holds work but has produced nothing for STALL_MS fails the export instead of freezing it.
 * Shared by the video encoder (mp4.ts) and the AAC encoder (aac.ts).
 */

/** An encoder holding work with no output for this long is stuck (seen: WKWebView in the iOS simulator). */
export const STALL_MS = 10_000

/** An encoder stopped producing output (no packet for STALL_MS while it held work). */
export class ExportStalledError extends Error {}

/** Give the UI thread a turn. MessageChannel is not throttled in background tabs, unlike setTimeout. */
export function yieldToUi(): Promise<void> {
  return new Promise((resolve) => {
    const ch = new MessageChannel()
    ch.port1.onmessage = () => resolve()
    ch.port2.postMessage(null)
  })
}

export function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new DOMException('Export cancelled', 'AbortError')
}

/**
 * Watches one encoder. `input(n)` / `output(n)` count units of work in and out (frames for video,
 * audio frames for AAC); while more went in than came out, STALL_MS without output is a stall.
 */
export class EncoderWatch {
  private lastOutputAt = performance.now()
  private fed = 0
  private out = 0
  constructor(
    private readonly signal: AbortSignal | undefined,
    private readonly what: string
  ) {}

  input(units = 1): void {
    if (this.fed <= this.out) this.lastOutputAt = performance.now()
    this.fed += units
  }

  output(units = 1): void {
    this.out += units
    this.lastOutputAt = performance.now()
  }

  check(): void {
    throwIfAborted(this.signal)
    if (this.fed > this.out && performance.now() - this.lastOutputAt > STALL_MS)
      throw new ExportStalledError(`${this.what} encoder produced nothing for ${STALL_MS / 1000}s`)
  }

  /** Yield until `ready()`, checking Cancel and the stall clock every turn. */
  async until(ready: () => boolean): Promise<void> {
    while (!ready()) {
      this.check()
      await yieldToUi()
    }
    this.check()
  }

  /** Await an encoder promise (flush) while still honouring Cancel and the stall clock. */
  race<T>(p: Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      let settled = false
      const finish = (): void => {
        settled = true
        clearInterval(timer)
        this.signal?.removeEventListener('abort', onAbort)
      }
      const fail = (e: unknown): void => {
        if (settled) return
        finish()
        reject(e)
      }
      const onAbort = (): void => fail(new DOMException('Export cancelled', 'AbortError'))
      const timer = setInterval(() => {
        try {
          this.check()
        } catch (e) {
          fail(e)
        }
      }, 250)
      this.signal?.addEventListener('abort', onAbort)
      p.then(
        (v) => {
          if (settled) return
          finish()
          resolve(v)
        },
        (e: unknown) => fail(e)
      )
    })
  }
}
