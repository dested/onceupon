import { z } from 'zod'
import { ApiError, deviceHandler, publicHandler, type Handlers } from '../app-api-types'
import { deviceState, registerDevice, touchLastSeen } from '../device'
import * as ledger from '../ledger'
import * as sessions from '../sessions'
import { getFlags } from '../flags'
import { getMaskWords } from '../mask'
import { pickEarsVendor } from '../ears'
import { resolveAttribution } from '../attribution'
import { prisma } from '../prisma'
import { env } from '../env'
import type { AppApi, ClientConfig } from '../../../../packages/shared/src/api'

// No-input handlers: an empty object. `{}` is assignable to Record<string, never>.
const noInput: z.ZodType<Record<string, never>> = z.object({})

const platform: z.ZodType<AppApi['device.register']['input']['platform']> = z.enum([
  'ios',
  'android',
  'web',
])
const earsVendor: z.ZodType<AppApi['session.start']['input']['ears']> = z.enum([
  'deepgram',
  'openai',
  'browser',
])
const endReason: z.ZodType<AppApi['session.stop']['input']['ended']> = z
  .enum(['the-end', 'sleepy', 'silence'])
  .nullable()

const registerInput: z.ZodType<AppApi['device.register']['input']> = z.object({
  installId: z.string().min(1).max(200),
  platform,
  appVersion: z.string().max(64).nullable(),
  storefront: z.string().max(16).nullable(),
})

const consentInput: z.ZodType<AppApi['device.consent']['input']> = z.object({
  shareVoice: z.boolean(),
})

const attributionInput: z.ZodType<AppApi['device.attribution']['input']> = z.object({
  token: z.string().min(1).max(4000),
})

const sessionStartInput: z.ZodType<AppApi['session.start']['input']> = z.object({
  storyId: z.string().min(1).max(200),
  ears: earsVendor,
})

const sessionBeatInput: z.ZodType<AppApi['session.beat']['input']> = z.object({
  sessionId: z.string().min(1),
  listeningMs: z.number().min(0),
})

const sessionStopInput: z.ZodType<AppApi['session.stop']['input']> = z.object({
  sessionId: z.string().min(1),
  listeningMs: z.number().min(0),
  ended: endReason,
})

const earsTokenInput: z.ZodType<AppApi['ears.token']['input']> = z.object({
  sessionId: z.string().min(1),
})

export const coreHandlers: Handlers = {
  'device.register': publicHandler<'device.register'>(registerInput, async (input) => {
    const flags = await getFlags()
    return registerDevice(input, flags)
  }),

  'device.state': deviceHandler<'device.state'>(noInput, async (_input, ctx) => {
    const flags = await getFlags()
    const fresh = await ledger.applyWeeklyGrant(ctx.device, flags)
    touchLastSeen(fresh)
    return deviceState(fresh, flags)
  }),

  'device.consent': deviceHandler<'device.consent'>(consentInput, async (input, ctx) => {
    const flags = await getFlags()
    // Turning it on requires a paying device; turning it off is always allowed.
    if (input.shareVoice && !ctx.device.paying) {
      throw new ApiError(403, 'consent_required', 'buy a pack to share with voice')
    }
    const updated = await prisma.device.update({
      where: { id: ctx.device.id },
      data: { shareVoice: input.shareVoice },
    })
    return deviceState(updated, flags)
  }),

  'device.attribution': deviceHandler<'device.attribution'>(attributionInput, async (input, ctx) =>
    resolveAttribution(ctx.device, input.token)
  ),

  config: deviceHandler<'config'>(noInput, async () => {
    const flags = await getFlags()
    const origin = env.PUBLIC_ORIGIN
    const config: ClientConfig = {
      earsVendor: pickEarsVendor(flags) ?? flags.earsVendor,
      model: flags.model,
      dialect: flags.dialect,
      freeFirstStorySec: flags.freeFirstStorySec,
      weeklyFreeSec: flags.weeklyFreeSec,
      purchasesPaused: flags.purchasesPaused,
      relayPaused: flags.relayPaused,
      readOnly: flags.readOnly,
      shopUrl: `${origin}/shop`,
      redeemUrl: `${origin}/redeem`,
      privacyUrl: `${origin}/privacy`,
      termsUrl: `${origin}/terms`,
      supportUrl: `${origin}/support`,
      deleteDataUrl: `${origin}/delete-my-data`,
      silenceNudgeMs: flags.silenceNudgeMs,
      silenceEndMs: flags.silenceEndMs,
    }
    return config
  }),

  'mask.list': deviceHandler<'mask.list'>(noInput, async () => ({ words: await getMaskWords() })),

  'session.start': deviceHandler<'session.start'>(sessionStartInput, async (input, ctx) =>
    sessions.startSession(ctx.device, input)
  ),

  'session.beat': deviceHandler<'session.beat'>(sessionBeatInput, async (input, ctx) =>
    sessions.beat(ctx.device, input.sessionId, input.listeningMs)
  ),

  'session.stop': deviceHandler<'session.stop'>(sessionStopInput, async (input, ctx) =>
    sessions.stopSession(ctx.device, input.sessionId, input.listeningMs, input.ended)
  ),

  'ears.token': deviceHandler<'ears.token'>(earsTokenInput, async (input, ctx) =>
    sessions.earsTokenFor(ctx.device, input.sessionId)
  ),
}
