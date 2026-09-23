import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import { router, publicProcedure } from '../trpc'
import { env } from '../env'
import { prisma } from '../prisma'
import { ApiError } from '../app-api-types'
import { createGiftCheckout, createPackCheckout, sessionStatus } from '../stripe'
import { giftBySession, redeemOnWeb } from '../gifts'
import { shareMeta } from '../shares'
import type { PackId } from '../../../../packages/shared/src/packs'

// Mirrors PackId in packs.ts; `satisfies` catches any drift at compile time.
const PACK_ID_VALUES = ['pack_40', 'pack_120', 'pack_400'] as const satisfies readonly PackId[]
const packIdSchema = z.enum(PACK_ID_VALUES)

/** Maps a handler ApiError onto the tRPC error space so the website pages show sane messages. */
function toTrpc(err: unknown): TRPCError {
  if (err instanceof ApiError) {
    const code =
      err.code === 'not_found' || err.code === 'invalid_code'
        ? 'NOT_FOUND'
        : err.code === 'already_used'
          ? 'CONFLICT'
          : err.code === 'paused'
            ? 'PRECONDITION_FAILED'
            : 'BAD_REQUEST'
    return new TRPCError({ code, message: err.message })
  }
  if (err instanceof TRPCError) return err
  return new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Unexpected error' })
}

const shopRouter = router({
  checkout: publicProcedure
    .input(z.object({ packId: packIdSchema, deviceCode: z.string().min(1) }))
    .mutation(async ({ input }) => {
      try {
        return await createPackCheckout({
          packId: input.packId,
          deviceCode: input.deviceCode,
          origin: env.PUBLIC_ORIGIN,
        })
      } catch (err) {
        throw toTrpc(err)
      }
    }),
  bySession: publicProcedure
    .input(z.object({ sessionId: z.string().min(1) }))
    .query(async ({ input }) => {
      try {
        const status = await sessionStatus(input.sessionId)
        if (!status || status.metadata.kind !== 'pack') return null
        const purchase = await prisma.purchase.findUnique({
          where: { externalId: `stripe:${input.sessionId}` },
          select: { id: true },
        })
        return {
          packId: status.metadata.packId,
          deviceCode: status.metadata.deviceCode,
          credited: purchase !== null,
        }
      } catch (err) {
        throw toTrpc(err)
      }
    }),
})

const giftRouter = router({
  checkout: publicProcedure
    .input(
      z.object({
        packId: packIdSchema,
        fromName: z.string().optional(),
        toName: z.string().optional(),
        message: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        return await createGiftCheckout({
          packId: input.packId,
          fromName: input.fromName,
          toName: input.toName,
          message: input.message,
          origin: env.PUBLIC_ORIGIN,
        })
      } catch (err) {
        throw toTrpc(err)
      }
    }),
  bySession: publicProcedure
    .input(z.object({ sessionId: z.string().min(1) }))
    .query(async ({ input }) => {
      try {
        return await giftBySession(input.sessionId)
      } catch (err) {
        throw toTrpc(err)
      }
    }),
  redeemOnWeb: publicProcedure
    .input(z.object({ code: z.string().min(1), deviceCode: z.string().min(1) }))
    .mutation(async ({ input }) => {
      try {
        const res = await redeemOnWeb(input.code, input.deviceCode)
        return { ...res, deviceCode: input.deviceCode }
      } catch (err) {
        throw toTrpc(err)
      }
    }),
})

const shareRouter = router({
  meta: publicProcedure.input(z.object({ id: z.string().min(1) })).query(async ({ input }) => {
    try {
      return await shareMeta(input.id)
    } catch (err) {
      throw toTrpc(err)
    }
  }),
})

/** Website procedures: shop + gift checkout/status, web redeem, and share-page metadata. */
export const siteRouter = router({
  shop: shopRouter,
  gift: giftRouter,
  share: shareRouter,
})
