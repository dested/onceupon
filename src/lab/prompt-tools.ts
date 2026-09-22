/**
 * The browser-side prompt tools. The pure helpers (applyPatch, validatePrompt, diffLines, sectionOf)
 * live in prompt-text.ts so the node CLI can import them without the Anthropic client; they are
 * re-exported here so existing importers are unchanged. countPromptTokens stays here because it needs
 * the client.
 */
import { labClient } from './judge'

export { applyPatch, validatePrompt, diffLines, sectionOf, type DiffLine } from './prompt-text'

export async function countPromptTokens(text: string, model: string): Promise<number> {
  const client = labClient()
  const res = await client.messages.countTokens({
    model,
    system: text,
    messages: [{ role: 'user', content: 'x' }],
  })
  return res.input_tokens
}
