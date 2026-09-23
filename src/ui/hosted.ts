import { appStore } from '~/story/store'

/**
 * Small helpers shared by the hosted-mode surfaces (the grown-up gate, the paywall, the parent area).
 * All of this is inert in bring-your-own-key builds: `gate()` resolves true immediately when not hosted.
 */

/** `m:ss` from a count of seconds, never negative. */
export function formatMinutes(sec: number): string {
  const s = Math.max(0, Math.round(sec))
  const m = Math.floor(s / 60)
  const r = s % 60
  return `${m}:${r.toString().padStart(2, '0')}`
}

// --- The grown-up gate (Apple Kids rule: a math challenge before purchases, link-outs, or the mic) ---

let gateResolver: ((ok: boolean) => void) | null = null

/**
 * Open the parental gate and resolve when the grown-up solves it (true) or gives up / cancels (false).
 * `ParentGate` (rendered once in App) watches `gateRequest` and drives the dialog. In BYO mode there is
 * nothing to gate, so this resolves true right away.
 */
export function gate(): Promise<boolean> {
  if (!appStore.get().hosted) return Promise.resolve(true)
  // A gate already waiting is superseded: resolve the old one as cancelled before starting a new one.
  gateResolver?.(false)
  gateResolver = null
  return new Promise<boolean>((resolve) => {
    gateResolver = resolve
    appStore.set((s) => ({ gateRequest: s.gateRequest + 1 }))
  })
}

/** Called by `ParentGate` when the challenge is solved or dismissed. Idempotent. */
export function resolveGate(ok: boolean): void {
  const r = gateResolver
  gateResolver = null
  r?.(ok)
}

/** A hook shape for the gate, in case a component would rather pull it from context later. */
export function useGate(): () => Promise<boolean> {
  return gate
}

// --- Opening the parent area, optionally scrolled to a section ---

let parentFocus: 'redeem' | null = null

/** Open the parent area (closing the paywall). `focus` scrolls to a section once the panel mounts. */
export function openParentArea(focus: 'redeem' | null = null): void {
  parentFocus = focus
  appStore.set({ parentOpen: true, paywallOpen: false })
}

/** Read and clear the pending parent-area focus target. */
export function takeParentFocus(): 'redeem' | null {
  const f = parentFocus
  parentFocus = null
  return f
}

// --- Starting a fresh story (shared by the story screen's "New story" and the paywall's rebuy) ---

/** Reset the store for a brand-new story: remount the story screen with a clean session. */
export function startFreshStory(): void {
  appStore.set((s) => ({
    storyNonce: s.storyNonce + 1,
    ending: false,
    ended: false,
    transcriptFinal: '',
    transcriptInterim: '',
    drawingWords: '',
    queuedWords: '',
    note: '',
    pages: [],
    lines: [],
    calls: [],
    endReason: null,
  }))
}
