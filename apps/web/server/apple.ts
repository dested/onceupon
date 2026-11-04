import { readFileSync } from 'node:fs'
import {
  Environment,
  NotificationTypeV2,
  SignedDataVerifier,
  Type,
  type JWSTransactionDecodedPayload,
  type ResponseBodyV2DecodedPayload,
} from '@apple/app-store-server-library'
import { Prisma, type Device } from '@prisma/client'
import { prisma } from './prisma'
import { env } from './env'
import { credit, debit } from './ledger'
import { raiseAlert } from './alerts'
import { log } from './logger'
import { ApiError } from './app-api-types'
import { packByAppleProductId } from '../../../packages/shared/src/packs'
import type { AppApi } from '../../../packages/shared/src/api'

// DER-encoded Apple root; committed beside this file. verifyAndDecode* build the chain from it.
const rootCert = readFileSync(new URL('./apple-certs/AppleRootCA-G3.cer', import.meta.url))

const appAppleId = env.APPLE_APP_APPLE_ID

const verifiers = new Map<Environment, SignedDataVerifier>()

function verifier(environment: Environment): SignedDataVerifier {
  const existing = verifiers.get(environment)
  if (existing) return existing
  // appAppleId is required for Production checks, omitted in Sandbox.
  const created = new SignedDataVerifier(
    [rootCert],
    true,
    environment,
    env.APPLE_BUNDLE_ID,
    environment === Environment.PRODUCTION ? appAppleId : undefined
  )
  verifiers.set(environment, created)
  return created
}

function preferredOrder(): Environment[] {
  return env.APPLE_ENVIRONMENT === 'Production'
    ? [Environment.PRODUCTION, Environment.SANDBOX]
    : [Environment.SANDBOX, Environment.PRODUCTION]
}

/**
 * V-14: in production, build the Production verifier at boot. The library throws without
 * APPLE_APP_APPLE_ID, and every real purchase would then fail as `invalid_receipt` while sandbox
 * (App Review) passes. The server still starts; the operator gets an error log and an alert email.
 */
export async function checkProductionVerifier(id: number | undefined): Promise<boolean> {
  try {
    new SignedDataVerifier([rootCert], true, Environment.PRODUCTION, env.APPLE_BUNDLE_ID, id)
    return true
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    log.error(`[apple] Production verifier failed: ${message}. Real App Store purchases will not credit.`)
    await raiseAlert(
      'apple_verifier',
      `The App Store Production verifier cannot be built (${message}). Real purchases will be rejected: set APPLE_APP_APPLE_ID.`,
      { bundleId: env.APPLE_BUNDLE_ID, appAppleIdSet: id !== undefined }
    ).catch((e: unknown) => log.error(`[apple] alert failed: ${e instanceof Error ? e.message : String(e)}`))
    return false
  }
}

/** Tests replace verification with a decoder of their own; null restores the real verifier. */
let decodeOverride: ((jws: string) => Promise<JWSTransactionDecodedPayload>) | null = null
export function setTransactionDecoderForTests(
  fn: ((jws: string) => Promise<JWSTransactionDecodedPayload>) | null
): void {
  decodeOverride = fn
}

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002'
}

/** Try the configured environment first, then the other; the sandbox and production keys differ. */
async function decodeTransaction(jws: string): Promise<JWSTransactionDecodedPayload> {
  if (decodeOverride) {
    try {
      return await decodeOverride(jws)
    } catch {
      throw new ApiError(400, 'invalid_receipt', 'Could not verify the App Store transaction')
    }
  }
  let lastError: unknown = null
  for (const environment of preferredOrder()) {
    try {
      return await verifier(environment).verifyAndDecodeTransaction(jws)
    } catch (err) {
      lastError = err
    }
  }
  log.warn(`[apple] transaction verify failed: ${lastError instanceof Error ? lastError.message : String(lastError)}`)
  throw new ApiError(400, 'invalid_receipt', 'Could not verify the App Store transaction')
}

/** Credit one StoreKit 2 transaction, idempotent on the Apple transaction id. */
export async function creditTransaction(
  device: Device,
  jws: string
): Promise<AppApi['iap.verify']['output']> {
  const payload = await decodeTransaction(jws)
  const { productId, transactionId, type } = payload
  if (!productId || !transactionId) {
    throw new ApiError(400, 'invalid_receipt', 'Transaction is missing a product or id')
  }
  const pack = packByAppleProductId(productId)
  if (!pack) throw new ApiError(400, 'invalid_receipt', `Unknown product ${productId}`)
  if (type !== Type.CONSUMABLE) {
    throw new ApiError(400, 'invalid_receipt', 'Only consumable minute packs are supported')
  }

  const externalId = `apple:${transactionId}`
  const existing = await prisma.purchase.findUnique({ where: { externalId }, select: { id: true } })
  if (existing) {
    return { credited: false, seconds: pack.seconds, balanceSec: device.balanceSec, packId: pack.id }
  }

  const grossCents = pack.priceCents
  const feeCents = Math.round(grossCents * 0.15)
  const currency = payload.currency ? payload.currency.toLowerCase() : 'usd'

  let balanceSec: number
  try {
    balanceSec = await prisma.$transaction(async (tx) => {
      const purchase = await tx.purchase.create({
        data: {
          deviceId: device.id,
          channel: 'iap',
          packId: pack.id,
          seconds: pack.seconds,
          grossCents,
          feeCents,
          netCents: grossCents - feeCents,
          currency,
          externalId,
          originalTransactionId: payload.originalTransactionId ?? null,
          environment: payload.environment ?? env.APPLE_ENVIRONMENT,
        },
      })
      await credit(device.id, 'purchase', pack.seconds, purchase.id, productId, undefined, tx)
      const updated = await tx.device.update({
        where: { id: device.id },
        data: { paying: true, lastPack: pack.id },
        select: { balanceSec: true },
      })
      return updated.balanceSec
    })
  } catch (err) {
    // The same transaction verified twice at once: the unique externalId lets exactly one credit.
    if (!isUniqueViolation(err)) throw err
    const d = await prisma.device.findUniqueOrThrow({ where: { id: device.id }, select: { balanceSec: true } })
    return { credited: false, seconds: pack.seconds, balanceSec: d.balanceSec, packId: pack.id }
  }

  return { credited: true, seconds: pack.seconds, balanceSec, packId: pack.id }
}

/** Restore Purchases: re-credit any transaction we have not seen; ignore ones that fail to verify. */
export async function restoreTransactions(
  device: Device,
  jwsList: string[]
): Promise<AppApi['iap.restore']['output']> {
  let credited = 0
  let balanceSec = device.balanceSec
  for (const jws of jwsList) {
    try {
      const res = await creditTransaction(device, jws)
      balanceSec = res.balanceSec
      if (res.credited) credited += 1
    } catch (err) {
      if (err instanceof ApiError && err.code === 'invalid_receipt') continue
      throw err
    }
  }
  return { credited, balanceSec }
}

/** App Store Server Notifications v2. Idempotent on notificationUUID; handles refunds/revocations. */
async function decodeNotification(signedPayload: string): Promise<ResponseBodyV2DecodedPayload> {
  let lastError: unknown = null
  for (const environment of preferredOrder()) {
    try {
      return await verifier(environment).verifyAndDecodeNotification(signedPayload)
    } catch (err) {
      lastError = err
    }
  }
  log.warn(
    `[apple] notification verify failed: ${lastError instanceof Error ? lastError.message : String(lastError)}`
  )
  throw new ApiError(401, 'unauthorized', 'Could not verify the App Store notification')
}

export async function handleNotification(signedPayload: string): Promise<string> {
  // Apple sends sandbox notifications to the production URL too: try both environments.
  const notification = await decodeNotification(signedPayload)

  const uuid = notification.notificationUUID
  const notificationType = notification.notificationType ?? 'UNKNOWN'
  if (!uuid) throw new ApiError(400, 'bad_request', 'Notification is missing a UUID')

  const seen = await prisma.appleNotification.findUnique({
    where: { notificationUuid: uuid },
    select: { id: true },
  })
  if (seen) return 'duplicate'

  await prisma.appleNotification.create({
    data: {
      notificationUuid: uuid,
      type: String(notificationType),
      subtype: notification.subtype ? String(notification.subtype) : null,
      payload: JSON.parse(JSON.stringify(notification)),
    },
  })

  const reversing =
    notificationType === NotificationTypeV2.REFUND || notificationType === NotificationTypeV2.REVOKE
  if (reversing) {
    const signedTransactionInfo = notification.data?.signedTransactionInfo
    if (signedTransactionInfo) {
      const tx = await decodeTransaction(signedTransactionInfo)
      if (tx.transactionId) {
        const purchase = await prisma.purchase.findUnique({
          where: { externalId: `apple:${tx.transactionId}` },
        })
        if (purchase && !purchase.refundedAt) {
          await prisma.purchase.update({
            where: { id: purchase.id },
            data: { refundedAt: new Date() },
          })
          await debit(purchase.deviceId, 'refund', purchase.seconds, purchase.id, 'apple refund')
          await raiseAlert(
            'refund',
            `Apple ${String(notificationType)} for purchase ${purchase.id} (${purchase.seconds}s)`,
            { purchaseId: purchase.id, deviceId: purchase.deviceId, seconds: purchase.seconds }
          )
        }
      }
    }
  }

  return String(notificationType)
}
