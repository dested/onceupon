import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto'
import { Prisma } from '@prisma/client'
import type { Device } from '@prisma/client'
import { prisma } from './prisma'
import { env } from './env'
import * as ledger from './ledger'
import { nextWeeklyAt } from './ledger'
import type { Flags } from './flags'
import { isPackId } from '../../../packages/shared/src/packs'
import type { AppApi, DeviceState } from '../../../packages/shared/src/api'

// No ambiguous glyphs (no 0/O/1/I): a parent reads this code to support or types it on the website.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

export function newDeviceCode(): string {
  let s = ''
  for (let i = 0; i < 8; i++) s += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]
  return s
}

const sha256 = (s: string): string => createHash('sha256').update(s).digest('hex')

const sign = (deviceId: string, nonce: string): string =>
  createHmac('sha256', env.DEVICE_TOKEN_SECRET).update(`${deviceId}.${nonce}`).digest('hex')

/** Opaque device token: `deviceId.nonce.hmac`. Only the sha256 of the whole token is stored. */
export function mintToken(deviceId: string): { deviceToken: string; tokenHash: string } {
  const nonce = randomBytes(16).toString('hex')
  const sig = sign(deviceId, nonce)
  const token = `${deviceId}.${nonce}.${sig}`
  return { deviceToken: token, tokenHash: sha256(token) }
}

/** Recompute the HMAC in constant time; returns the deviceId when the token is well-formed and signed. */
export function verifyTokenShape(token: string): string | null {
  const parts = token.split('.')
  if (parts.length !== 3) return null
  const [deviceId, nonce, sig] = parts
  if (!deviceId || !nonce || !sig) return null
  const expected = sign(deviceId, nonce)
  const a = Buffer.from(sig, 'hex')
  const b = Buffer.from(expected, 'hex')
  if (a.length === 0 || a.length !== b.length) return null
  if (!timingSafeEqual(a, b)) return null
  return deviceId
}

export async function deviceFromToken(token: string): Promise<Device | null> {
  if (!verifyTokenShape(token)) return null
  return prisma.device.findUnique({ where: { tokenHash: sha256(token) } })
}

function isCodeCollision(e: unknown): boolean {
  if (!(e instanceof Prisma.PrismaClientKnownRequestError) || e.code !== 'P2002') return false
  const target = e.meta?.['target']
  if (typeof target === 'string') return target.includes('code')
  if (Array.isArray(target)) return target.some((t) => typeof t === 'string' && t.includes('code'))
  return false
}

/**
 * Register (or re-register) a device by installId.
 * - Known installId: rotate the token and refresh metadata; the balance is kept (a reinstall keeps it).
 * - New installId: create the device and grant the free first story, in one transaction.
 */
export async function registerDevice(
  input: AppApi['device.register']['input'],
  flags: Flags
): Promise<DeviceState & { deviceToken: string }> {
  const existing = await prisma.device.findUnique({ where: { installId: input.installId } })
  if (existing) {
    const { deviceToken, tokenHash } = mintToken(existing.id)
    const updated = await prisma.device.update({
      where: { id: existing.id },
      data: {
        tokenHash,
        appVersion: input.appVersion,
        storefront: input.storefront,
        lastSeenAt: new Date(),
      },
    })
    return { ...deviceState(updated, flags), deviceToken }
  }

  // The token embeds the device id, so we mint the id up front rather than reading back a cuid.
  const id = `dev_${randomBytes(16).toString('hex')}`
  const { deviceToken, tokenHash } = mintToken(id)

  let created: Device | null = null
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = newDeviceCode()
    try {
      created = await prisma.$transaction(async (tx) => {
        const d = await tx.device.create({
          data: {
            id,
            code,
            installId: input.installId,
            tokenHash,
            platform: input.platform,
            appVersion: input.appVersion,
            storefront: input.storefront,
            balanceSec: 0,
          },
        })
        await ledger.credit(d.id, 'grant_first', flags.freeFirstStorySec, null, 'first story', undefined, tx)
        return tx.device.findUniqueOrThrow({ where: { id: d.id } })
      })
      break
    } catch (e) {
      if (isCodeCollision(e) && attempt < 4) continue
      throw e
    }
  }
  if (!created) throw new Error('could not allocate a device code')
  return { ...deviceState(created, flags), deviceToken }
}

export function deviceState(d: Device, flags: Flags): DeviceState {
  const lastPack = d.lastPack && isPackId(d.lastPack) ? d.lastPack : null
  return {
    deviceId: d.id,
    code: d.code,
    balanceSec: d.balanceSec,
    paying: d.paying,
    shareVoice: d.shareVoice,
    freeStoryUsed: d.freeStoryUsed,
    blocked: d.blocked,
    nextWeeklyAt: nextWeeklyAt(d, flags),
    lastPack,
  }
}

/** Bump lastSeenAt at most every 5 minutes; fire-and-forget, never blocks the response. */
export function touchLastSeen(device: Device): void {
  if (Date.now() - device.lastSeenAt.getTime() < 5 * 60_000) return
  void prisma.device
    .update({ where: { id: device.id }, data: { lastSeenAt: new Date() } })
    .catch(() => {})
}
