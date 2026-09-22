import type { Clock } from '~/engine/clock'
import { parseLine } from '~/engine/dsl'
import type { Scene } from '~/engine/scene'
import type { Command } from '~/engine/types'
import { buildUserBlocks, SYSTEM_PROMPT, SYSTEM_PROMPT_UNMODERATED } from './prompt'
import type { PromptBlock } from './providers'
import { JsonDialect } from './json-dsl'
import { OpsDialect } from './ops-dsl'

export const DIALECT_IDS = ['lines', 'json', 'ops'] as const
export type DialectId = (typeof DIALECT_IDS)[number]
export const isDialectId = (s: string): s is DialectId => (DIALECT_IDS as readonly string[]).includes(s)

export const DIALECT_LABELS: Record<DialectId, string> = {
  lines: 'crayon lines (terse, v1)',
  json: 'json ops (paths + face helper, v2)',
  ops: 'ops (json ops, terse lines, v3)',
}

export type DialectParse = { ok: true; cmds: Command[] } | { ok: false; error: string }

export interface DialectInput {
  /** Chunks already sent, in order (cached as a prefix). */
  storyChunks: string[]
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
  buildUser(input: DialectInput): PromptBlock[]
  parse(line: string): DialectParse
  isSkip(line: string): boolean
  /** Commands the dialect wants applied later (a pose ending, a hop settling). Set by the Director. */
  later: ((cmds: Command[]) => void) | null
  reset(): void
}

export interface DialectOptions {
  /** Kid-safety section in the prompt (the model answers `skip` for not-for-kids meaning). */
  moderation: boolean
  /** Time source for delayed commands (pose endings); video export passes a VirtualClock. Default: real time. */
  clock?: Clock
}

export function makeDialect(id: DialectId, scene: Scene, opts: DialectOptions): Dialect {
  if (id === 'json') return new JsonDialect(scene, opts)
  if (id === 'ops') return new OpsDialect(scene, opts)
  return new LinesDialect(scene, opts)
}

/** The original one-command-per-line crayon DSL. */
export class LinesDialect implements Dialect {
  readonly id = 'lines' as const
  readonly system: string
  readonly maxTokens = 1200
  later: ((cmds: Command[]) => void) | null = null

  constructor(
    private scene: Scene,
    opts: DialectOptions
  ) {
    this.system = opts.moderation ? SYSTEM_PROMPT : SYSTEM_PROMPT_UNMODERATED
  }

  buildUser(input: DialectInput): PromptBlock[] {
    return buildUserBlocks({ storyChunks: input.storyChunks, sceneSummary: this.scene.summary(), newWords: input.newWords })
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
