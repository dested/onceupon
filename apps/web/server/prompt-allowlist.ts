import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import { log } from './logger'

/**
 * The relay only forwards a system prompt the studio's shipped dialects produce (kit and sketch, the
 * kid-safe versions; the hosted studio forces moderation on). The hashes are computed at boot from the
 * studio's own prompt modules in `src/llm`, the same commit the image ships, so an edited prompt can
 * never drift from the allow-list.
 *
 * The modules are imported by a computed path on purpose: apps/web's `~/` alias points at apps/web/src,
 * so a static import of the studio's tree would not typecheck here. Bun runs the TS directly and
 * resolves the studio's own `~/` alias from the root tsconfig. Exports are read as `unknown` and
 * narrowed. Hashes of earlier releases' prompts come from prompt-hashes.json and are merged in.
 */
const here = path.dirname(fileURLToPath(import.meta.url))
const STUDIO_LLM = path.resolve(here, '../../../src/llm')

const SOURCES: Array<{ dialect: 'kit' | 'sketch'; file: string; exportName: string }> = [
  { dialect: 'kit', file: 'kit/prompt.ts', exportName: 'KIT_SYSTEM_PROMPT' },
  { dialect: 'sketch', file: 'sketch/prompt.ts', exportName: 'SKETCH_SYSTEM_PROMPT' },
]

const sha256 = (s: string): string => createHash('sha256').update(s).digest('hex')

/**
 * Prompts that shipped in earlier releases stay accepted: installed apps (and the shell's bundled
 * studio) keep sending them until they update. The lead appends each release's hashes here.
 */
const shippedSchema = z.array(
  z.object({ dialect: z.enum(['kit', 'sketch']), sha256: z.string().regex(/^[0-9a-f]{64}$/), note: z.string() })
)
let shippedFile = path.join(here, 'prompt-hashes.json')

/** Tests point the shipped list at a file of their own and drop the cached allow-list. */
export function setShippedHashesFileForTests(file: string | null): void {
  shippedFile = file ?? path.join(here, 'prompt-hashes.json')
  loading = null
}

function readShipped(): Array<{ dialect: string; sha256: string }> {
  const parsed = shippedSchema.safeParse(JSON.parse(readFileSync(shippedFile, 'utf8')))
  if (!parsed.success) throw new Error(`prompt allow-list: ${shippedFile} is malformed`)
  return parsed.data
}

let loading: Promise<Map<string, string>> | null = null

async function load(): Promise<Map<string, string>> {
  const byHash = new Map<string, string>()
  for (const row of readShipped()) byHash.set(row.sha256, row.dialect)
  for (const src of SOURCES) {
    const mod: unknown = await import(path.join(STUDIO_LLM, src.file))
    const value = typeof mod === 'object' && mod !== null ? Reflect.get(mod, src.exportName) : undefined
    if (typeof value !== 'string' || value.length === 0) {
      throw new Error(`prompt allow-list: ${src.file} has no string export ${src.exportName}`)
    }
    byHash.set(sha256(value), src.dialect)
  }
  log.info(`[relay] prompt allow-list: ${byHash.size} prompts (${[...new Set(byHash.values())].join(', ')})`)
  return byHash
}

/** The allow-list, loaded once. A failed load is retried on the next call (and logged). */
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

/** The dialect id a system prompt belongs to, or null when the studio never sends it. */
export async function dialectOfSystem(system: string): Promise<string | null> {
  const list = await promptAllowList()
  return list.get(sha256(system)) ?? null
}
