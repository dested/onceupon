export const PROVIDERS = ['anthropic', 'openrouter', 'openai'] as const
export type Provider = (typeof PROVIDERS)[number]

export interface ModelOption {
  provider: Provider
  id: string
  label: string
  hint: string
}

/** Presets for the picker. Any other model id can be typed in; the provider decides the wire format. */
export const MODEL_OPTIONS: ModelOption[] = [
  { provider: 'anthropic', id: 'claude-haiku-4-5', label: 'Haiku 4.5', hint: 'fastest Anthropic model' },
  { provider: 'anthropic', id: 'claude-sonnet-5', label: 'Sonnet 5', hint: 'smarter, thinking off' },
  { provider: 'anthropic', id: 'claude-opus-5', label: 'Opus 5', hint: 'smartest, slowest' },
  { provider: 'openrouter', id: 'openai/gpt-oss-120b', label: 'gpt-oss-120b', hint: 'OpenRouter, fastest host wins' },
  { provider: 'openrouter', id: 'google/gemini-2.5-flash', label: 'Gemini 2.5 Flash', hint: 'OpenRouter' },
  { provider: 'openrouter', id: 'x-ai/grok-4-fast', label: 'Grok 4 Fast', hint: 'OpenRouter' },
  { provider: 'openai', id: 'gpt-5-mini', label: 'GPT-5 mini', hint: 'OpenAI direct, minimal reasoning' },
]

export const DEFAULT_MODEL: ModelOption = MODEL_OPTIONS[0] ?? {
  provider: 'anthropic',
  id: 'claude-haiku-4-5',
  label: 'Haiku 4.5',
  hint: '',
}

export function isProvider(s: string): s is Provider {
  return (PROVIDERS as readonly string[]).includes(s)
}

export interface Usage {
  input: number
  cacheRead: number
  cacheWrite: number
  output: number
  /** Provider-reported cost, when the provider reports one (OpenRouter does). */
  costUsd: number | null
}

/** USD per million tokens. Anthropic list prices; cache read 10%, cache write 125%. */
const PRICING: Array<{ match: RegExp; input: number; output: number; cacheRead: number; cacheWrite: number }> = [
  { match: /claude-haiku-4-5/, input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
  { match: /claude-sonnet-5/, input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  { match: /claude-sonnet-4-6/, input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  { match: /claude-opus-(5|4-8|4-7|4-6)/, input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
]

/** Cost of one call in USD, or null when no price is known and the provider did not say. */
export function estimateCost(model: string, usage: Usage): number | null {
  if (usage.costUsd !== null) return usage.costUsd
  const p = PRICING.find((row) => row.match.test(model))
  if (!p) return null
  return (
    (usage.input * p.input + usage.cacheRead * p.cacheRead + usage.cacheWrite * p.cacheWrite + usage.output * p.output) /
    1_000_000
  )
}
