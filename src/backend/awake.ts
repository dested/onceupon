import { bridgeCall } from './bridge'
import { NATIVE } from './config'

/**
 * Keep the screen on while a story is live or listening, during replay and during export. Native:
 * the shell's keep-awake. Web: the Screen Wake Lock API where the browser has it. Best-effort, never
 * throws; the last call wins.
 */

let webLock: WakeLockSentinel | null = null
let wantOn = false

export function setAwake(on: boolean): void {
  wantOn = on
  if (NATIVE) {
    void bridgeCall('awake.set', { on }).catch(() => undefined)
    return
  }
  if (on) void acquireWebLock()
  else releaseWebLock()
}

async function acquireWebLock(): Promise<void> {
  if (webLock || typeof navigator === 'undefined' || !('wakeLock' in navigator)) return
  try {
    const lock = await navigator.wakeLock.request('screen')
    if (!wantOn) {
      void lock.release()
      return
    }
    webLock = lock
    lock.addEventListener('release', () => {
      if (webLock === lock) webLock = null
    })
  } catch {
    // Denied (page hidden, battery saver): nothing to do.
  }
}

function releaseWebLock(): void {
  const lock = webLock
  webLock = null
  if (lock) void lock.release().catch(() => undefined)
}

// The browser drops a wake lock whenever the page is hidden; take it back on return.
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (!NATIVE && wantOn && document.visibilityState === 'visible') void acquireWebLock()
  })
}
