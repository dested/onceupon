/**
 * Shared contracts for the drawing lab (lab.html): the word -> picture -> critique -> prompt-patch
 * hill climb. Everything that crosses the disk boundary (`lab/`) is a zod schema here so reads are
 * validated. Owned by the spec in plans/2026-09-22-drawing-lab.md.
 */
import { z } from 'zod'

export const TIERS = ['subject', 'action'] as const
export type Tier = (typeof TIERS)[number]

export const labCaseSchema = z.object({
  /** Stable slug, used in file names: `horse`, `dog-jumps-fence`. */
  id: z.string().regex(/^[a-z0-9-]+$/),
  /** Exactly what the drawer receives as NEW STORY. Subjects are the bare word a child would type. */
  phrase: z.string().min(1),
  tier: z.enum(TIERS),
  category: z.string(),
  /** What a recognizable crayon drawing of this must have (for the judge). Short, physical, checkable. */
  expect: z.array(z.string()),
})
export type LabCase = z.infer<typeof labCaseSchema>

export const promptMetaSchema = z.object({
  version: z.number().int().nonnegative(),
  parent: z.number().int().nonnegative().nullable(),
  createdAt: z.string(),
  /** One line for the version list. */
  note: z.string(),
  /** Why (editor's reasoning, or "seeded from src/llm/ops-prompt.ts"). */
  rationale: z.string(),
  /** Sonnet 5 count_tokens of the prompt as a system block; null until counted. */
  tokens: z.number().int().nullable(),
  source: z.enum(['seed', 'editor', 'manual']),
})
export type PromptMeta = z.infer<typeof promptMetaSchema>

export const usageSchema = z.object({
  input: z.number(),
  cacheRead: z.number(),
  cacheWrite: z.number(),
  output: z.number(),
  costUsd: z.number().nullable(),
})

export const drawLineSchema = z.object({ line: z.string(), ok: z.boolean(), error: z.string().nullable() })
export type DrawLine = z.infer<typeof drawLineSchema>

export const drawResultSchema = z.object({
  caseId: z.string(),
  phrase: z.string(),
  promptVersion: z.number().int(),
  /** 0-based sample index when a case is drawn more than once per round. */
  sample: z.number().int().nonnegative(),
  model: z.string(),
  /** Raw streamed text, newline separated ops exactly as the model wrote them. */
  ops: z.string(),
  lines: z.array(drawLineSchema),
  parseErrors: z.number().int(),
  firstTokenMs: z.number().nullable(),
  doneMs: z.number().nullable(),
  usage: usageSchema.nullable(),
  costUsd: z.number().nullable(),
  error: z.string().nullable(),
  /** Repo-relative path of the rendered picture (1280x800 JPEG). */
  imagePath: z.string(),
  drawnAt: z.string(),
})
export type DrawResult = z.infer<typeof drawResultSchema>

export const ISSUE_KINDS = [
  'missing-part',
  'misplaced-part',
  'wrong-count',
  'wrong-proportion',
  'wrong-color',
  'floating',
  'off-page',
  'bad-overlap',
  'too-complex',
  'too-small',
  'too-big',
  'unrecognizable',
  'wrong-subject',
  'extra-thing',
  'parse-error',
  'other',
] as const
export type IssueKind = (typeof ISSUE_KINDS)[number]

export const issueSchema = z.object({
  severity: z.enum(['major', 'minor']),
  kind: z.enum(ISSUE_KINDS),
  /** What is wrong, in the picture. */
  what: z.string(),
  /** The ops line(s) and coordinates that caused it. */
  evidence: z.string(),
  /** A general drawing rule (any subject) that would have prevented it. */
  rule: z.string(),
})
export type Issue = z.infer<typeof issueSchema>

export const subscoresSchema = z.object({
  anatomy: z.number().int().min(1).max(5),
  proportion: z.number().int().min(1).max(5),
  placement: z.number().int().min(1).max(5),
  color: z.number().int().min(1).max(5),
  composition: z.number().int().min(1).max(5),
  simplicity: z.number().int().min(1).max(5),
})
export type Subscores = z.infer<typeof subscoresSchema>
export const SUBSCORE_KEYS = ['anatomy', 'proportion', 'placement', 'color', 'composition', 'simplicity'] as const

/** What the judge model returns (structured output). Extra fields are added by the harness in `critiqueSchema`. */
export const judgeOutputSchema = z.object({
  /** What the judge sees, one or two sentences, before comparing with the expectations. */
  seen: z.string(),
  blindMatch: z.enum(['yes', 'partial', 'no']),
  recognizable: z.number().int().min(1).max(5),
  subscores: subscoresSchema,
  overall: z.number().int().min(0).max(100),
  issues: z.array(issueSchema),
  praise: z.array(z.string()),
})
export type JudgeOutput = z.infer<typeof judgeOutputSchema>

export const critiqueSchema = judgeOutputSchema.extend({
  /** What a second model named the picture without seeing the words. */
  blindGuess: z.string(),
  judgeModel: z.string(),
  judgeCostUsd: z.number().nullable(),
  judgedAt: z.string(),
})
export type Critique = z.infer<typeof critiqueSchema>

export const caseResultSchema = z.object({
  draw: drawResultSchema,
  critique: critiqueSchema.nullable(),
  critiqueError: z.string().nullable(),
})
export type CaseResult = z.infer<typeof caseResultSchema>

export const roundSummarySchema = z.object({
  /** `r000`, `r001`, ... Also the directory name under lab/runs/. */
  id: z.string(),
  n: z.number().int(),
  promptVersion: z.number().int(),
  startedAt: z.string(),
  finishedAt: z.string().nullable(),
  /** Case results expected / finished. */
  planned: z.number().int(),
  done: z.number().int(),
  meanOverall: z.number().nullable(),
  meanRecognizable: z.number().nullable(),
  /** Share of cases whose blindMatch is `yes`, 0..1. */
  blindYesRate: z.number().nullable(),
  majorIssues: z.number().int(),
  meanOutputTokens: z.number().nullable(),
  meanFirstTokenMs: z.number().nullable(),
  meanDoneMs: z.number().nullable(),
  drawCostUsd: z.number(),
  judgeCostUsd: z.number(),
  byCategory: z.record(z.string(), z.number()),
  byKind: z.record(z.string(), z.number()),
  /** null while running or for the baseline; then whether this prompt version became the best. */
  kept: z.boolean().nullable(),
  /** One line: why kept / reverted, or "baseline". */
  verdict: z.string(),
})
export type RoundSummary = z.infer<typeof roundSummarySchema>

/** One flat line per case result in lab/history.jsonl, for charts. */
export const historyRowSchema = z.object({
  at: z.string(),
  roundId: z.string(),
  promptVersion: z.number().int(),
  caseId: z.string(),
  category: z.string(),
  tier: z.enum(TIERS),
  sample: z.number().int(),
  overall: z.number().nullable(),
  recognizable: z.number().nullable(),
  blindMatch: z.enum(['yes', 'partial', 'no']).nullable(),
  subscores: subscoresSchema.nullable(),
  majorIssues: z.number().int(),
  parseErrors: z.number().int(),
  outputTokens: z.number().nullable(),
  firstTokenMs: z.number().nullable(),
  doneMs: z.number().nullable(),
  costUsd: z.number(),
})
export type HistoryRow = z.infer<typeof historyRowSchema>

export const campaignConfigSchema = z.object({
  drawModel: z.string(),
  judgeModel: z.string(),
  editorModel: z.string(),
  blindModel: z.string(),
  /** Drawings per case per round. */
  samples: z.number().int().min(1).max(3),
  /** Cases drawn (and judged) at the same time. */
  concurrency: z.number().int().min(1).max(8),
  maxRounds: z.number().int().min(1),
  budgetUsd: z.number().positive(),
  /** A round is kept only if meanOverall improves on the best by at least this. */
  keepMinDelta: z.number(),
  /** The system prompt may not grow past baselineTokens * this. */
  maxPromptGrowth: z.number(),
  /** Mean output tokens per case may not grow past the baseline's * this. */
  maxOutputGrowth: z.number(),
  /** null = every case in lab/cases.json. */
  caseIds: z.array(z.string()).nullable(),
})
export type CampaignConfig = z.infer<typeof campaignConfigSchema>

export const DEFAULT_CAMPAIGN_CONFIG: CampaignConfig = {
  drawModel: 'claude-sonnet-5',
  judgeModel: 'claude-opus-5-5',
  editorModel: 'claude-opus-5-5',
  blindModel: 'claude-sonnet-5',
  samples: 1,
  concurrency: 4,
  maxRounds: 8,
  budgetUsd: 40,
  keepMinDelta: 1.5,
  maxPromptGrowth: 1.3,
  maxOutputGrowth: 1.25,
  caseIds: null,
}

export const CAMPAIGN_STATUSES = ['idle', 'running', 'paused', 'stopped', 'done'] as const
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number]

export const campaignStateSchema = z.object({
  status: z.enum(CAMPAIGN_STATUSES),
  config: campaignConfigSchema,
  /** Prompt version with the best kept score; the next patch is proposed from it. */
  bestVersion: z.number().int(),
  bestRoundId: z.string().nullable(),
  /** Token count of the seed prompt (v000) and the baseline round's mean output tokens, for the growth caps. */
  baselinePromptTokens: z.number().int().nullable(),
  baselineOutputTokens: z.number().nullable(),
  /** Round in progress (its directory exists; finished cases are skipped on resume). */
  currentRoundId: z.string().nullable(),
  spentUsd: z.number(),
  /** Timestamped one-liners, newest last, capped at 200. */
  log: z.array(z.string()),
  updatedAt: z.string(),
})
export type CampaignState = z.infer<typeof campaignStateSchema>

/** What the editor model returns: exact find/replace edits against the current prompt text. */
export const promptPatchSchema = z.object({
  rationale: z.string(),
  note: z.string(),
  edits: z.array(z.object({ find: z.string().min(1), replace: z.string() })).min(1),
})
export type PromptPatch = z.infer<typeof promptPatchSchema>

/** A previous editor attempt, so the next patch does not repeat it. */
export interface PatchAttempt {
  version: number
  note: string
  rationale: string
  /** meanOverall(new) - meanOverall(best at the time). */
  delta: number | null
  kept: boolean
}

export const roundId = (n: number): string => `r${String(n).padStart(3, '0')}`
export const promptFile = (version: number): string => `lab/prompts/v${String(version).padStart(3, '0')}`
export const caseFileBase = (rid: string, caseId: string, sample: number): string =>
  `lab/runs/${rid}/${caseId}-${sample}`
