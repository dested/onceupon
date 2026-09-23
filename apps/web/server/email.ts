import { env } from './env'
import { log } from './logger'
import { BRAND } from '../../../packages/shared/src/brand'

export interface EmailInput {
  to: string
  subject: string
  text: string
  html?: string
}

/**
 * Transactional email via the Resend REST API. Only used for operator alerts (there are no user
 * accounts to email). Without RESEND_API_KEY it logs and returns false so callers stay happy in dev.
 */
export async function sendEmail(input: EmailInput): Promise<boolean> {
  if (!env.RESEND_API_KEY) {
    log.info(`[email skipped] ${input.subject} -> ${input.to}`)
    return false
  }
  const body: Record<string, string> = {
    from: `${BRAND.name} <noreply@${BRAND.domain}>`,
    to: input.to,
    subject: input.subject,
    text: input.text,
  }
  if (input.html) body.html = input.html
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${env.RESEND_API_KEY}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      const detail = await res.text()
      log.error(`[email] resend ${res.status}: ${detail.slice(0, 200)}`)
      return false
    }
    return true
  } catch (err) {
    log.error(`[email] send failed: ${err instanceof Error ? err.message : String(err)}`)
    return false
  }
}
