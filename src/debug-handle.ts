import type { Scene } from '~/engine/scene'
import type { Stage } from '~/engine/stage'
import type { Director } from '~/llm/director'

export interface DebugHandle {
  scene: Scene
  stage: Stage
  director: Director
}

/** window.__onceupon, for bx and manual poking. Not used by app code. */
export function exposeDebugHandle(handle: DebugHandle | null): void {
  const w: unknown = window
  if (typeof w === 'object' && w !== null) (w as Record<string, unknown>)['__onceupon'] = handle
}
