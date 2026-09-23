import * as Application from 'expo-application'
import { Asset } from 'expo-asset'
import { BRAND, STUDIO_PATH } from '../../../packages/shared/src/brand'
import { SHELL_QUERY } from '../../../packages/shared/src/bridge'
import studioHtml from '../assets/studio.html'

/** The hosted studio, flagged as running inside the native shell. */
export const REMOTE_STUDIO_URL = `${BRAND.origin}${STUDIO_PATH}?${SHELL_QUERY}`

export type StudioSource =
  | { kind: 'remote'; uri: string }
  | { kind: 'local'; uri: string; readAccess: string }

/** The hosted studio with a cache-busting version tag so an app update loads the matching web build. */
export function remoteSource(): StudioSource {
  const version = Application.nativeApplicationVersion ?? '0'
  return { kind: 'remote', uri: `${REMOTE_STUDIO_URL}&v=${encodeURIComponent(version)}` }
}

/** The bundled single-file studio copy, unpacked to a local file the WebView can read. */
export async function localSource(): Promise<StudioSource> {
  const asset = Asset.fromModule(studioHtml)
  await asset.downloadAsync()
  const filePath = asset.localUri ?? asset.uri
  const readAccess = filePath.slice(0, filePath.lastIndexOf('/') + 1)
  // The shell query must be present offline too, so the studio's `hasBridge()` detects the shell.
  return { kind: 'local', uri: `${filePath}?${SHELL_QUERY}`, readAccess }
}
