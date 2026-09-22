import { isLiveModel } from './openai-realtime'
import {
  CHROME_TRACKER,
  DEEPGRAM_TRACKER,
  LIVE_TRACKER,
  PHRASE_TRACKER,
  type TrackerOptions,
} from './recognition'
import { resolveStt, type Settings } from '~/story/store'

/**
 * When does a thought become a beat? The tracker's release rules per recognizer, plus the
 * mic-energy hold. Lives apart from the session so the debug report can print them.
 */

/**
 * Mic level (0..1, `rms * 6` from the streaming recognizers) that counts as a voice. A quiet room
 * sits under ~0.1; a child talking near the mic reads 0.3 to 1. Tune here if beats hold too long.
 */
export const VOICE_LEVEL = 0.2
/** How long after the last loud frame the child still counts as talking. */
export const VOICE_HOLD_MS = 400

/** The release rules the tracker runs for these settings. */
export function trackerOptionsFor(settings: Settings): TrackerOptions {
  const kind = resolveStt(settings)
  if (kind === 'openai') return isLiveModel(settings.sttModel) ? LIVE_TRACKER : PHRASE_TRACKER
  if (kind === 'deepgram') return DEEPGRAM_TRACKER
  return CHROME_TRACKER
}
