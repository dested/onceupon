import { z } from 'zod'
import { bridgeCall, installBridge, onBridgeEvent } from '~/backend/bridge'
import { HOSTED, NATIVE } from '~/backend/config'
import { initDevice, sendAttributionOnce } from '~/backend/device'
import { initStorage } from '~/story/storage'
import { appStore } from '~/story/store'

const netSchema = z.object({ online: z.boolean() })

/** Runs before the first render: bridge, storage cache, and (hosted only) the device account. */
export async function boot(): Promise<void> {
  installBridge()
  await initStorage()
  if (HOSTED) await initDevice()

  window.addEventListener('online', () => appStore.set({ online: true }))
  window.addEventListener('offline', () => appStore.set({ online: false }))
  onBridgeEvent('net', (d) => {
    const parsed = netSchema.safeParse(d)
    if (parsed.success) appStore.set({ online: parsed.data.online })
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
