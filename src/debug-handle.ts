import type { Scene } from '~/engine/scene'
import type { Stage } from '~/engine/stage'
import type { Director } from '~/llm/director'
import type { StoryRecord } from '~/story/storage'

export interface DebugHandle {
  scene: Scene
  stage: Stage
  director: Director
  /** The live story record (words + commands with ms since session start). */
  story?: () => StoryRecord
  /** `performance.now()` when the session started: the zero of every `t` in the story record. */
  t0?: number
  /** `performance.now()` when listening last started: the zero of the ears trace, 0 if never. */
  listenT0?: () => number
  /** The full text debug report (what the debug panel's "copy report" copies). */
  report?: () => string
}

let current: DebugHandle | null = null

/** window.__onceupon, for bx and manual poking. Also read by the debug report. */
export function exposeDebugHandle(handle: DebugHandle | null): void {
  current = handle
  const w: unknown = window
  if (typeof w === 'object' && w !== null) (w as Record<string, unknown>)['__onceupon'] = handle
}

export function getDebugHandle(): DebugHandle | null {
  return current
}
