// Cost of a relayed model call. Copied from root src/llm/models.ts (keep the PRICING rows in sync);
// the server needs the same table to meter cost of goods and enforce the per-device daily cap.

export interface Usage {
  input: number
  cacheRead: number
  cacheWrite: number
  output: number
  /** Provider-reported cost, when the provider reports one (OpenRouter does; Anthropic does not). */
  costUsd: number | null
}

/**
 * USD per million tokens, from Anthropic's pricing table (2026-09-20). cacheWrite is the 5-minute
 * write price, the only TTL this app uses. First match wins, so specific versions come before
 * broad families.
 */
const PRICING: Array<{ match: RegExp; input: number; output: number; cacheRead: number; cacheWrite: number }> = [
  { match: /claude-(fable|mythos)-5-1/, input: 10, output: 50, cacheRead: 0.25, cacheWrite: 12.5 },
  { match: /claude-(fable|mythos)-5/, input: 10, output: 50, cacheRead: 1, cacheWrite: 12.5 },
  { match: /claude-opus-5-5/, input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
  { match: /claude-opus-(5|4-8|4-7|4-6|4-5)/, input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  { match: /claude-opus-4/, input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 },
  { match: /claude-sonnet-5/, input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  { match: /claude-sonnet-4/, input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  { match: /claude-haiku-4-5/, input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
  { match: /claude-haiku-3-5/, input: 0.8, output: 4, cacheRead: 0.08, cacheWrite: 1 },
]

/** Cost of one call in USD, or null when no price is known and the provider did not report one. */
export function estimateCost(model: string, usage: Usage): number | null {
  if (usage.costUsd !== null) return usage.costUsd
  const p = PRICING.find((row) => row.match.test(model))
  if (!p) return null
  return (
    (usage.input * p.input +
      usage.cacheRead * p.cacheRead +
      usage.cacheWrite * p.cacheWrite +
      usage.output * p.output) /
    1_000_000
  )
}

/** USD to integer micro-dollars (USD * 1e6), the unit stored in CallLog.costMicros. */
export function usdToMicros(usd: number): number {
  return Math.round(usd * 1_000_000)
}
