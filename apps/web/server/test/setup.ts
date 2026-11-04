/**
 * Imported FIRST by every server test (ES modules evaluate imports in order, so this runs before
 * server/env.ts parses process.env). Pins the tests to a local database and a fake Anthropic: no
 * test can reach the database in apps/web/.env or the real API.
 */
const url = process.env.TEST_DATABASE_URL ?? 'postgresql://postgres@localhost:5432/onceupon_srv'
const host = new URL(url).hostname
if (host !== 'localhost' && host !== '127.0.0.1') {
  throw new Error(`server tests only run against a local database (got host ${host})`)
}
process.env.DATABASE_URL = url
process.env.BETTER_AUTH_SECRET = 'test-secret-test-secret-test-secret-0000'
process.env.BETTER_AUTH_URL = 'http://localhost:7730'
process.env.ANTHROPIC_API_KEY = 'test-key'
for (const key of ['ALERT_EMAIL', 'RESEND_API_KEY', 'STRIPE_SECRET_KEY', 'DEEPGRAM_API_KEY', 'OPENAI_API_KEY']) {
  delete process.env[key]
}
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test'
process.env.NO_COLOR = '1'
// The fake upstream (fake-anthropic.ts) listens here; the SDK reads ANTHROPIC_BASE_URL itself.
export const FAKE_ANTHROPIC_PORT = 7739
process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${FAKE_ANTHROPIC_PORT}`
