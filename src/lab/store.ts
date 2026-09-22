/**
 * Typed disk model for the drawing lab. Every read is zod-parsed and throws on invalid data; every
 * write goes through the `/__lab/*` file API in api.ts. The disk layout lives in
 * plans/2026-09-22-drawing-lab.md. Nothing here reaches the network beyond that dev-only API.
 */
import { z } from 'zod'
import { OPS_SYSTEM_PROMPT } from '~/llm/ops-prompt'
import { DEFAULT_CASES } from './cases'
import {
  caseResultSchema,
  campaignStateSchema,
  historyRowSchema,
  labCaseSchema,
  promptFile,
  promptMetaSchema,
  roundSummarySchema,
  type CampaignState,
  type CaseResult,
  type HistoryRow,
  type LabCase,
  type PromptMeta,
  type RoundSummary,
} from './types'
import { appendLine, list, readText, writeBlob, writeText } from './api'

const CASES_PATH = 'lab/cases.json'
const CAMPAIGN_PATH = 'lab/campaign.json'
const HISTORY_PATH = 'lab/history.jsonl'
const PROMPTS_DIR = 'lab/prompts'
const PROMOTED_PATH = 'lab/prompts/promoted.json'
const RUNS_DIR = 'lab/runs'

const pretty = (value: unknown): string => JSON.stringify(value, null, 2)

// --- cases ---

export async function loadCases(): Promise<LabCase[]> {
  const text = await readText(CASES_PATH)
  if (text === null) {
    await saveCases(DEFAULT_CASES)
    return DEFAULT_CASES
  }
  return z.array(labCaseSchema).parse(JSON.parse(text))
}

export async function saveCases(cases: LabCase[]): Promise<void> {
  await writeText(CASES_PATH, pretty(cases))
}

// --- prompts ---

async function seedV000(): Promise<PromptMeta> {
  const meta: PromptMeta = {
    version: 0,
    parent: null,
    createdAt: new Date().toISOString(),
    note: 'seeded from src/llm/ops-prompt.ts',
    rationale: 'seeded from src/llm/ops-prompt.ts',
    tokens: null,
    source: 'seed',
  }
  await writeText(`${promptFile(0)}.md`, OPS_SYSTEM_PROMPT)
  await writeText(`${promptFile(0)}.json`, pretty(meta))
  return meta
}

export async function loadPromptMetas(): Promise<PromptMeta[]> {
  const entries = await list(PROMPTS_DIR)
  const metaFiles = entries.filter((e) => !e.dir && /^v\d+\.json$/.test(e.name))
  if (metaFiles.length === 0) {
    const seeded = await seedV000()
    return [seeded]
  }
  const metas: PromptMeta[] = []
  for (const f of metaFiles) {
    const text = await readText(`${PROMPTS_DIR}/${f.name}`)
    if (text === null) continue
    metas.push(promptMetaSchema.parse(JSON.parse(text)))
  }
  metas.sort((a, b) => a.version - b.version)
  return metas
}

export async function loadPromptText(version: number): Promise<string> {
  const filePath = `${promptFile(version)}.md`
  const text = await readText(filePath)
  if (text !== null) return text
  if (version === 0) {
    await loadPromptMetas() // seeds v000.md + v000.json when the prompts dir is empty
    const seeded = await readText(filePath)
    if (seeded !== null) return seeded
  }
  throw new Error(`prompt v${version} not found`)
}

export async function savePrompt(
  text: string,
  meta: Omit<PromptMeta, 'version' | 'createdAt'>
): Promise<PromptMeta> {
  const metas = await loadPromptMetas()
  const version = metas.reduce((max, m) => Math.max(max, m.version), -1) + 1
  const full: PromptMeta = { ...meta, version, createdAt: new Date().toISOString() }
  await writeText(`${promptFile(version)}.md`, text)
  await writeText(`${promptFile(version)}.json`, pretty(full))
  return full
}

export async function updatePromptMeta(meta: PromptMeta): Promise<void> {
  await writeText(`${promptFile(meta.version)}.json`, pretty(meta))
}

export async function loadPromoted(): Promise<{ version: number; at: string } | null> {
  const text = await readText(PROMOTED_PATH)
  if (text === null) return null
  return z.object({ version: z.number().int(), at: z.string() }).parse(JSON.parse(text))
}

// --- campaign ---

export async function loadCampaign(): Promise<CampaignState | null> {
  const text = await readText(CAMPAIGN_PATH)
  if (text === null) return null
  return campaignStateSchema.parse(JSON.parse(text))
}

export async function saveCampaign(state: CampaignState): Promise<void> {
  await writeText(CAMPAIGN_PATH, pretty(state))
}

// --- rounds and case results ---

export async function loadRounds(): Promise<RoundSummary[]> {
  const entries = await list(RUNS_DIR)
  const dirs = entries.filter((e) => e.dir && /^r\d+$/.test(e.name))
  const rounds: RoundSummary[] = []
  for (const d of dirs) {
    const text = await readText(`${RUNS_DIR}/${d.name}/round.json`)
    if (text === null) continue
    rounds.push(roundSummarySchema.parse(JSON.parse(text)))
  }
  rounds.sort((a, b) => a.n - b.n)
  return rounds
}

export async function saveRound(r: RoundSummary): Promise<void> {
  await writeText(`${RUNS_DIR}/${r.id}/round.json`, pretty(r))
}

export async function loadCaseResults(roundId: string): Promise<CaseResult[]> {
  const entries = await list(`${RUNS_DIR}/${roundId}`)
  const jsonFiles = entries.filter(
    (e) => !e.dir && e.name.endsWith('.json') && e.name !== 'round.json'
  )
  const results: CaseResult[] = []
  for (const f of jsonFiles) {
    const text = await readText(`${RUNS_DIR}/${roundId}/${f.name}`)
    if (text === null) continue
    results.push(caseResultSchema.parse(JSON.parse(text)))
  }
  results.sort((a, b) => {
    const byCase = a.draw.caseId.localeCompare(b.draw.caseId)
    return byCase !== 0 ? byCase : a.draw.sample - b.draw.sample
  })
  return results
}

/**
 * Writes the picture, the raw ops text, and the CaseResult JSON. The base path is derived from
 * `r.draw.imagePath` (which must already be the `.jpg` path), so this works for both round runs
 * (`lab/runs/rNNN/<caseId>-<sample>.jpg`) and playground saves (`lab/runs/play/<iso>-<slug>.jpg`).
 */
export async function saveCaseResult(roundId: string, r: CaseResult, image: Blob): Promise<void> {
  void roundId
  const base = r.draw.imagePath.replace(/\.jpg$/, '')
  await writeBlob(`${base}.jpg`, image)
  await writeText(`${base}.ops.txt`, r.draw.ops)
  await writeText(`${base}.json`, pretty(r))
}

// --- history ---

export async function appendHistory(row: HistoryRow): Promise<void> {
  await appendLine(HISTORY_PATH, JSON.stringify(row))
}

export async function loadHistory(): Promise<HistoryRow[]> {
  const text = await readText(HISTORY_PATH)
  if (text === null) return []
  const rows: HistoryRow[] = []
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (trimmed.length === 0) continue
    try {
      rows.push(historyRowSchema.parse(JSON.parse(trimmed)))
    } catch {
      // skip unparsable lines: partial writes, schema drift
    }
  }
  return rows
}
