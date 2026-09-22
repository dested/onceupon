/**
 * Agent-mode CLI for the drawing lab. Sal's Anthropic credits are gone, so the model calls are made
 * by Claude Code agents instead of the API: an agent generates ops, the lab page renders them to a
 * jpg (window.__lab.renderFromFile), an agent judges the picture, and this CLI writes everything into
 * the SAME lab/ files the browser campaign writes, so the page charts an agent-run round exactly like
 * an API round. It shares the pure prompt tools and the disk shapes with the app; the model logic
 * (newRound, recomputeMeans, decideKeep, the history row) is copied from campaign.ts.
 *
 * Run: bun scripts/lab-agent.ts <command> ...
 *
 * No browser modules here (no store, no Anthropic client): only zod, node fs, and the pure
 * src/lab/{types,prompt-text,cases} plus the seed prompt text.
 */
import { promises as fs } from 'node:fs'
import * as path from 'node:path'
import { z } from 'zod'
import {
  caseFileBase,
  caseResultSchema,
  campaignConfigSchema,
  DEFAULT_CAMPAIGN_CONFIG,
  drawLineSchema,
  historyRowSchema,
  ISSUE_KINDS,
  labCaseSchema,
  promptFile,
  promptMetaSchema,
  promptPatchSchema,
  roundSummarySchema,
  type CampaignConfig,
  type CaseResult,
  type Critique,
  type DrawResult,
  type HistoryRow,
  type JudgeOutput,
  type LabCase,
  type PromptMeta,
  type RoundSummary,
} from '../src/lab/types'
import { applyPatch, validatePrompt } from '../src/lab/prompt-text'
import { DEFAULT_CASES } from '../src/lab/cases'
import { OPS_SYSTEM_PROMPT } from '../src/llm/ops-prompt'

const ROOT = process.cwd()
const abs = (rel: string): string => path.join(ROOT, rel)
const AGENT_MODEL_DRAW = 'claude-sonnet-5 via claude-code agent'
const AGENT_MODEL_JUDGE = 'claude-opus-5-5 via claude-code agent'

// --- disk helpers ---

async function readTextFile(rel: string): Promise<string | null> {
  try {
    return await fs.readFile(abs(rel), 'utf8')
  } catch {
    return null
  }
}

async function writeTextFile(rel: string, text: string): Promise<void> {
  const full = abs(rel)
  await fs.mkdir(path.dirname(full), { recursive: true })
  await fs.writeFile(full, text, 'utf8')
}

async function writeJson(rel: string, value: unknown): Promise<void> {
  await writeTextFile(rel, JSON.stringify(value, null, 2))
}

async function appendJsonl(rel: string, value: unknown): Promise<void> {
  const full = abs(rel)
  await fs.mkdir(path.dirname(full), { recursive: true })
  await fs.appendFile(full, `${JSON.stringify(value)}\n`, 'utf8')
}

async function listDir(rel: string): Promise<string[]> {
  try {
    return await fs.readdir(abs(rel))
  } catch {
    return []
  }
}

// --- schema-checked reads ---

async function readCases(): Promise<LabCase[]> {
  const text = await readTextFile('lab/cases.json')
  if (text === null) return DEFAULT_CASES
  return z.array(labCaseSchema).parse(JSON.parse(text))
}

async function readRound(rid: string): Promise<RoundSummary | null> {
  const text = await readTextFile(`lab/runs/${rid}/round.json`)
  return text === null ? null : roundSummarySchema.parse(JSON.parse(text))
}

async function writeRound(round: RoundSummary): Promise<void> {
  await writeJson(`lab/runs/${round.id}/round.json`, round)
}

async function readCaseResult(
  rid: string,
  caseId: string,
  sample: number
): Promise<CaseResult | null> {
  const text = await readTextFile(`${caseFileBase(rid, caseId, sample)}.json`)
  return text === null ? null : caseResultSchema.parse(JSON.parse(text))
}

async function writeCaseResult(rid: string, result: CaseResult): Promise<void> {
  const base = result.draw.imagePath.replace(/\.jpg$/, '')
  await writeJson(`${base}.json`, result)
  await writeTextFile(`${base}.ops.txt`, result.draw.ops)
}

async function readAllCaseResults(rid: string): Promise<CaseResult[]> {
  const entries = await listDir(`lab/runs/${rid}`)
  const out: CaseResult[] = []
  for (const name of entries) {
    if (!name.endsWith('.json') || name === 'round.json') continue
    const text = await readTextFile(`lab/runs/${rid}/${name}`)
    if (text === null) continue
    out.push(caseResultSchema.parse(JSON.parse(text)))
  }
  out.sort((a, b) => {
    const byCase = a.draw.caseId.localeCompare(b.draw.caseId)
    return byCase !== 0 ? byCase : a.draw.sample - b.draw.sample
  })
  return out
}

const campaignStateShape = z.object({
  status: z.string(),
  config: campaignConfigSchema,
  bestVersion: z.number().int(),
  bestRoundId: z.string().nullable(),
  baselinePromptTokens: z.number().int().nullable(),
  baselineOutputTokens: z.number().nullable(),
  currentRoundId: z.string().nullable(),
  spentUsd: z.number(),
  log: z.array(z.string()),
  updatedAt: z.string(),
})
type CampaignFile = z.infer<typeof campaignStateShape>

function freshCampaign(config: CampaignConfig): CampaignFile {
  return {
    status: 'idle',
    config,
    bestVersion: 0,
    bestRoundId: null,
    baselinePromptTokens: null,
    baselineOutputTokens: null,
    currentRoundId: null,
    spentUsd: 0,
    log: [],
    updatedAt: new Date().toISOString(),
  }
}

async function readCampaign(): Promise<CampaignFile | null> {
  const text = await readTextFile('lab/campaign.json')
  return text === null ? null : campaignStateShape.parse(JSON.parse(text))
}

async function writeCampaign(state: CampaignFile): Promise<void> {
  await writeJson('lab/campaign.json', { ...state, updatedAt: new Date().toISOString() })
}

async function seedText(): Promise<string> {
  return (await readTextFile(`${promptFile(0)}.md`)) ?? OPS_SYSTEM_PROMPT
}

async function promptText(version: number): Promise<string> {
  const text = await readTextFile(`${promptFile(version)}.md`)
  if (text === null) throw new Error(`prompt v${version} not found on disk`)
  return text
}

async function maxPromptVersion(): Promise<number> {
  const entries = await listDir('lab/prompts')
  let max = -1
  for (const name of entries) {
    const m = /^v(\d+)\.md$/.exec(name)
    if (m && m[1] !== undefined) max = Math.max(max, Number(m[1]))
  }
  return max
}

// --- round math (copied from campaign.ts) ---

const mean = (xs: number[]): number | null =>
  xs.length === 0 ? null : xs.reduce((a, b) => a + b, 0) / xs.length

function newRound(id: string, n: number, version: number, planned: number): RoundSummary {
  return {
    id,
    n,
    promptVersion: version,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    planned,
    done: 0,
    judged: 0,
    meanOverall: null,
    meanRecognizable: null,
    blindYesRate: null,
    majorIssues: 0,
    meanOutputTokens: null,
    meanFirstTokenMs: null,
    meanDoneMs: null,
    drawCostUsd: 0,
    judgeCostUsd: 0,
    byCategory: {},
    byKind: {},
    kept: null,
    verdict: '',
  }
}

function recompute(round: RoundSummary, results: CaseResult[], catOf: Map<string, string>): void {
  const critiques = results
    .map((r) => r.critique)
    .filter((c): c is Critique => c !== null && c !== undefined)
  round.done = results.length
  round.judged = critiques.length
  round.meanOverall = mean(critiques.map((c) => c.overall))
  round.meanRecognizable = mean(critiques.map((c) => c.recognizable))
  round.blindYesRate =
    critiques.length === 0
      ? null
      : critiques.filter((c) => c.blindMatch === 'yes').length / critiques.length
  round.majorIssues = critiques.reduce(
    (sum, c) => sum + c.issues.filter((i) => i.severity === 'major').length,
    0
  )
  round.meanOutputTokens = mean(
    results
      .map((r) => r.draw.usage?.output)
      .filter((x): x is number => x !== undefined && x !== null)
  )
  round.meanFirstTokenMs = mean(
    results.map((r) => r.draw.firstTokenMs).filter((x): x is number => x !== null)
  )
  round.meanDoneMs = mean(results.map((r) => r.draw.doneMs).filter((x): x is number => x !== null))
  round.drawCostUsd = results.reduce((s, r) => s + (r.draw.costUsd ?? 0), 0)
  round.judgeCostUsd = results.reduce((s, r) => s + (r.critique?.judgeCostUsd ?? 0), 0)

  const byCatValues = new Map<string, number[]>()
  const byKind: Record<string, number> = {}
  for (const r of results) {
    if (!r.critique) continue
    const cat = catOf.get(r.draw.caseId) ?? 'unknown'
    const list = byCatValues.get(cat) ?? []
    list.push(r.critique.overall)
    byCatValues.set(cat, list)
    for (const issue of r.critique.issues) byKind[issue.kind] = (byKind[issue.kind] ?? 0) + 1
  }
  const byCategory: Record<string, number> = {}
  for (const [cat, values] of byCatValues) byCategory[cat] = mean(values) ?? 0
  round.byCategory = byCategory
  round.byKind = byKind
}

/** The keep/revert decision, copied from campaign.ts, plus the incomplete-round rule. */
function decide(
  round: RoundSummary,
  bestRound: RoundSummary,
  cfg: CampaignConfig,
  baselineOutputTokens: number | null
): { kept: boolean; verdict: string } {
  const judged = round.judged ?? 0
  if (judged < 0.9 * round.planned) {
    return { kept: false, verdict: `incomplete: ${judged}/${round.planned} judged` }
  }
  const newOverall = round.meanOverall ?? 0
  const bestOverall = bestRound.meanOverall ?? 0
  const delta = newOverall - bestOverall
  const newOut = round.meanOutputTokens ?? 0
  const baseOut = baselineOutputTokens ?? newOut
  const newBlind = round.blindYesRate ?? 0
  const bestBlind = bestRound.blindYesRate ?? 0

  const scoreOk = delta >= cfg.keepMinDelta
  const tokenOk = baseOut === 0 || newOut <= baseOut * cfg.maxOutputGrowth
  const blindOk = newBlind >= bestBlind - 0.05

  if (scoreOk && tokenOk && blindOk) {
    return {
      kept: true,
      verdict: `kept: +${delta.toFixed(1)} overall (${bestOverall.toFixed(1)} → ${newOverall.toFixed(1)})`,
    }
  }
  if (!scoreOk)
    return { kept: false, verdict: `reverted: ${delta >= 0 ? '+' : ''}${delta.toFixed(1)} overall` }
  if (!tokenOk) {
    const growth = baseOut === 0 ? 0 : Math.round((newOut / baseOut - 1) * 100)
    return { kept: false, verdict: `reverted: output tokens +${growth}% over cap` }
  }
  return {
    kept: false,
    verdict: `reverted: blind-yes fell ${Math.round(bestBlind * 100)}% → ${Math.round(newBlind * 100)}%`,
  }
}

// --- lenient judge parse (same repairs as judge.ts) ---

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

const DEFAULT_JUDGE: JudgeOutput = {
  seen: '',
  blindMatch: 'partial',
  recognizable: 1,
  subscores: { anatomy: 1, proportion: 1, placement: 1, color: 1, composition: 1, simplicity: 1 },
  overall: 0,
  issues: [],
  praise: [],
}

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

// --- shared bits ---

function catMapOf(cases: LabCase[]): Map<string, string> {
  return new Map(cases.map((c) => [c.id, c.category]))
}

function historyRow(rid: string, version: number, c: LabCase, result: CaseResult): HistoryRow {
  const critique = result.critique
  const majorIssues = critique ? critique.issues.filter((i) => i.severity === 'major').length : 0
  return {
    at: new Date().toISOString(),
    roundId: rid,
    promptVersion: version,
    caseId: c.id,
    category: c.category,
    tier: c.tier,
    sample: result.draw.sample,
    overall: critique?.overall ?? null,
    recognizable: critique?.recognizable ?? null,
    blindMatch: critique?.blindMatch ?? null,
    subscores: critique?.subscores ?? null,
    majorIssues,
    parseErrors: result.draw.parseErrors,
    outputTokens: result.draw.usage?.output ?? null,
    firstTokenMs: result.draw.firstTokenMs,
    doneMs: result.draw.doneMs,
    costUsd: (result.draw.costUsd ?? 0) + (critique?.judgeCostUsd ?? 0),
  }
}

function nFromRid(rid: string): number {
  const digits = rid.replace(/[^0-9]/g, '')
  return digits === '' ? 0 : Number(digits)
}

function flag(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name)
  return i >= 0 ? argv[i + 1] : undefined
}

function die(message: string): never {
  console.error(message)
  process.exit(1)
}

// --- commands ---

async function cmdPlan(
  rid: string,
  version: number,
  caseIdsArg: string | undefined
): Promise<void> {
  const cases = await readCases()
  const campaign = await readCampaign()
  let ids: string[] | null
  if (caseIdsArg)
    ids = caseIdsArg
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  else ids = campaign?.config.caseIds ?? null
  const selected = ids ? cases.filter((c) => ids.includes(c.id)) : cases
  if (selected.length === 0) die(`no cases matched ${caseIdsArg ?? '(config/all)'}`)

  const round = newRound(rid, nFromRid(rid), version, selected.length)
  await writeRound(round)
  await fs.mkdir(abs(`lab/agent/${rid}`), { recursive: true })

  console.log(
    JSON.stringify(
      selected.map((c) => ({
        id: c.id,
        phrase: c.phrase,
        category: c.category,
        tier: c.tier,
        expect: c.expect,
      })),
      null,
      2
    )
  )
}

async function cmdRecordDraw(
  rid: string,
  caseId: string,
  sample: number,
  phrase: string,
  linesJsonFile: string
): Promise<void> {
  const round = await readRound(rid)
  if (!round) die(`no round ${rid}; run plan first`)
  const version = round.promptVersion

  const opsText = await readTextFile(`lab/agent/${rid}/${caseId}-${sample}.ops.txt`)
  if (opsText === null) die(`missing ops file lab/agent/${rid}/${caseId}-${sample}.ops.txt`)

  const linesRaw = await fs.readFile(path.resolve(linesJsonFile), 'utf8')
  const lines = z.array(drawLineSchema).parse(JSON.parse(linesRaw))
  const parseErrors = lines.filter((l) => !l.ok).length
  const imagePath = `${caseFileBase(rid, caseId, sample)}.jpg`

  const draw: DrawResult = {
    caseId,
    phrase,
    promptVersion: version,
    sample,
    model: AGENT_MODEL_DRAW,
    ops: opsText,
    lines,
    parseErrors,
    firstTokenMs: null,
    doneMs: null,
    usage: {
      input: 0,
      cacheRead: 0,
      cacheWrite: 0,
      output: Math.round(opsText.length / 3.5),
      costUsd: null,
    },
    costUsd: null,
    error: null,
    imagePath,
    drawnAt: new Date().toISOString(),
  }
  const existing = await readCaseResult(rid, caseId, sample)
  const result: CaseResult = {
    draw,
    critique: existing?.critique ?? null,
    critiqueError: existing?.critiqueError ?? null,
  }
  await writeCaseResult(rid, caseResultSchema.parse(result))

  const cases = await readCases()
  recompute(round, await readAllCaseResults(rid), catMapOf(cases))
  await writeRound(round)
  console.log(
    `recorded draw ${caseId}-${sample}: ${lines.length} lines, ${parseErrors} parse errors`
  )
}

async function cmdRecordJudge(
  rid: string,
  caseId: string,
  sample: number,
  critiqueJsonFile: string
): Promise<void> {
  const round = await readRound(rid)
  if (!round) die(`no round ${rid}; run plan first`)
  const existing = await readCaseResult(rid, caseId, sample)
  if (!existing) die(`no drawn case ${caseId}-${sample}; run record-draw first`)

  const raw: unknown = JSON.parse(await fs.readFile(path.resolve(critiqueJsonFile), 'utf8'))
  const blindGuess =
    typeof raw === 'object' &&
    raw !== null &&
    'blindGuess' in raw &&
    typeof raw.blindGuess === 'string'
      ? raw.blindGuess
      : ''
  const output = lenientJudge.parse(raw)
  const critique: Critique = {
    ...output,
    blindGuess,
    judgeModel: AGENT_MODEL_JUDGE,
    judgeCostUsd: null,
    judgedAt: new Date().toISOString(),
  }
  const result: CaseResult = { draw: existing.draw, critique, critiqueError: null }
  await writeCaseResult(rid, caseResultSchema.parse(result))

  const cases = await readCases()
  const c = cases.find((x) => x.id === caseId) ?? {
    id: caseId,
    phrase: existing.draw.phrase,
    tier: 'subject' as const,
    category: 'play',
    expect: [],
  }
  await appendJsonl(
    'lab/history.jsonl',
    historyRowSchema.parse(historyRow(rid, round.promptVersion, c, result))
  )
  recompute(round, await readAllCaseResults(rid), catMapOf(cases))
  await writeRound(round)
  console.log(
    `recorded judge ${caseId}-${sample}: overall ${critique.overall}, blindMatch ${critique.blindMatch}`
  )
}

async function cmdFinish(rid: string): Promise<void> {
  const round = await readRound(rid)
  if (!round) die(`no round ${rid}`)
  const cases = await readCases()
  const catOf = catMapOf(cases)
  recompute(round, await readAllCaseResults(rid), catOf)
  round.finishedAt = new Date().toISOString()

  const campaign = (await readCampaign()) ?? freshCampaign(DEFAULT_CAMPAIGN_CONFIG)

  if (round.n === 0) {
    round.kept = true
    round.verdict = 'baseline'
    campaign.bestRoundId = rid
    campaign.bestVersion = round.promptVersion
    campaign.baselineOutputTokens = round.meanOutputTokens
    campaign.log = [
      ...campaign.log,
      `${new Date().toTimeString().slice(0, 8)} baseline ${rid}`,
    ].slice(-200)
  } else {
    const bestRound = campaign.bestRoundId ? await readRound(campaign.bestRoundId) : null
    if (!bestRound) die(`no best round recorded in campaign.json to compare ${rid} against`)
    const verdict = decide(round, bestRound, campaign.config, campaign.baselineOutputTokens)
    round.kept = verdict.kept
    round.verdict = verdict.verdict
    if (verdict.kept) {
      campaign.bestVersion = round.promptVersion
      campaign.bestRoundId = rid
    }
    campaign.log = [
      ...campaign.log,
      `${new Date().toTimeString().slice(0, 8)} ${rid} ${verdict.verdict}`,
    ].slice(-200)
  }

  await writeRound(round)
  await writeCampaign(campaign)

  const cats = Object.entries(round.byCategory)
    .map(([cat, v]) => `${cat} ${v.toFixed(0)}`)
    .join(', ')
  console.log(
    `${rid} (v${round.promptVersion}): ${round.verdict}. mean overall ${round.meanOverall === null ? 'n/a' : round.meanOverall.toFixed(1)}, ` +
      `recognizable ${round.meanRecognizable === null ? 'n/a' : round.meanRecognizable.toFixed(1)}, ` +
      `blind-yes ${round.blindYesRate === null ? 'n/a' : Math.round(round.blindYesRate * 100) + '%'}, ` +
      `${round.judged ?? 0}/${round.planned} judged, ${round.majorIssues} major issues.\n` +
      `per-category overall: ${cats || '(none)'}`
  )
}

async function cmdSavePrompt(textFile: string, argv: string[]): Promise<void> {
  const parentStr = flag(argv, '--parent')
  const note = flag(argv, '--note')
  const rationaleFile = flag(argv, '--rationale-file')
  const sourceArg = flag(argv, '--source') ?? 'manual'
  if (parentStr === undefined || note === undefined || rationaleFile === undefined)
    die('save-prompt needs --parent <n> --note "<note>" --rationale-file <file>')
  if (sourceArg !== 'editor' && sourceArg !== 'manual') die('--source must be editor or manual')

  const text = await fs.readFile(path.resolve(textFile), 'utf8')
  const rationale = await fs.readFile(path.resolve(rationaleFile), 'utf8')
  const validity = validatePrompt(text, await seedText())
  if (!validity.ok) {
    console.error('prompt is invalid:')
    for (const e of validity.errors) console.error(`  - ${e}`)
    process.exit(1)
  }
  const version = (await maxPromptVersion()) + 1
  // No Anthropic client here, so tokens is a rough estimate (~3.6 chars/token), not a real count.
  const tokens = Math.round(text.length / 3.6)
  const meta: PromptMeta = {
    version,
    parent: Number(parentStr),
    createdAt: new Date().toISOString(),
    note,
    rationale,
    tokens,
    source: sourceArg,
  }
  await writeTextFile(`${promptFile(version)}.md`, text)
  await writeJson(`${promptFile(version)}.json`, promptMetaSchema.parse(meta))
  console.log(`saved v${version} (parent v${parentStr}, ~${tokens} tokens, source ${sourceArg})`)
}

async function cmdApplyPatch(
  version: number,
  patchJsonFile: string,
  outTextFile: string
): Promise<void> {
  const text = await promptText(version)
  const patch = promptPatchSchema.parse(
    JSON.parse(await fs.readFile(path.resolve(patchJsonFile), 'utf8'))
  )
  const applied = applyPatch(text, patch)
  if (!applied.ok) die(`patch failed: ${applied.error}`)
  const validity = validatePrompt(applied.text, await seedText())
  if (!validity.ok) {
    console.error('patched prompt is invalid:')
    for (const e of validity.errors) console.error(`  - ${e}`)
    process.exit(1)
  }
  await fs.writeFile(path.resolve(outTextFile), applied.text, 'utf8')
  console.log(`applied ${patch.edits.length} edit(s) from v${version} -> ${outTextFile}`)
}

async function cmdWorst(rid: string, nArg: string | undefined): Promise<void> {
  const limit = nArg ? Number(nArg) : 10
  const results = await readAllCaseResults(rid)
  const scored = results
    .filter((r) => r.critique !== null)
    .sort((a, b) => (a.critique?.overall ?? 0) - (b.critique?.overall ?? 0))
    .slice(0, limit)
  if (scored.length === 0) {
    console.log(`no judged cases in ${rid}`)
    return
  }
  for (const r of scored) {
    const c = r.critique
    if (!c) continue
    const majors = c.issues
      .filter((i) => i.severity === 'major')
      .map((i) => `${i.kind}: ${i.what} -> ${i.rule}`)
      .join(' ; ')
    console.log(
      `${r.draw.caseId} | ${c.overall} | blind "${c.blindGuess}" | ${majors || '(no major issues)'}`
    )
  }
  const round = await readRound(rid)
  if (round) {
    const kinds = Object.entries(round.byKind)
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `${k}: ${v}`)
      .join(', ')
    console.log(`\nby kind: ${kinds || '(none)'}`)
  }
}

const USAGE = `lab-agent — agent-mode driver for the drawing lab (writes lab/ the same as the app)

  bun scripts/lab-agent.ts plan <rid> <version> [caseIds]
      Create lab/runs/<rid>/round.json and lab/agent/<rid>/, print the case list as JSON.
      caseIds: comma list (e.g. horse,cat); default = campaign.json config.caseIds or all.

  bun scripts/lab-agent.ts record-draw <rid> <caseId> <sample> <phrase> <linesJsonFile>
      Write the CaseResult draw from the ops file lab/agent/<rid>/<caseId>-<sample>.ops.txt and the
      lines JSON the page hook returned. Recomputes the round.

  bun scripts/lab-agent.ts record-judge <rid> <caseId> <sample> <critiqueJsonFile>
      Merge a (leniently repaired) judge critique into the case, append a history row, recompute.

  bun scripts/lab-agent.ts finish <rid>
      Finalize: baseline (n=0) sets the best; otherwise keep/revert vs the best round. Prints a summary.

  bun scripts/lab-agent.ts save-prompt <textFile> --parent <n> --note "<note>" --rationale-file <f> [--source editor|manual]
      Validate then save a new prompt version (tokens are a char-based estimate).

  bun scripts/lab-agent.ts apply-patch <promptVersion> <patchJsonFile> <outTextFile>
      Apply an editor patch to a version and validate; writes the new text.

  bun scripts/lab-agent.ts worst <rid> [n]
      Print the n worst judged cases and the by-kind issue table, for the editor.`

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  const cmd = argv[0]
  switch (cmd) {
    case 'plan': {
      const [rid, version] = [argv[1], argv[2]]
      if (!rid || !version) die('plan <rid> <version> [caseIds]')
      return cmdPlan(rid, Number(version), argv[3])
    }
    case 'record-draw': {
      const [rid, caseId, sample, phrase, file] = [argv[1], argv[2], argv[3], argv[4], argv[5]]
      if (!rid || !caseId || sample === undefined || !phrase || !file)
        die('record-draw <rid> <caseId> <sample> <phrase> <linesJsonFile>')
      return cmdRecordDraw(rid, caseId, Number(sample), phrase, file)
    }
    case 'record-judge': {
      const [rid, caseId, sample, file] = [argv[1], argv[2], argv[3], argv[4]]
      if (!rid || !caseId || sample === undefined || !file)
        die('record-judge <rid> <caseId> <sample> <critiqueJsonFile>')
      return cmdRecordJudge(rid, caseId, Number(sample), file)
    }
    case 'finish': {
      const rid = argv[1]
      if (!rid) die('finish <rid>')
      return cmdFinish(rid)
    }
    case 'save-prompt': {
      const textFile = argv[1]
      if (!textFile)
        die('save-prompt <textFile> --parent <n> --note "<note>" --rationale-file <file>')
      return cmdSavePrompt(textFile, argv)
    }
    case 'apply-patch': {
      const [version, patchFile, outFile] = [argv[1], argv[2], argv[3]]
      if (!version || !patchFile || !outFile)
        die('apply-patch <promptVersion> <patchJsonFile> <outTextFile>')
      return cmdApplyPatch(Number(version), patchFile, outFile)
    }
    case 'worst': {
      const rid = argv[1]
      if (!rid) die('worst <rid> [n]')
      return cmdWorst(rid, argv[2])
    }
    default:
      console.log(USAGE)
      if (cmd !== undefined && cmd !== '--help' && cmd !== '-h') process.exit(1)
  }
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : String(e))
  process.exit(1)
})
