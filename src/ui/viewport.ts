import { useSyncExternalStore } from 'react'

/**
 * The visible viewport inside the iPad WebView, as CSS variables on <html>. The shell's WebView never
 * resizes for the keyboard and never scrolls (scrollEnabled=false), so the page has to do both itself:
 *
 * - `--sat/--sar/--sab/--sal`: the safe-area insets (app.css maps them to env(); `fakeInsets` overrides).
 * - `--kb`: px of the layout viewport the on-screen keyboard covers at the bottom (0 when closed).
 * - `--vv-top`: px iOS panned the visual viewport down to reveal a focused field.
 * - `html.kb-open`: while the keyboard is up; bottom trays switch to `position: fixed` above it.
 *
 * Overlays pad themselves by these (`.modal-overlay`, `.new-story-dialog` in app.css), so a modal sits
 * in the space above the keyboard, and the focused field is scrolled into view inside its card.
 */

export interface KeyboardState {
  /** Covered px at the bottom of the layout viewport. */
  kb: number
  /** Visual viewport pan from the top of the layout viewport. */
  top: number
}

/** A keyboard shorter than this is a hardware-keyboard accessory bar or rounding noise, not a keyboard. */
const MIN_KEYBOARD = 80

let state: KeyboardState = { kb: 0, top: 0 }
let fakeKb: number | null = null
const listeners = new Set<() => void>()
let installed = false
let revealTimer = 0

function measure(): KeyboardState {
  if (fakeKb !== null) return { kb: fakeKb, top: 0 }
  const vv = window.visualViewport
  if (!vv) return { kb: 0, top: 0 }
  const layoutH = document.documentElement.clientHeight
  const top = Math.max(0, Math.round(vv.offsetTop))
  const covered = Math.round(layoutH - vv.offsetTop - vv.height)
  return { kb: covered >= MIN_KEYBOARD ? covered : 0, top: covered >= MIN_KEYBOARD ? top : 0 }
}

function apply(): void {
  const next = measure()
  const wasOpen = state.kb > 0
  if (next.kb === state.kb && next.top === state.top) return
  state = next
  const root = document.documentElement
  root.style.setProperty('--kb', `${next.kb}px`)
  root.style.setProperty('--vv-top', `${next.top}px`)
  root.classList.toggle('kb-open', next.kb > 0)
  // The document itself must never stay scrolled: iOS scrolls it to reveal a field even when it cannot scroll.
  if (!next.kb && wasOpen) resetDocumentScroll()
  for (const l of listeners) l()
  if (next.kb > 0) revealFocused()
}

function resetDocumentScroll(): void {
  if (window.scrollX !== 0 || window.scrollY !== 0) window.scrollTo(0, 0)
  const app = document.getElementById('app')
  if (app && app.scrollTop !== 0) app.scrollTop = 0
}

function isTextField(el: Element | null): el is HTMLInputElement | HTMLTextAreaElement {
  if (el instanceof HTMLTextAreaElement) return true
  if (!(el instanceof HTMLInputElement)) return false
  return !['checkbox', 'radio', 'range', 'button', 'submit', 'reset', 'file', 'color'].includes(el.type)
}

function scrollParent(el: Element): HTMLElement | null {
  for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
    const oy = getComputedStyle(p).overflowY
    if ((oy === 'auto' || oy === 'scroll') && p.scrollHeight > p.clientHeight) return p
  }
  return null
}

/** Scroll the focused field into the visible part of its own scroll box (never the document). */
function revealFocused(): void {
  const el = document.activeElement
  if (!isTextField(el)) return
  // Wait for overlays to re-lay out with the new --kb (their padding eases over 180ms).
  window.clearTimeout(revealTimer)
  revealTimer = window.setTimeout(() => {
    const box = scrollParent(el)
    if (!box) return
    const r = el.getBoundingClientRect()
    const b = box.getBoundingClientRect()
    const vv = window.visualViewport
    const visTop = Math.max(b.top, vv ? vv.offsetTop : 0)
    const visBottom = Math.min(b.bottom, vv ? vv.offsetTop + vv.height : window.innerHeight)
    const margin = 16
    if (r.bottom + margin > visBottom) box.scrollTop += r.bottom + margin - visBottom
    else if (r.top - margin < visTop) box.scrollTop -= visTop - (r.top - margin)
  }, 220)
}

/** Wire the viewport listeners once, before first render. Safe to call more than once. */
export function installViewport(): void {
  if (installed) return
  installed = true
  const vv = window.visualViewport
  vv?.addEventListener('resize', apply)
  vv?.addEventListener('scroll', apply)
  window.addEventListener('resize', apply)
  window.addEventListener('orientationchange', () => window.setTimeout(apply, 250))
  // Focus moving between fields keeps the keyboard up but the new field may be hidden.
  document.addEventListener('focusin', (e) => {
    if (state.kb > 0 && isTextField(e.target instanceof Element ? e.target : null)) revealFocused()
  })
  document.addEventListener('focusout', () => window.setTimeout(apply, 60))
  apply()
  if (import.meta.env.DEV) exposeViewportDebug()
}

/** Current keyboard overlap, for components that need it in JS (CSS should prefer `var(--kb)`). */
export function useKeyboard(): KeyboardState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => state
  )
}

/** Dev only: pretend a keyboard of `px` is up (null = measure the real one again). */
export function fakeKeyboard(px: number | null): void {
  fakeKb = px
  apply()
}

/** Dev only: override the safe-area insets (null = back to env()). */
export function fakeInsets(insets: { top: number; right: number; bottom: number; left: number } | null): void {
  const root = document.documentElement
  const names = { top: '--sat', right: '--sar', bottom: '--sab', left: '--sal' } as const
  for (const side of ['top', 'right', 'bottom', 'left'] as const) {
    if (insets) root.style.setProperty(names[side], `${insets[side]}px`)
    else root.style.removeProperty(names[side])
  }
}

function exposeViewportDebug(): void {
  const w: unknown = window
  if (typeof w === 'object' && w !== null) {
    Reflect.set(w, '__viewport', { fakeKeyboard, fakeInsets, state: () => state })
  }
}
