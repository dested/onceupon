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
 * - Haiku 5.5 thinks adaptively at effort medium by default (kit first ink ~2.7 s). Probed 2026-11-04 on the
 *   kit quick set, 2x8 calls each: `disabled` first ink p50 0.80 s, steady (max 1.2 s), ~40 output tokens;
 *   adaptive + effort low p50 0.80 s too but 2.7-4.4 s spikes on story beats and 4-5x the output.
 *   Then the kit prompt bench (haiku2, 2026-11-04): with `disabled` Haiku still answers 0-2 hard beats per 38 with
 *   nothing drawn; adaptive + effort low drew every beat, first ink p50 ~0.8 s, max 5.0 s on the final prompt
 *   (the relay cuts a call with no first delta at 8 s). A short wait beats a blank page, so adaptive low.
 * Mirror of the studio's src/llm/anthropic-thinking.ts (BYO provider); change both together.
 */
export function fastThinking(model: string): Params {
  if (/sonnet-5-5/.test(model)) return { thinking: { type: 'between_tools' } }
  if (/opus-5-5|fable-5-1|mythos-5-1|haiku-5-5/.test(model)) {
    return { thinking: { type: 'adaptive', display: 'omitted' }, output_config: { effort: 'low' } }
  }
  if (/fable-5|mythos-5|sonnet-5|opus-5|opus-4-8|opus-4-7|sonnet-4-6|opus-4-6/.test(model)) {
    return { thinking: { type: 'disabled' } }
  }
  return {}
}
