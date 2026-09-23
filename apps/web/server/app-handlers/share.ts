import { z } from 'zod'
import { deviceHandler, type Handlers } from '../app-api-types'
import { createShare, listShares, sharedRecordSchema, unpublishShare } from '../shares'
import type { AppApi } from '../../../../packages/shared/src/api'

const shareCreateInput: z.ZodType<AppApi['share.create']['input']> = z.object({
  record: sharedRecordSchema,
  childName: z.string().nullable(),
  voice: z.object({ mime: z.string(), base64: z.string() }).nullable(),
  coverPng: z.string().nullable(),
})
const shareUnpublishInput: z.ZodType<AppApi['share.unpublish']['input']> = z.object({
  id: z.string().min(1),
})
const shareListInput: z.ZodType<AppApi['share.list']['input']> = z.object({})

/** Publish, take down, and list a device's shared stories. */
export const shareHandlers: Handlers = {
  'share.create': deviceHandler<'share.create'>(shareCreateInput, async (input, ctx) =>
    createShare(ctx.device, input)
  ),
  'share.unpublish': deviceHandler<'share.unpublish'>(shareUnpublishInput, async (input, ctx) => {
    await unpublishShare(ctx.device, input.id)
    return { ok: true }
  }),
  'share.list': deviceHandler<'share.list'>(shareListInput, async (_input, ctx) => ({
    shares: await listShares(ctx.device),
  })),
}
