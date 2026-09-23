import { bridgeCall, BridgeError } from './bridge'
import { APP_SHELL, NATIVE } from './config'
import { api, ApiError } from './api'
import { refreshDevice } from './device'
import { appStore } from '~/story/store'
import { BRAND } from '../../packages/shared/src/brand'
import { formatUsd, PACKS, packById, type PackId } from '../../packages/shared/src/packs'
import type { AppApi } from '../../packages/shared/src/api'

/**
 * Minute packs. Native devices buy through StoreKit and the server verifies the signed transaction;
 * the web app sends the parent to the website shop with the device code so the balance lands here on
 * the next refresh. The app never links to the web shop (App Store rules). Prices come from the store when native, else the built-in USD list.
 */

export interface PriceInfo {
  packId: PackId
  localizedPrice: string
}

export async function loadPrices(): Promise<PriceInfo[]> {
  if (NATIVE) {
    try {
      const { products } = await bridgeCall('iap.products', {
        productIds: PACKS.map((p) => p.appleProductId),
      })
      const byProductId = new Map(products.map((p) => [p.productId, p.localizedPrice]))
      return PACKS.map((p) => ({
        packId: p.id,
        localizedPrice: byProductId.get(p.appleProductId) ?? formatUsd(p.priceCents),
      }))
    } catch {
      // fall through to the USD list
    }
  }
  return PACKS.map((p) => ({ packId: p.id, localizedPrice: formatUsd(p.priceCents) }))
}

export type BuyResult =
  | { ok: true; seconds: number; balanceSec: number }
  | { ok: false; reason: 'cancelled' | 'failed' | 'paused' | 'web' }

export async function buyPack(id: PackId): Promise<BuyResult> {
  if (!NATIVE) {
    // Inside the app (even with a broken bridge) purchases are StoreKit only: never navigate the
    // WebView to the web shop.
    if (APP_SHELL) return { ok: false, reason: 'failed' }
    window.location.assign(webShopUrl(id))
    return { ok: false, reason: 'web' }
  }
  const pack = packById(id)
  let jws: string
  let transactionId: string
  try {
    const res = await bridgeCall('iap.purchase', { productId: pack.appleProductId })
    jws = res.jws
    transactionId = res.transactionId
  } catch (e) {
    if (e instanceof BridgeError && e.code === 'cancelled') return { ok: false, reason: 'cancelled' }
    return { ok: false, reason: 'failed' }
  }
  try {
    const verify = await api('iap.verify', { jws })
    await bridgeCall('iap.finish', { transactionId })
    await refreshDevice()
    return { ok: true, seconds: verify.seconds, balanceSec: verify.balanceSec }
  } catch (e) {
    if (e instanceof ApiError && e.code === 'paused') return { ok: false, reason: 'paused' }
    return { ok: false, reason: 'failed' }
  }
}

export async function restorePurchases(): Promise<{ credited: number; balanceSec: number }> {
  if (!NATIVE) return { credited: 0, balanceSec: appStore.get().balanceSec }
  const { jws } = await bridgeCall('iap.restore', {})
  const res = await api('iap.restore', { jws })
  await refreshDevice()
  return res
}

export async function redeemGift(code: string): Promise<AppApi['gift.redeem']['output']> {
  const res = await api('gift.redeem', { code })
  await refreshDevice()
  return res
}

/** The website shop with the device code appended so the balance credits this device. */
export function webShopUrl(pack?: PackId): string {
  const { config, deviceCode } = appStore.get()
  const base = config?.shopUrl || `${BRAND.origin}/shop`
  const url = new URL(base)
  if (deviceCode) url.searchParams.set('d', deviceCode)
  if (pack) url.searchParams.set('pack', pack)
  return url.toString()
}

export async function openExternal(url: string): Promise<void> {
  if (NATIVE) {
    await bridgeCall('open.url', { url })
    return
  }
  window.open(url, '_blank', 'noopener')
}
