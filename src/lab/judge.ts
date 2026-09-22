/**
 * The critique half of a case: a blind guess (a model naming the picture without the child's words),
 * then the art-director judge that scores the drawing and files each fault as a general drawing rule.
 * Both go to Opus 5.5 by default; the judge returns a structured JudgeOutput via zod output format.
 */
import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
// The SDK's zodOutputFormat is built against zod/v4; the shared schemas in types.ts use the classic
// (v3) surface, so we re-declare the judge's output shape here on the v4 surface at this one boundary.
// It must stay in step with judgeOutputSchema in types.ts.
import * as z4 from 'zod/v4'
// The lenient repair schema uses zod's classic (v3) surface, whose `.catch` per-field fallbacks let a
// slightly-off judge response be coerced into a valid JudgeOutput instead of thrown away.
import { z } from 'zod'
import { parseOpsLine } from '~/llm/ops-dsl'
import { estimateCost, type Usage } from '~/llm/models'
import { appStore } from '~/story/store'
import { ISSUE_KINDS, type JudgeOutput, type LabCase } from './types'

const subscoresV4 = z4.object({
  anatomy: z4.number().int().min(1).max(5),
  proportion: z4.number().int().min(1).max(5),
  placement: z4.number().int().min(1).max(5),
  color: z4.number().int().min(1).max(5),
  composition: z4.number().int().min(1).max(5),
  simplicity: z4.number().int().min(1).max(5),
})

const issueV4 = z4.object({
  severity: z4.enum(['major', 'minor']),
  kind: z4.enum(ISSUE_KINDS),
  what: z4.string(),
  evidence: z4.string(),
  rule: z4.string(),
})

const judgeOutputV4 = z4.object({
  seen: z4.string(),
  blindMatch: z4.enum(['yes', 'partial', 'no']),
  recognizable: z4.number().int().min(1).max(5),
  subscores: subscoresV4,
  overall: z4.number().int().min(0).max(100),
  issues: z4.array(issueV4),
  praise: z4.array(z4.string()),
})

const DEFAULT_JUDGE: JudgeOutput = {
  seen: '',
  blindMatch: 'partial',
  recognizable: 1,
  subscores: { anatomy: 1, proportion: 1, placement: 1, color: 1, composition: 1, simplicity: 1 },
  overall: 0,
  issues: [],
  praise: [],
}

/** A number coerced to an integer inside [min, max]; anything unparseable becomes min. */
const clampInt = (min: number, max: number) =>
  z
    .preprocess((v) => {
      const n = typeof v === 'number' ? v : Number(v)
      if (!Number.isFinite(n)) return min
      return Math.min(max, Math.max(min, Math.round(n)))
    }, z.number())
    .catch(min)

const lenientSub = clampInt(1, 5)

const lenientIssue = z
  .object({
    severity: z.enum(['major', 'minor']).catch('minor'),
    kind: z.enum(ISSUE_KINDS).catch('other'),
    what: z.string().catch(''),
    evidence: z.string().catch(''),
    rule: z.string().catch(''),
  })
  .catch({ severity: 'minor', kind: 'other', what: '', evidence: '', rule: '' })

/**
 * Repair a judge response leniently: the model is constrained by the schema, but Opus occasionally
 * emits a kind/severity/blindMatch outside the enum or a number out of range. Every field carries a
 * `.catch` fallback (unknown kind -> other, unknown severity -> minor, unknown blindMatch -> partial,
 * numbers clamped, missing arrays -> []) so a near-miss scores instead of failing the case.
 */
const lenientJudge = z
  .object({
    seen: z.string().catch(''),
    blindMatch: z.enum(['yes', 'partial', 'no']).catch('partial'),
    recognizable: clampInt(1, 5),
    subscores: z
      .object({
        anatomy: lenientSub,
        proportion: lenientSub,
        placement: lenientSub,
        color: lenientSub,
        composition: lenientSub,
        simplicity: lenientSub,
      })
      .catch(DEFAULT_JUDGE.subscores),
    overall: clampInt(0, 100),
    issues: z.array(lenientIssue).catch([]),
    praise: z.array(z.string().catch('')).catch([]),
  })
  .catch(DEFAULT_JUDGE)

/** JSON.parse the model's text, then coerce it into a valid JudgeOutput. Throws only if not JSON. */
function repairJudgeOutput(text: string): JudgeOutput {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error('judge did not return JSON')
  }
  return lenientJudge.parse(parsed)
}

let judgeSchemaLogged = false

const NO_KEY =
  'no Anthropic key: set VITE_ANTHROPIC_API_KEY in .env.local or paste it in the app Settings'

/** The one Anthropic client the lab talks to (browser-direct, localhost only). Throws if no key. */
export function labClient(): Anthropic {
  const apiKey = appStore.get().settings.keys.anthropic
  if (!apiKey) throw new Error(NO_KEY)
  return new Anthropic({ apiKey, dangerouslyAllowBrowser: true })
}

interface SdkUsage {
  input_tokens: number
  output_tokens: number
  cache_read_input_tokens: number | null
  cache_creation_input_tokens: number | null
}

/** Map the SDK's usage block to our Usage (costUsd left null so estimateCost prices it). */
export function toUsage(u: SdkUsage): Usage {
  return {
    input: u.input_tokens,
    cacheRead: u.cache_read_input_tokens ?? 0,
    cacheWrite: u.cache_creation_input_tokens ?? 0,
    output: u.output_tokens,
    costUsd: null,
  }
}

async function toBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let binary = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    const slice = bytes.subarray(i, i + CHUNK)
    binary += String.fromCharCode(...slice)
  }
  return btoa(binary)
}

function imageBlock(data: string): Anthropic.ImageBlockParam {
  return { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data } }
}

const BLIND_TEXT =
  "This is a child's crayon drawing from a picture-book app. In at most six words, name the main thing drawn and, if there is one, what it is doing. Answer with the words only."

export async function blindGuess(
  image: Blob,
  model: string
): Promise<{ guess: string; costUsd: number | null }> {
  const client = labClient()
  const data = await toBase64(image)
  const msg = await client.messages.create({
    model,
    max_tokens: 60,
    output_config: { effort: 'low' },
    messages: [{ role: 'user', content: [imageBlock(data), { type: 'text', text: BLIND_TEXT }] }],
  })
  const guess = msg.content
    .map((b) => (b.type === 'text' ? b.text : ''))
    .join('')
    .trim()
  return { guess, costUsd: estimateCost(model, toUsage(msg.usage)) }
}

/** Re-annotate the raw ops with the parse error each failed line produced, for the judge to read. */
function annotateOps(ops: string): string {
  return ops
    .split('\n')
    .map((line) => {
      const res = parseOpsLine(line)
      return res.ok ? line : `PARSE ERROR: ${res.error} | ${line}`
    })
    .join('\n')
}

function judgeText(c: LabCase, ops: string, blind: string): string {
  const needs = c.expect.map((e) => `- ${e}`).join('\n')
  return [
    `CHILD'S WORDS: ${c.phrase}`,
    'A RECOGNIZABLE DRAWING NEEDS:',
    needs,
    `BLIND GUESS (another model, words unseen): ${blind}`,
    'OPS THE DRAWER EMITTED:',
    annotateOps(ops),
  ].join('\n')
}

const JUDGE_SYSTEM = `You are the art director of a picture-book app for four-year-olds. A drawing model turns a child's words into a crayon picture using a tiny language called ops. You receive the child's words, what a recognizable drawing needs, the exact ops the drawer wrote, a blind guess from a model that saw the picture without the words, and the picture itself.

Judge the PICTURE the way a four-year-old and their parent would: is it instantly that thing? Charm beats accuracy. Bold simple shapes are the goal, not detail. But anatomy must read: the right parts, the right count, in the right place, attached to what they belong to, feet on the ground, inside the page, not overlapping into mush.

Paper conventions so you can read the ops: paper 1200 wide, 620 tall, y goes down, ground y=525. \`ent <id> <x> <y>\` puts the anchor at the feet. \`draw <id>.<shape>\` coordinates are LOCAL to that anchor, negative y is up. \`mirror\` also draws the x-mirror. Shapes stack in order, later on top. \`face <id> <shape>\` puts eyes and a mouth on that shape. A circle is \`cx cy r\`, an oval \`cx cy rx ry\`, a rect \`x y w h\` from its top-left corner.

Method:
1. Look at the picture first and say what you see (\`seen\`), then compare with the child's words and the needs list.
2. For each thing wrong, find the ops line(s) that caused it and explain in coordinates, e.g. "ears drawn at local y -120 but the head circle spans y -235..-151, so the ears float under the chin". Attribute, do not guess: if the ops are fine but the picture is not, say so (renderer issue) under kind \`other\`.
3. Classify each issue with one kind: missing-part, misplaced-part, wrong-count, wrong-proportion, wrong-color, floating (parts detached or feet off the ground), off-page, bad-overlap (a part hidden or merged by another), too-complex (shape spam or fussy detail), too-small, too-big, unrecognizable, wrong-subject, extra-thing (unasked scenery or props that distract), parse-error, other. Major = a four-year-old would notice or the thing stops reading as itself; minor = a parent would notice.
4. For every issue write \`rule\`: ONE sentence, a general drawing rule about ANY subject that would have prevented this class of mistake. Bad: "put the horse's ears on its head". Good: "Ears attach to the top edge of the head shape: their base y equals the head's top y and their x stays within the head's radius."
5. Praise: one to three things that worked and must not be lost.

Scores. recognizable 1-5: 5 = a four-year-old names it at once; 4 = names it after a beat; 3 = you can tell once you know the word; 2 = only with the word and goodwill; 1 = no. subscores 1-5: anatomy (parts, counts, attachment), proportion (relative sizes), placement (on the ground, in the page, sensible layout, no bad overlap), color (sensible for the thing, outline plus fill, reads on cream paper), composition (big enough, centered, uncluttered), simplicity (few bold shapes; penalize fussiness and shape spam). overall 0-100: your honest score of the picture for the book, recognizability weighing most, then anatomy and placement. blindMatch: yes if the blind guess names the same thing (and the same action when there is one), partial if a close cousin or the thing without the action, no otherwise. Be strict and consistent: a 90 is a picture you would print.`

export async function judgeCase(input: {
  c: LabCase
  ops: string
  image: Blob
  blindGuess: string
  model: string
}): Promise<{ output: JudgeOutput; costUsd: number | null }> {
  const client = labClient()
  const data = await toBase64(input.image)
  const format = zodOutputFormat(judgeOutputV4)
  if (!judgeSchemaLogged) {
    judgeSchemaLogged = true
    console.debug('[lab] judge output_config schema:', JSON.stringify(format.schema))
  }

  // create() (not parse()) sends the schema to constrain the model but returns the raw text, so a
  // response the SDK's strict parser would reject can still be repaired here instead of thrown away.
  const attempt = async (): Promise<{ output: JudgeOutput; costUsd: number | null }> => {
    const msg = await client.messages.create({
      model: input.model,
      max_tokens: 6000,
      output_config: { effort: 'high', format },
      system: JUDGE_SYSTEM,
      messages: [
        {
          role: 'user',
          content: [
            imageBlock(data),
            { type: 'text', text: judgeText(input.c, input.ops, input.blindGuess) },
          ],
        },
      ],
    })
    const text = msg.content
      .map((b) => (b.type === 'text' ? b.text : ''))
      .join('')
      .trim()
    return {
      output: repairJudgeOutput(text),
      costUsd: estimateCost(input.model, toUsage(msg.usage)),
    }
  }

  // One retry on a thrown error (network, or text that is not JSON at all) before giving up.
  try {
    return await attempt()
  } catch {
    return await attempt()
  }
}
