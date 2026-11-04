import { z } from 'zod'
import { deviceHandler, ApiError, type Handlers } from '../app-api-types'
import { getFlags } from '../flags'
import { creditTransaction, restoreTransactions } from '../apple'
import { redeemCode } from '../gifts'
import type { AppApi } from '../../../../packages/shared/src/api'

const iapVerifyInput: z.ZodType<AppApi['iap.verify']['input']> = z.object({ jws: z.string().min(1) })
const iapRestoreInput: z.ZodType<AppApi['iap.restore']['input']> = z.object({
  jws: z.array(z.string()),
})
const giftRedeemInput: z.ZodType<AppApi['gift.redeem']['input']> = z.object({
  code: z.string().min(1),
})

/** StoreKit receipt verification, restore, and gift-code redemption. All credit the device ledger. */
export const moneyHandlers: Handlers = {
  'iap.verify': deviceHandler<'iap.verify'>(iapVerifyInput, async (input, ctx) => {
    const flags = await getFlags()
    if (flags.purchasesPaused) throw new ApiError(503, 'paused', 'Purchases are paused')
    return creditTransaction(ctx.device, input.jws)
  }),
  'iap.restore': deviceHandler<'iap.restore'>(iapRestoreInput, async (input, ctx) =>
    restoreTransactions(ctx.device, input.jws)
  ),
  // Guideline 3.1.1 (V-17): codes sold on the website are redeemed on the website, never inside the iOS app.
  'gift.redeem': deviceHandler<'gift.redeem'>(giftRedeemInput, async (input, ctx) => {
    if (ctx.device.platform === 'ios') {
      throw new ApiError(403, 'blocked', 'Gift codes are redeemed on the website')
    }
    return redeemCode(ctx.device, input.code)
  }),
}
