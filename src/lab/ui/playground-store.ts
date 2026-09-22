/**
 * A one-slot handoff so the DetailDrawer (shown from Results or Playground) can send a CaseResult to
 * the Playground to be dissected. The DetailDrawer calls `open(result)`; App switches to the
 * Playground tab when `pending` becomes set; the Playground consumes it and calls `clear()`.
 */
import { useSyncExternalStore } from 'react'
import type { CaseResult } from '../types'

let pending: CaseResult | null = null
const listeners = new Set<() => void>()

function emit(): void {
  for (const fn of listeners) fn()
}

export const playgroundStore = {
  subscribe(fn: () => void): () => void {
    listeners.add(fn)
    return () => {
      listeners.delete(fn)
    }
  },
  getPending(): CaseResult | null {
    return pending
  },
  open(result: CaseResult): void {
    pending = result
    emit()
  },
  clear(): void {
    if (pending === null) return
    pending = null
    emit()
  },
}

/** The result waiting to be opened in the Playground, or null. */
export function usePendingPlayground(): CaseResult | null {
  return useSyncExternalStore(playgroundStore.subscribe, playgroundStore.getPending)
}
