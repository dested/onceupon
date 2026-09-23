import express from 'express'
import Stripe from 'stripe'
import { z } from 'zod'
import { handleStripeEvent } from './stripe'
import { handleNotification } from './apple'
import { raiseAlert } from './alerts'
import { log } from './logger'

/**
 * Payment webhooks with their own body parsers. Mount at the app root BEFORE express.json():
 * Stripe needs the raw bytes to verify the signature; Apple posts a JSON envelope.
 */
export const webhooksRouter = express.Router()

const appleBody = z.object({ signedPayload: z.string() })

webhooksRouter.post(
  '/api/stripe/webhook',
  express.raw({ type: '*/*' }),
  async (req: express.Request, res: express.Response) => {
    const signature = req.headers['stripe-signature']
    if (typeof signature !== 'string') {
      res.status(400).json({ error: { code: 'bad_request' } })
      return
    }
    try {
      const type = await handleStripeEvent(req.body, signature)
      log.info(`[webhook] stripe ${type}`)
      res.json({ received: true })
    } catch (err) {
      const isSignature = err instanceof Stripe.errors.StripeSignatureVerificationError
      res.status(isSignature ? 400 : 500).json({ error: { code: 'webhook_failed' } })
      await raiseAlert(
        'webhook_failure',
        `Stripe webhook failed: ${err instanceof Error ? err.message : String(err)}`
      )
    }
  }
)

webhooksRouter.post(
  '/api/apple/notifications',
  express.json({ limit: '1mb' }),
  async (req: express.Request, res: express.Response) => {
    const parsed = appleBody.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: { code: 'bad_request' } })
      return
    }
    try {
      const type = await handleNotification(parsed.data.signedPayload)
      log.info(`[webhook] apple ${type}`)
      res.json({ ok: true })
    } catch (err) {
      // Apple retries on a non-2xx, which is what we want on a transient verification failure.
      res.status(401).json({ error: { code: 'unauthorized' } })
      await raiseAlert(
        'webhook_failure',
        `Apple notification failed: ${err instanceof Error ? err.message : String(err)}`
      )
    }
  }
)
