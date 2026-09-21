import { parseLine } from '~/engine/dsl'
import type { Scene } from '~/engine/scene'
import type { Command } from '~/engine/types'
import { buildUserMessage, SYSTEM_PROMPT } from './prompt'
import { JsonDialect } from './json-dsl'

export const DIALECT_IDS = ['lines', 'json'] as const
export type DialectId = (typeof DIALECT_IDS)[number]
export const isDialectId = (s: string): s is DialectId => (DIALECT_IDS as readonly string[]).includes(s)

export const DIALECT_LABELS: Record<DialectId, string> = {
  lines: 'crayon lines (terse, v1)',
  json: 'json ops (paths + face helper, v2)',
}

export type DialectParse = { ok: true; cmds: Command[] } | { ok: false; error: string }

export interface DialectInput {
  storySoFar: string
  newWords: string
}

/**
 * A drawing language the model speaks. Each dialect owns its system prompt, its user-message
 * shape (including how the scene is described back to the model), and how one streamed line
 * becomes engine commands. The engine underneath is the same.
 */
export interface Dialect {
  readonly id: DialectId
  readonly system: string
  readonly maxTokens: number
  buildUser(input: DialectInput): string
  parse(line: string): DialectParse
  isSkip(line: string): boolean
  /** Commands the dialect wants applied later (a pose ending, a hop settling). Set by the Director. */
  later: ((cmds: Command[]) => void) | null
  reset(): void
}

export function makeDialect(id: DialectId, scene: Scene): Dialect {
  return id === 'json' ? new JsonDialect(scene) : new LinesDialect(scene)
}

/** The original one-command-per-line crayon DSL. */
export class LinesDialect implements Dialect {
  readonly id = 'lines' as const
  readonly system = SYSTEM_PROMPT
  readonly maxTokens = 1200
  later: ((cmds: Command[]) => void) | null = null

  constructor(private scene: Scene) {}

  buildUser(input: DialectInput): string {
    return buildUserMessage({ storySoFar: input.storySoFar, sceneSummary: this.scene.summary(), newWords: input.newWords })
  }

  parse(line: string): DialectParse {
    const res = parseLine(line)
    if (!res.ok) return { ok: false, error: res.error }
    return { ok: true, cmds: res.cmd ? [res.cmd] : [] }
  }

  isSkip(line: string): boolean {
    return /^skip\b/i.test(line.trim())
  }

  reset(): void {
    // stateless
  }
}
