import { randomInt } from 'node:crypto'
import { Prisma, type Device } from '@prisma/client'
import { prisma } from './prisma'
import { credit } from './ledger'
import { ApiError } from './app-api-types'
import { isPackId, packById, type PackId } from '../../../packages/shared/src/packs'

// No 0/O/1/I/L so a code read off a printed card is unambiguous.
export const GIFT_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

function group(chars: string): string {
  return (chars.match(/.{1,4}/g) ?? []).join('-')
}

export function newGiftCode(): string {
  let raw = ''
  for (let i = 0; i < 12; i += 1) raw += GIFT_ALPHABET[randomInt(GIFT_ALPHABET.length)]
  return group(raw)
}

/** Uppercase, drop anything that is not a letter or digit, regroup into XXXX-XXXX-XXXX. */
export function normalizeCode(input: string): string {
  const cleaned = input.toUpperCase().replace(/[^A-Z0-9]/g, '')
  return group(cleaned)
}

function toPackId(packId: string): PackId {
  if (!isPackId(packId)) throw new ApiError(500, 'internal', `Corrupt gift pack id ${packId}`)
  return packId
}

export interface MintGiftInput {
  packId: PackId
  stripeSessionId: string
  buyerEmail?: string | null
  fromName?: string | null
  toName?: string | null
  message?: string | null
  grossCents: number
  feeCents: number
}

/** Create a gift code from a paid Stripe session; retries on the (rare) code collision. */
export async function mintCode(input: MintGiftInput): Promise<string> {
  const pack = packById(input.packId)
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = newGiftCode()
    try {
      await prisma.giftCode.create({
        data: {
          code,
          packId: pack.id,
          seconds: pack.seconds,
          grossCents: input.grossCents,
          feeCents: input.feeCents,
          stripeSessionId: input.stripeSessionId,
          buyerEmail: input.buyerEmail ?? null,
          fromName: input.fromName ?? null,
          toName: input.toName ?? null,
          message: input.message ?? null,
        },
      })
      return code
    } catch (err) {
      if (isUniqueViolation(err) && attempt < 4) continue
      throw err
    }
  }
  throw new ApiError(500, 'internal', 'Could not mint a unique gift code')
}

export interface RedeemResult {
  seconds: number
  balanceSec: number
  packId: PackId
}

/** Redeem a code onto a device: once only, bound to that device, credits its balance in one tx. */
export async function redeemCode(device: Device, code: string): Promise<RedeemResult> {
  const normalized = normalizeCode(code)
  const gift = await prisma.giftCode.findUnique({ where: { code: normalized } })
  if (!gift || gift.voidedAt) throw new ApiError(404, 'invalid_code', 'That gift code was not found')
  if (gift.redeemedAt) throw new ApiError(409, 'already_used', 'That gift code was already redeemed')

  const packId = toPackId(gift.packId)

  const balanceSec = await prisma.$transaction(async (tx) => {
    const fresh = await tx.giftCode.findUnique({ where: { id: gift.id } })
    if (!fresh || fresh.voidedAt) throw new ApiError(404, 'invalid_code', 'That gift code was not found')
    if (fresh.redeemedAt) throw new ApiError(409, 'already_used', 'That gift code was already redeemed')

    await tx.giftCode.update({
      where: { id: gift.id },
      data: { redeemedAt: new Date(), redeemedByDeviceId: device.id },
    })
    const purchase = await tx.purchase.create({
      data: {
        deviceId: device.id,
        channel: 'gift',
        packId,
        seconds: gift.seconds,
        grossCents: 0,
        feeCents: 0,
        netCents: 0,
        externalId: `gift:${gift.id}`,
        giftCodeId: gift.id,
      },
    })
    await credit(device.id, 'redeem', gift.seconds, purchase.id, `gift ${fresh.code}`, undefined, tx)
    const updated = await tx.device.update({
      where: { id: device.id },
      data: { paying: true, lastPack: packId },
      select: { balanceSec: true },
    })
    return updated.balanceSec
  })

  return { seconds: gift.seconds, balanceSec, packId }
}

export interface GiftPublicView {
  code: string
  packId: PackId
  minutes: number
  fromName: string | null
  toName: string | null
  message: string | null
}

/** The buyer's thank-you page polls this until the webhook has minted the code. */
export async function giftBySession(stripeSessionId: string): Promise<GiftPublicView | null> {
  const gift = await prisma.giftCode.findUnique({ where: { stripeSessionId } })
  if (!gift) return null
  const packId = toPackId(gift.packId)
  return {
    code: gift.code,
    packId,
    minutes: packById(packId).minutes,
    fromName: gift.fromName,
    toName: gift.toName,
    message: gift.message,
  }
}

export async function voidCode(code: string, reason: string, actor: string): Promise<void> {
  const normalized = normalizeCode(code)
  const gift = await prisma.giftCode.findUnique({ where: { code: normalized } })
  if (!gift) throw new ApiError(404, 'invalid_code', 'That gift code was not found')
  if (gift.redeemedAt) throw new ApiError(409, 'already_used', 'A redeemed code cannot be voided')
  await prisma.giftCode.update({
    where: { id: gift.id },
    data: { voidedAt: new Date(), voidReason: `${reason} (${actor})` },
  })
}

/** Redeem on the website: resolve the device by its parent-facing code, then redeem. */
export async function redeemOnWeb(code: string, deviceCode: string): Promise<RedeemResult> {
  const device = await prisma.device.findUnique({ where: { code: deviceCode } })
  if (!device) throw new ApiError(404, 'not_found', 'That device code was not found')
  return redeemCode(device, code)
}

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002'
}
