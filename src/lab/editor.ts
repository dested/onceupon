/**
 * The prompt editor: given the current prompt, one round of judged results (each fault carrying a
 * general rule), what earlier edits tried, and a token budget, it proposes ONE find/replace patch
 * that should raise picture quality across many subjects. Opus 5.5 by default; structured output is
 * a PromptPatch. Opus 5.5 cannot disable thinking, so no thinking param is sent.
 */
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
// zodOutputFormat is built against zod/v4; types.ts uses the classic (v3) surface, so the patch
// output shape is re-declared here on the v4 surface. Keep it in step with promptPatchSchema.
import * as z4 from 'zod/v4'
import { estimateCost } from '~/llm/models'
import { labClient, toUsage } from './judge'
import {
  type CaseResult,
  type Issue,
  type LabCase,
  type PatchAttempt,
  type PromptPatch,
  promptPatchSchema,
  type RoundSummary,
} from './types'

const promptPatchV4 = z4.object({
  rationale: z4.string(),
  note: z4.string(),
  edits: z4.array(z4.object({ find: z4.string().min(1), replace: z4.string() })).min(1),
})

export interface EditorInput {
  prompt: string
  promptVersion: number
  round: RoundSummary
  results: CaseResult[]
  cases: LabCase[]
  attempts: PatchAttempt[]
  tokensNow: number
  tokensMax: number
  model: string
  /** Appended when a previous patch failed to apply/validate, so the retry does not repeat it. */
  previousFailure?: string
  /** The product owner's own words about this picture; weighed above the judge's issues. */
  userNotes?: string
}

const EDITOR_SYSTEM = `You maintain the system prompt of a crayon-drawing model (Claude Sonnet 5, thinking off, streaming) inside a picture-book app for four-year-olds. The prompt teaches a tiny drawing language (ops) and a cookbook of recipes; the app parses each output line as it streams and draws it. You receive the current prompt, one round of test results (each phrase with its scores and the judge's issues, each issue carrying a general rule), what earlier edits tried and whether they helped, and a token budget.

Propose ONE set of edits that raises picture quality across MANY subjects, not just the failures listed. Think like this: group the issues by kind and by what body of knowledge the drawer lacked (attachment of parts, proportions, where things stand, layering order, when to use mirror, scene clutter). The most common kinds show where the prompt is weak. Write rules that generalize (about heads, limbs, wings, wheels, roofs: relations between shapes), placed where the drawer will read them at the right moment (# How to draw well for global rules; the cookbook for recipe fixes). Fix a cookbook recipe only when a category fails systematically, and then fix the pattern the recipes share (for example one "four-legged animal" template that the cat, dog and horse recipes all follow) rather than patching one animal.

Hard constraints:
- Never change the "# Ops" section: the parser is fixed and every op, argument and default listed there is what the app understands. Do not invent ops or arguments.
- Do not change the "# For a small child" section or the skip op.
- Every cookbook fragment and every "# Example" line must be valid ops syntax: integers only, local coordinates, \`mirror\` for pairs, \`M x y L x y Q cx cy x y C ... Z\` paths, no trailing punctuation inside an ops fragment. The example story must still parse line by line.
- Tokens are latency: the prompt is read on every call. Stay under the budget. Cut, merge or tighten weak text before adding; prefer one sharp sentence to three soft ones. Never pad.
- Do not repeat an edit that was reverted; try a different lever.
- Keep the prompt's voice: short imperative bullets, concrete numbers.

Output exact find/replace edits. \`find\` is copied verbatim from the current prompt and must occur exactly once; make it a whole line or bullet so it is unique. To insert, find the line before and replace with itself plus the new line. To delete, replace with an empty string. rationale: what the round's failures have in common and why these edits fix the class. note: one line for the version log, under 80 characters.`

function num(n: number | null, digits = 1): string {
  return n === null ? '?' : n.toFixed(digits)
}

function pct(n: number | null): string {
  return n === null ? '?' : `${Math.round(n * 100)}`
}

function recordToPairs(rec: Record<string, number>, digits: number): string {
  const entries = Object.entries(rec)
  if (entries.length === 0) return 'none'
  return entries
    .map(([k, v]) => `${k}: ${Number.isInteger(v) && digits === 0 ? v : v.toFixed(digits)}`)
    .join(', ')
}

function majorIssueText(issues: Issue[]): string {
  const majors = issues.filter((i) => i.severity === 'major')
  if (majors.length === 0) return '(no major issues)'
  return majors.map((i) => `${i.kind}: ${i.what} -> ${i.rule}`).join(' ; ')
}

function buildUserText(i: EditorInput): string {
  const r = i.round
  const summary =
    `ROUND SUMMARY: mean overall ${num(r.meanOverall)}, mean recognizable ${num(r.meanRecognizable)}, ` +
    `blind-yes ${pct(r.blindYesRate)}%, major issues ${r.majorIssues} over ${r.done} cases; ` +
    `by kind: ${recordToPairs(r.byKind, 0)}; by category: ${recordToPairs(r.byCategory, 1)}`

  const rows = i.results
    .map((res) => ({
      phrase: res.draw.phrase,
      overall: res.critique?.overall ?? null,
      recognizable: res.critique?.recognizable ?? null,
      blind: res.critique?.blindGuess ?? '',
      issues: res.critique?.issues ?? [],
      err: res.critiqueError,
    }))
    .sort((a, b) => (a.overall ?? -1) - (b.overall ?? -1))

  const detailed: string[] = []
  const fine: string[] = []
  for (const row of rows) {
    if (row.overall === null) {
      detailed.push(`- "${row.phrase}" | err | - | - | judge error: ${row.err ?? 'unknown'}`)
      continue
    }
    if (row.overall >= 80) {
      fine.push(`fine: ${row.phrase} (${row.overall})`)
      continue
    }
    detailed.push(
      `- "${row.phrase}" | ${row.overall} | ${row.recognizable ?? '?'} | "${row.blind}" | ${majorIssueText(row.issues)}`
    )
  }

  const results = [...detailed, ...fine].join('\n')

  const previousEdits =
    i.attempts.length === 0
      ? 'none yet'
      : i.attempts
          .map((a) => {
            const status = a.kept ? 'kept' : 'reverted'
            const delta = a.delta === null ? '?' : `${a.delta >= 0 ? '+' : ''}${a.delta.toFixed(1)}`
            return `- v${a.version} (${status}, ${delta}): ${a.note} — ${a.rationale}`
          })
          .join('\n')

  const parts = [
    `CURRENT PROMPT (version ${i.promptVersion}, ${i.tokensNow} tokens; budget ${i.tokensMax} tokens):`,
    '<<<',
    i.prompt,
    '>>>',
    '',
    summary,
    '',
    'RESULTS (worst first; each: phrase | overall | recognizable | blind guess | major issues as kind: what -> rule):',
    results,
    '',
    ...(i.userNotes
      ? [
          `PRODUCT OWNER NOTES (they looked at this picture themselves; weigh these above the judge's issues): ${i.userNotes}`,
          '',
        ]
      : []),
    'PREVIOUS EDITS:',
    previousEdits,
  ]
  if (i.previousFailure) {
    parts.push('', `PREVIOUS ATTEMPT FAILED: ${i.previousFailure}`)
  }
  return parts.join('\n')
}

export async function proposePatch(
  i: EditorInput
): Promise<{ patch: PromptPatch; costUsd: number | null }> {
  const client = labClient()
  // Streamed: a 45-case round can need a long patch plus thinking, and the SDK requires streaming
  // for a large max_tokens. The schema is only advisory on the wire (see judge.ts), so the raw text
  // is parsed here and validated with the classic zod schema instead of trusting parsed_output.
  const msg = await client.messages
    .stream({
      model: i.model,
      max_tokens: 32000,
      output_config: { effort: 'high', format: zodOutputFormat(promptPatchV4) },
      system: EDITOR_SYSTEM,
      messages: [{ role: 'user', content: buildUserText(i) }],
    })
    .finalMessage()
  const text = msg.content
    .map((b) => (b.type === 'text' ? b.text : ''))
    .join('')
    .trim()
  const costUsd = estimateCost(i.model, toUsage(msg.usage))
  const parsed = parsePatchText(text)
  if (!parsed.ok) {
    throw new Error(
      `editor output unusable (stop ${msg.stop_reason}, ${msg.usage.output_tokens} output tokens): ${parsed.error}; text starts ${JSON.stringify(text.slice(0, 160))}`
    )
  }
  return { patch: parsed.patch, costUsd }
}

/** JSON.parse the model text (or the first {...} block inside it) and validate it as a PromptPatch. */
function parsePatchText(
  text: string
): { ok: true; patch: PromptPatch } | { ok: false; error: string } {
  const candidates = [text]
  const first = text.indexOf('{')
  const last = text.lastIndexOf('}')
  if (first >= 0 && last > first) candidates.push(text.slice(first, last + 1))
  let lastError = 'no JSON object in the text'
  for (const c of candidates) {
    let raw: unknown
    try {
      raw = JSON.parse(c)
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e)
      continue
    }
    const res = promptPatchSchema.safeParse(raw)
    if (res.success) return { ok: true, patch: res.data }
    lastError = res.error.issues.map((x) => `${x.path.join('.')}: ${x.message}`).join('; ')
  }
  return { ok: false, error: lastError }
}
