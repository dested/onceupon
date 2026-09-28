/**
 * Prototype drawing languages, benched side by side (scripts/proto-bench.ts, scripts/proto-render.mjs).
 * A prototype is a Dialect whose id is not (yet) in DIALECT_IDS: once one wins it moves into
 * src/llm/ and gets a real DialectId. Each prototype registers ONE line here.
 */
import type { Scene } from '~/engine/scene'
import type { Dialect, DialectOptions } from '~/llm/dialect'
import { OpsDialect } from '~/llm/ops-dsl'
import { SketchDialect } from './sketch/dialect'
import { KitDialect } from './kit/dialect'

export interface ProtoDialect extends Omit<Dialect, 'id'> {
  readonly id: string
}

export type ProtoFactory = (scene: Scene, opts: DialectOptions) => ProtoDialect

export const PROTOS: Record<string, ProtoFactory> = {
  ops: (scene, opts) => new OpsDialect(scene, opts),
  sketch: (scene, opts) => new SketchDialect(scene, opts),
  kit: (scene, opts) => new KitDialect(scene, opts),
}

export function protoFactory(id: string): ProtoFactory {
  const f = PROTOS[id]
  if (!f) throw new Error(`unknown proto dialect "${id}" (have: ${Object.keys(PROTOS).join(', ')})`)
  return f
}
