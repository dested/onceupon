import { z } from 'zod'
import { BRAND } from '../../../packages/shared/src/brand'

// Parsed once at import: a bad environment throws here and the process never boots.
// Fields with a derived default (PUBLIC_ORIGIN, DEVICE_TOKEN_SECRET) are resolved in a second pass
// below, because zod's .default() cannot read a sibling field.
const rawSchema = z.object({
  DATABASE_URL: z.string().url(),
  BETTER_AUTH_SECRET: z.string().min(32, 'BETTER_AUTH_SECRET must be at least 32 chars'),
  BETTER_AUTH_URL: z.string().url().default('http://localhost:7720'),
  PUBLIC_ORIGIN: z.string().url().optional(),
  ADMIN_EMAILS: z.string().default(''),
  DEVICE_TOKEN_SECRET: z
    .string()
    .min(32, 'DEVICE_TOKEN_SECRET must be at least 32 chars')
    .optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  DEEPGRAM_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  RESEND_API_KEY: z.string().optional(),
  ALERT_EMAIL: z.string().optional(),
  APPLE_BUNDLE_ID: z.string().default(BRAND.bundleId),
  APPLE_APP_APPLE_ID: z.coerce.number().optional(),
  APPLE_ENVIRONMENT: z.enum(['Sandbox', 'Production']).default('Sandbox'),
  STUDIO_DIST: z.string().default('../../dist-hosted'),
  CORS_ORIGINS: z.string().default('http://localhost:7710,http://localhost:7711'),
})

const parsed = rawSchema.parse(process.env)

const list = (raw: string, lower: boolean): string[] =>
  raw
    .split(',')
    .map((s) => (lower ? s.trim().toLowerCase() : s.trim()))
    .filter((s) => s.length > 0)

/** Lowercased, trimmed, non-empty admin emails allowed to create an admin account. */
export const adminEmails: string[] = list(parsed.ADMIN_EMAILS, true)

/** Allowed CORS origins for the studio (left as written; origins compare case-sensitively). */
export const corsOrigins: string[] = list(parsed.CORS_ORIGINS, false)

export const env = {
  ...parsed,
  // The public website/API origin; the studio is served at `${PUBLIC_ORIGIN}/app/`.
  PUBLIC_ORIGIN: parsed.PUBLIC_ORIGIN ?? parsed.BETTER_AUTH_URL,
  // A distinct secret for device tokens; derived from the auth secret when unset (always ≥ 32).
  DEVICE_TOKEN_SECRET: parsed.DEVICE_TOKEN_SECRET ?? `${parsed.BETTER_AUTH_SECRET}:device`,
}
