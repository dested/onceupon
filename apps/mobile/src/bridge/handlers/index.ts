import * as SplashScreen from 'expo-splash-screen'
import { type Handlers } from '../host'
import { attributionToken } from './attribution'
import { deviceInfo } from './device'
import { iapFinish, iapPending, iapProducts, iapPurchase, iapRestore } from './iap'
import { kvGet, kvSet } from './kv'
import { netState } from './net'
import { blobDelete, blobGet, blobPut, storiesDelete, storiesList, storiesPut } from './storage'
import { haptic, openUrl, shareFile, shareUrl } from './share'
import { speechAvailable, speechPrepare, speechStart, speechStop } from './speech'
import { awakeSet, settingsOpen } from './system'

// The studio's first render reports `ready`; that is when we hide the native splash.
const ready: Handlers['ready'] = async () => {
  await SplashScreen.hideAsync()
  return {}
}

/** The full bridge handler map wired to the real Expo modules. */
export function createHandlers(): Handlers {
  return {
    ready,
    'device.info': deviceInfo,
    'kv.get': kvGet,
    'kv.set': kvSet,
    'stories.list': storiesList,
    'stories.put': storiesPut,
    'stories.delete': storiesDelete,
    'blob.put': blobPut,
    'blob.get': blobGet,
    'blob.delete': blobDelete,
    'iap.products': iapProducts,
    'iap.purchase': iapPurchase,
    'iap.restore': iapRestore,
    'iap.finish': iapFinish,
    'iap.pending': iapPending,
    'share.url': shareUrl,
    'share.file': shareFile,
    'open.url': openUrl,
    'settings.open': settingsOpen,
    haptic,
    'attribution.token': attributionToken,
    'net.state': netState,
    'awake.set': awakeSet,
    'speech.available': speechAvailable,
    'speech.start': speechStart,
    'speech.prepare': speechPrepare,
    'speech.stop': speechStop,
  }
}
