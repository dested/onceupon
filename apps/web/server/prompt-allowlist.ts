import { createHash } from 'node:crypto'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import { prisma } from './prisma'
import { log } from './logger'

/**
 * The relay only forwards a system prompt the studio's shipped dialects produce (kit and sketch, the
 * kid-safe versions; the hosted studio forces moderation on).
 *
 * At boot the server hashes the studio's own prompt modules in `src/llm` (the commit the image ships)
 * and upserts those hashes into one hidden Flag row, `knownPromptHashes`. Every hash in that row is
 * accepted forever, so every prompt that ever ran on this database keeps working: installed apps,
 * the shell's bundled studio and tabs left open across a deploy. Nobody appends anything by hand.
 * The row is not a FLAG_DEFAULTS key, so the admin flags page neither shows nor edits it.
 *
 * The modules are imported by a computed path on purpose: apps/web's `~/` alias points at apps/web/src,
 * so a static import of the studio's tree would not typecheck here. Bun runs the TS directly and
 * resolves the studio's own `~/` alias from the root tsconfig. Exports are read as `unknown` and
 * narrowed.
 */
const here = path.dirname(fileURLToPath(import.meta.url))
const STUDIO_LLM = path.resolve(here, '../../../src/llm')

type Dialect = 'kit' | 'sketch'

const SOURCES: Array<{ dialect: Dialect; file: string; exportName: string }> = [
  { dialect: 'kit', file: 'kit/prompt.ts', exportName: 'KIT_SYSTEM_PROMPT' },
  { dialect: 'sketch', file: 'sketch/prompt.ts', exportName: 'SKETCH_SYSTEM_PROMPT' },
]

export const KNOWN_PROMPTS_KEY = 'knownPromptHashes'

const knownSchema = z.array(
  z.object({
    dialect: z.enum(['kit', 'sketch']),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
    firstSeen: z.string(),
  })
)
type Known = z.infer<typeof knownSchema>

const sha256 = (s: string): string => createHash('sha256').update(s).digest('hex')

/** The prompts this build ships, read from the studio's modules. */
async function studioPrompts(): Promise<Array<{ dialect: Dialect; text: string }>> {
  const out: Array<{ dialect: Dialect; text: string }> = []
  for (const src of SOURCES) {
    const mod: unknown = await import(path.join(STUDIO_LLM, src.file))
    const value = typeof mod === 'object' && mod !== null ? Reflect.get(mod, src.exportName) : undefined
    if (typeof value !== 'string' || value.length === 0) {
      throw new Error(`prompt allow-list: ${src.file} has no string export ${src.exportName}`)
    }
    out.push({ dialect: src.dialect, text: value })
  }
  return out
}

let promptSource: () => Promise<Array<{ dialect: Dialect; text: string }>> = studioPrompts
let loading: Promise<Map<string, string>> | null = null

/** Tests stand in for the studio's prompt modules (a "reboot" with an edited prompt); null restores them. */
export function setStudioPromptsForTests(prompts: Array<{ dialect: Dialect; text: string }> | null): void {
  promptSource = prompts ? async () => prompts : studioPrompts
  loading = null
}

async function readKnown(): Promise<Known> {
  const row = await prisma.flag.findUnique({ where: { key: KNOWN_PROMPTS_KEY } })
  if (!row) return []
  const parsed = knownSchema.safeParse(row.value)
  if (parsed.success) return parsed.data
  log.error(`[relay] ${KNOWN_PROMPTS_KEY} is malformed; keeping only this build's prompts until it is fixed`)
  return []
}

async function load(): Promise<Map<string, string>> {
  const current = await promptSource()
  const known = await readKnown()
  const seen = new Set(known.map((k) => k.sha256))
  const now = new Date().toISOString()
  const added: Known = []
  for (const p of current) {
    const hash = sha256(p.text)
    if (!seen.has(hash)) {
      seen.add(hash)
      added.push({ dialect: p.dialect, sha256: hash, firstSeen: now })
    }
  }
  const all = [...known, ...added]
  if (added.length > 0) {
    await prisma.flag.upsert({
      where: { key: KNOWN_PROMPTS_KEY },
      create: { key: KNOWN_PROMPTS_KEY, value: all, updatedBy: 'boot' },
      update: { value: all, updatedBy: 'boot', updatedAt: new Date() },
    })
  }
  const byHash = new Map<string, string>(all.map((k) => [k.sha256, k.dialect]))
  log.info(`[relay] prompt allow-list: ${byHash.size} known prompts, ${added.length} new this boot`)
  return byHash
}

/** The allow-list, loaded once per boot. A failed load is retried on the next call (and logged). */
export function promptAllowList(): Promise<Map<string, string>> {
  if (!loading) {
    loading = load().catch((e: unknown) => {
      loading = null
      log.error(`[relay] prompt allow-list failed: ${e instanceof Error ? e.message : String(e)}`)
      throw e
    })
  }
  return loading
}

/** Tests: forget this boot's list (the DB row stays), as a restart would. */
export function reloadPromptAllowListForTests(): void {
  loading = null
}

/** The dialect id a system prompt belongs to, or null when no build ever shipped it. */
export async function dialectOfSystem(system: string): Promise<string | null> {
  const list = await promptAllowList()
  return list.get(sha256(system)) ?? null
}
