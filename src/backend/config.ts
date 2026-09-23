import { z } from 'zod'
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

/** True inside the native shell (the WebView bridge is present and the shell said so in the query). */
export const NATIVE: boolean = hasBridge()
