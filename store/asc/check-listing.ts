#!/usr/bin/env bun
/**
 * Checks store/asc/listing.json against App Store Connect's limits and against store/listing.md
 * (every string must appear there verbatim). Exit 0 = clean, 1 = a problem (each one printed).
 *   bun store/asc/check-listing.ts
 */
import { readFileSync } from 'node:fs'
import { z } from 'zod'

const Listing = z.object({
  subtitle: z.string(),
  promotionalText: z.string(),
  description: z.string(),
  keywords: z.string(),
  supportUrl: z.string().url(),
  marketingUrl: z.string().url(),
  privacyPolicyUrl: z.string().url(),
  iaps: z.array(
    z.object({ productId: z.string(), id: z.string(), name: z.string(), description: z.string(), usd: z.string(), reviewNote: z.string() }),
  ),
})

const root = new URL('../../', import.meta.url).pathname
const listing = Listing.parse(JSON.parse(readFileSync(`${root}store/asc/listing.json`, 'utf8')))
const md = readFileSync(`${root}store/listing.md`, 'utf8')
const problems: string[] = []
const BANNED = /\b(claude|anthropic|haiku|sonnet|ai-powered)\b/i

function check(label: string, text: string, max: number): void {
  if (text.length > max) problems.push(`${label}: ${text.length} > ${max}`)
  if (!md.includes(text)) problems.push(`${label}: not in store/listing.md verbatim`)
  if (BANNED.test(text)) problems.push(`${label}: names a banned word (${BANNED.exec(text)?.[0] ?? ''})`)
}

check('subtitle', listing.subtitle, 30)
check('promotionalText', listing.promotionalText, 170)
check('description', listing.description, 4000)
check('keywords', listing.keywords, 100)
if (/, /.test(listing.keywords)) problems.push('keywords: space after a comma')
for (const iap of listing.iaps) {
  check(`${iap.productId} name`, iap.name, 30)
  check(`${iap.productId} description`, iap.description, 45)
}
if (listing.iaps.length !== 3) problems.push(`iaps: expected 3, got ${listing.iaps.length}`)

for (const p of problems) console.log(`FAIL ${p}`)
console.log(problems.length === 0 ? 'listing ok' : `${problems.length} problem(s)`)
process.exit(problems.length === 0 ? 0 : 1)
