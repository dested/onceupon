import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import { router, adminProcedure } from '../trpc'
import * as q from '../admin-queries'
import { credit, debit } from '../ledger'
import { voidCode } from '../gifts'
import { getFlags, setFlag, flagsSchema, isFlagKey } from '../flags'
import { invalidateMask } from '../mask'

const daysInput = z.object({ days: z.number().int().min(1).max(365) })

/** Admin portal procedures. Every input is zod; every read is a real Prisma query in admin-queries.ts. */
export const adminRouter = router({
  overview: adminProcedure.input(daysInput).query(({ input }) => q.overview(input.days)),
  usage: adminProcedure.input(daysInput).query(({ input }) => q.usage(input.days)),
  revenue: adminProcedure.input(daysInput).query(({ input }) => q.revenue(input.days)),
  costs: adminProcedure.input(daysInput).query(({ input }) => q.costs(input.days)),

  ledger: router({
    search: adminProcedure.input(z.object({ q: z.string() })).query(({ input }) => q.ledgerSearch(input.q)),
    device: adminProcedure
      .input(z.object({ deviceId: z.string().min(1) }))
      .query(({ input }) => q.ledgerDevice(input.deviceId)),
    adjust: adminProcedure
      .input(z.object({ deviceId: z.string().min(1), seconds: z.number().int(), reason: z.string().min(1) }))
      .mutation(async ({ input, ctx }) => {
        const actor = ctx.session.user.email
        if (input.seconds === 0) throw new TRPCError({ code: 'BAD_REQUEST', message: 'seconds must be non-zero' })
        if (input.seconds > 0) {
          await credit(input.deviceId, 'admin', input.seconds, null, input.reason, actor)
        } else {
          await debit(input.deviceId, 'admin', Math.abs(input.seconds), null, input.reason, actor)
        }
        await q.logAudit(actor, 'ledger.adjust', input.deviceId, { seconds: input.seconds, reason: input.reason })
        return q.deviceBalance(input.deviceId)
      }),
    block: adminProcedure
      .input(z.object({ deviceId: z.string().min(1), blocked: z.boolean(), reason: z.string().default('') }))
      .mutation(({ input, ctx }) =>
        q.setBlocked(input.deviceId, input.blocked, input.reason, ctx.session.user.email)
      ),
    resetFreeStory: adminProcedure
      .input(z.object({ deviceId: z.string().min(1) }))
      .mutation(({ input, ctx }) => q.resetFreeStory(input.deviceId, ctx.session.user.email)),
  }),

  gift: router({
    void: adminProcedure
      .input(z.object({ code: z.string().min(1), reason: z.string().min(1) }))
      .mutation(async ({ input, ctx }) => {
        const actor = ctx.session.user.email
        await voidCode(input.code, input.reason, actor)
        await q.logAudit(actor, 'gift.void', input.code, { reason: input.reason })
        return { ok: true }
      }),
  }),

  shares: router({
    list: adminProcedure.input(daysInput).query(({ input }) => q.sharesList(input.days)),
    unpublish: adminProcedure
      .input(z.object({ id: z.string().min(1) }))
      .mutation(({ input, ctx }) => q.unpublishShare(input.id, ctx.session.user.email)),
  }),

  safety: adminProcedure.input(daysInput).query(({ input }) => q.safety(input.days)),
  mask: router({
    add: adminProcedure
      .input(z.object({ word: z.string().min(1) }))
      .mutation(async ({ input, ctx }) => {
        const res = await q.maskAdd(input.word, ctx.session.user.email)
        await invalidateMask()
        return res
      }),
    remove: adminProcedure
      .input(z.object({ word: z.string().min(1) }))
      .mutation(async ({ input, ctx }) => {
        const res = await q.maskRemove(input.word, ctx.session.user.email)
        await invalidateMask()
        return res
      }),
  }),

  flags: router({
    get: adminProcedure.query(() => getFlags()),
    set: adminProcedure
      .input(z.object({ key: z.string().min(1), value: z.unknown() }))
      .mutation(async ({ input, ctx }) => {
        if (!isFlagKey(input.key)) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: `unknown flag ${input.key}` })
        }
        // Validate the whole object with the change applied, then write the one validated value.
        // setFlag re-validates per key, writes its own audit row and busts the flag cache.
        const current = await getFlags()
        const parsed = flagsSchema.parse({ ...current, [input.key]: input.value })
        return setFlag(input.key, parsed[input.key], ctx.session.user.email)
      }),
  }),

  alerts: router({
    list: adminProcedure
      .input(z.object({ unreadOnly: z.boolean().default(false) }))
      .query(({ input }) => q.alertsList(input.unreadOnly)),
    markRead: adminProcedure
      .input(z.object({ id: z.string().min(1) }))
      .mutation(({ input }) => q.markAlertRead(input.id)),
  }),

  audit: router({
    list: adminProcedure
      .input(z.object({ limit: z.number().int().min(1).max(500).default(200) }))
      .query(({ input }) => q.auditList(input.limit)),
  }),
})
