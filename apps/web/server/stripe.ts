import Stripe from 'stripe'
import { z } from 'zod'
import { prisma } from './prisma'
import { env } from './env'
import { credit } from './ledger'
import { ApiError } from './app-api-types'
import { mintCode } from './gifts'
import { raiseAlert } from './alerts'
import { log } from './logger'
import { packById, type PackId } from '../../../packages/shared/src/packs'

let client: Stripe | null = null

/** Throws `paused` (503) when Stripe is not configured, so checkout degrades cleanly in dev. */
function getStripe(): Stripe {
  if (!env.STRIPE_SECRET_KEY) throw new ApiError(503, 'paused', 'Card checkout is not configured')
  if (!client) client = new Stripe(env.STRIPE_SECRET_KEY)
  return client
}

// Mirrors PackId in packs.ts; `satisfies` catches any typo or drift at compile time.
const PACK_ID_VALUES = ['pack_40', 'pack_120', 'pack_400'] as const satisfies readonly PackId[]
const packIdSchema = z.enum(PACK_ID_VALUES)

const packMeta = z.object({
  kind: z.literal('pack'),
  packId: packIdSchema,
  deviceCode: z.string().min(1),
})
const giftMeta = z.object({
  kind: z.literal('gift'),
  packId: packIdSchema,
  fromName: z.string().default(''),
  toName: z.string().default(''),
  message: z.string().default(''),
})
const checkoutMeta = z.discriminatedUnion('kind', [packMeta, giftMeta])
export type CheckoutMetadata = z.infer<typeof checkoutMeta>

/** The parts of a completed Checkout Session the fulfillment path needs; kept small so it is testable. */
export interface CompletedCheckout {
  id: string
  amountTotal: number | null
  paymentStatus: string
  customerEmail: string | null
  metadata: Record<string, string> | null
}

function stripeFeeCents(amountCents: number): number {
  return Math.round(amountCents * 0.029) + 30
}

export interface CheckoutResult {
  url: string
}

export async function createPackCheckout(params: {
  packId: PackId
  deviceCode: string
  origin: string
}): Promise<CheckoutResult> {
  const pack = packById(params.packId)
  // Look the device up before touching Stripe so a bad family code says so even when the shop is paused.
  const device = await prisma.device.findUnique({
    where: { code: params.deviceCode },
    select: { id: true },
  })
  if (!device) throw new ApiError(404, 'not_found', 'That device code was not found')
  const stripe = getStripe()

  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: 'usd',
          unit_amount: pack.priceCents,
          product_data: { name: `${pack.name}, ${pack.minutes} minutes` },
        },
      },
    ],
    metadata: { kind: 'pack', packId: pack.id, deviceCode: params.deviceCode },
    success_url: `${params.origin}/shop/thanks?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${params.origin}/shop?d=${params.deviceCode}`,
  })
  if (!session.url) throw new ApiError(502, 'upstream', 'Stripe did not return a checkout URL')
  return { url: session.url }
}

export async function createGiftCheckout(params: {
  packId: PackId
  fromName?: string
  toName?: string
  message?: string
  origin: string
}): Promise<CheckoutResult> {
  const stripe = getStripe()
  const pack = packById(params.packId)
  const fromName = (params.fromName ?? '').trim().slice(0, 40)
  const toName = (params.toName ?? '').trim().slice(0, 40)
  const message = (params.message ?? '').trim().slice(0, 200)

  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: 'usd',
          unit_amount: pack.priceCents,
          product_data: { name: `${pack.name} gift, ${pack.minutes} minutes` },
        },
      },
    ],
    metadata: { kind: 'gift', packId: pack.id, fromName, toName, message },
    success_url: `${params.origin}/gift/thanks?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${params.origin}/gift`,
  })
  if (!session.url) throw new ApiError(502, 'upstream', 'Stripe did not return a checkout URL')
  return { url: session.url }
}

/**
 * Fulfill a paid checkout. Split out from the webhook so it can be exercised with a constructed
 * session (the webhook signature check needs a real secret). Idempotent per Stripe session id.
 */
export async function fulfillCheckout(checkout: CompletedCheckout): Promise<{ kind: string }> {
  if (checkout.paymentStatus !== 'paid') return { kind: 'unpaid' }
  const meta = checkoutMeta.parse(checkout.metadata ?? {})
  const amount = checkout.amountTotal ?? 0

  if (meta.kind === 'pack') {
    const pack = packById(meta.packId)
    const externalId = `stripe:${checkout.id}`
    const seen = await prisma.purchase.findUnique({ where: { externalId }, select: { id: true } })
    if (seen) return { kind: 'pack' }
    const device = await prisma.device.findUnique({ where: { code: meta.deviceCode } })
    if (!device) throw new ApiError(404, 'not_found', `Device ${meta.deviceCode} not found`)

    const feeCents = stripeFeeCents(amount)
    await prisma.$transaction(async (tx) => {
      const purchase = await tx.purchase.create({
        data: {
          deviceId: device.id,
          channel: 'stripe',
          packId: pack.id,
          seconds: pack.seconds,
          grossCents: amount,
          feeCents,
          netCents: amount - feeCents,
          externalId,
        },
      })
      await credit(device.id, 'purchase', pack.seconds, purchase.id, `stripe ${pack.id}`, undefined, tx)
      await tx.device.update({
        where: { id: device.id },
        data: { paying: true, lastPack: pack.id },
      })
    })
    return { kind: 'pack' }
  }

  const feeCents = stripeFeeCents(amount)
  await mintCode({
    packId: meta.packId,
    stripeSessionId: checkout.id,
    buyerEmail: checkout.customerEmail,
    fromName: meta.fromName,
    toName: meta.toName,
    message: meta.message,
    grossCents: amount,
    feeCents,
  })
  return { kind: 'gift' }
}

/** Verify a webhook body and act on it. Returns the Stripe event type, or 'duplicate'. */
export async function handleStripeEvent(rawBody: Buffer, signature: string): Promise<string> {
  const stripe = getStripe()
  if (!env.STRIPE_WEBHOOK_SECRET) {
    throw new ApiError(503, 'paused', 'Stripe webhook secret is not configured')
  }
  const event = stripe.webhooks.constructEvent(rawBody, signature, env.STRIPE_WEBHOOK_SECRET)

  try {
    await prisma.stripeEvent.create({ data: { id: event.id, type: event.type } })
  } catch {
    // A duplicate event id means we already processed this delivery.
    return 'duplicate'
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object
    await fulfillCheckout({
      id: session.id,
      amountTotal: session.amount_total,
      paymentStatus: session.payment_status,
      customerEmail: session.customer_details?.email ?? null,
      metadata: session.metadata,
    })
  } else if (event.type === 'charge.refunded') {
    const charge = event.data.object
    await raiseAlert('stripe_refund', `Stripe refund on charge ${charge.id}`, {
      chargeId: charge.id,
      amountRefunded: charge.amount_refunded,
    })
  }

  log.info(`[stripe] ${event.type} ${event.id}`)
  return event.type
}

export interface SessionStatus {
  metadata: CheckoutMetadata
  paymentStatus: string
}

/** For the /shop/thanks and /gift/thanks pages. Null when the session or its metadata is unreadable. */
export async function sessionStatus(sessionId: string): Promise<SessionStatus | null> {
  const stripe = getStripe()
  const session = await stripe.checkout.sessions.retrieve(sessionId)
  const parsed = checkoutMeta.safeParse(session.metadata ?? {})
  if (!parsed.success) return null
  return { metadata: parsed.data, paymentStatus: session.payment_status ?? 'unpaid' }
}
