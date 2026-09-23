import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake'
import * as Notifications from 'expo-notifications'
import * as ScreenOrientation from 'expo-screen-orientation'
import * as StoreReview from 'expo-store-review'
import { z } from 'zod'
import { parseInput, type Handler } from '../host'

// Small OS switches the studio flips: keep-awake, orientation, review prompt and the
// notification permission. Each is best-effort on the studio side.

const AWAKE_TAG = 'squiggletale-studio'
const awakeSchema = z.object({ on: z.boolean() })
export const awakeSet: Handler<'awake.set'> = async (input) => {
  const { on } = parseInput(awakeSchema, input)
  if (on) await activateKeepAwakeAsync(AWAKE_TAG)
  else await deactivateKeepAwake(AWAKE_TAG)
  return {}
}

const orientationSchema = z.object({ mode: z.enum(['any', 'landscape', 'portrait']) })
export const orientationLock: Handler<'orientation.lock'> = async (input) => {
  const { mode } = parseInput(orientationSchema, input)
  if (mode === 'any') await ScreenOrientation.unlockAsync()
  else if (mode === 'landscape') await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE)
  else await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT)
  return {}
}

export const reviewRequest: Handler<'review.request'> = async () => {
  if (!(await StoreReview.isAvailableAsync())) return { shown: false }
  await StoreReview.requestReview()
  return { shown: true }
}

const notifySchema = z.object({ request: z.boolean() })
export const notifyPermission: Handler<'notify.permission'> = async (input) => {
  const { request } = parseInput(notifySchema, input)
  const current = await Notifications.getPermissionsAsync()
  if (!request || current.granted || !current.canAskAgain) return { status: current.status }
  const asked = await Notifications.requestPermissionsAsync()
  return { status: asked.status }
}
