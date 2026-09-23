import { z } from 'zod'
import { bridgeCall, installBridge, onBridgeEvent } from '~/backend/bridge'
import { HOSTED, NATIVE } from '~/backend/config'
import { initDevice, sendAttributionOnce } from '~/backend/device'
import { initStorage } from '~/story/storage'
import { appStore } from '~/story/store'
import { setAwake } from '~/backend/awake'

const netSchema = z.object({ online: z.boolean() })

/**
 * Runs before the first render: bridge and storage cache (local, fast). The device account (hosted
 * only) is network, so it starts here but is not awaited: the first paint and the shell's `ready`
 * never wait on the server. Calls that need the token wait for it inside api().
 */
export async function boot(): Promise<void> {
  installBridge()
  await initStorage()
  // kv lives in the storage backend, so registration starts once it is picked.
  if (HOSTED) void initDevice()

  window.addEventListener('online', () => appStore.set({ online: true }))
  window.addEventListener('offline', () => appStore.set({ online: false }))
  onBridgeEvent('net', (d) => {
    const parsed = netSchema.safeParse(d)
    if (parsed.success) appStore.set({ online: parsed.data.online })
  })
  // Keep the screen on while the mic is open or a replay is playing (a child watching should not see
  // the iPad dim). One place, driven by state, so every path that stops listening also releases it.
  let awake = false
  appStore.subscribe(() => {
    const s = appStore.get()
    const want = s.listening || s.micStarting || (s.screen === 'replay' && s.replayPlaying)
    if (want !== awake) {
      awake = want
      setAwake(want)
    }
  })

  // StoryScreen already pauses on visibilitychange, so backgrounding needs nothing here.
  onBridgeEvent('background', () => undefined)

  if (NATIVE) {
    requestAnimationFrame(() => {
      void bridgeCall('ready', {})
      void sendAttributionOnce()
    })
  }
}
