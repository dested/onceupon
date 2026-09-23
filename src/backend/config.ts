import { z } from 'zod'
import { SHELL_QUERY } from '../../packages/shared/src/bridge'
import { hasBridge } from './bridge'

/**
 * Build-time flags for hosted mode. `VITE_HOSTED=1` (from `.env.hosted`) turns the studio into the
 * relay/meter/paywall app the website serves and the iPad app bundles; without it the studio is the
 * bring-your-own-key app it has always been. Env is parsed through zod so nothing leaks in as `any`.
 */
const env = (() => {
  const parsed = z
    .object({ VITE_HOSTED: z.string().optional(), VITE_API_ORIGIN: z.string().optional() })
    .safeParse(import.meta.env)
  return parsed.success ? parsed.data : {}
})()

export const HOSTED: boolean = env.VITE_HOSTED === '1'

/** '' = same origin as the page (production); dev points at the web app on 7720 via `.env.hosted.local`. */
export const API_ORIGIN: string = (env.VITE_API_ORIGIN ?? '').replace(/\/$/, '')

export function apiUrl(path: string): string {
  const p = path.startsWith('/') ? path : `/${path}`
  return `${API_ORIGIN}${p}`
}

/**
 * True inside the native shell. Evaluated once at module load, which is safe: `hasBridge()` keys off
 * the query flag plus `window.__onceuponShell`, which the shell injects before any page script runs,
 * so a `ReactNativeWebView` that shows up a moment later cannot freeze this false (requests wait for it).
 */
export const NATIVE: boolean = hasBridge()

/**
 * The page was opened by the native shell (its URL carries `shell=native`), even if the bridge
 * failed to come up. Use it for App Store rules that must hold regardless: never send the WebView to
 * the web shop, never show web purchase links.
 */
export const APP_SHELL: boolean =
  NATIVE || (typeof window !== 'undefined' && window.location.search.includes(SHELL_QUERY))
