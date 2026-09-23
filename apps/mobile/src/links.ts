import { BRAND, STUDIO_PATH } from '../../../packages/shared/src/brand'

const STUDIO_PREFIX = STUDIO_PATH.replace(/\/$/, '')

/** True for URLs the WebView itself may show: the studio (hosted or bundled) and blank pages. */
export function isStudioUrl(url: string): boolean {
  if (url.startsWith('about:') || url.startsWith('file://')) return true
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  if (parsed.origin !== BRAND.origin) return false
  return parsed.pathname === STUDIO_PREFIX || parsed.pathname.startsWith(`${STUDIO_PREFIX}/`)
}
