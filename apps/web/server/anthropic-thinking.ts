import type Anthropic from '@anthropic-ai/sdk'

interface Params {
  thinking?: Anthropic.Messages.ThinkingConfigParam
  output_config?: Anthropic.Messages.OutputConfig
}

/**
 * The thinking setting that gets the first drawing token soonest, per model (probed 2026-09-28):
 * - Sonnet 5.5 refuses `disabled` (400); its lowest setting is `between_tools` (no thinking without tools).
 * - Opus 5.5 and Fable/Mythos 5.1 refuse both; adaptive at low effort, thinking not returned.
 * - Sonnet 5, Opus 5, Fable 5 and the 4.6+ models accept `disabled`. Haiku 4.5 does not think by default.
 * Mirror of the studio's src/llm/anthropic-thinking.ts (BYO provider); change both together.
 */
export function fastThinking(model: string): Params {
  if (/sonnet-5-5/.test(model)) return { thinking: BETWEEN_TOOLS }
  if (/opus-5-5|fable-5-1|mythos-5-1/.test(model)) {
    return { thinking: { type: 'adaptive', display: 'omitted' }, output_config: { effort: 'low' } }
  }
  if (/fable-5|mythos-5|sonnet-5|opus-5|opus-4-8|opus-4-7|sonnet-4-6|opus-4-6/.test(model)) {
    return { thinking: { type: 'disabled' } }
  }
  return {}
}

/**
 * Typed boundary: SDK 0.126 predates `between_tools` (0.129 types it, published 2026-09-28; bun's
 * 3-day minimum release age holds the upgrade until 2026-10-01). Drop this cast after upgrading.
 */
const BETWEEN_TOOLS = { type: 'between_tools' } as unknown as Anthropic.Messages.ThinkingConfigParam
