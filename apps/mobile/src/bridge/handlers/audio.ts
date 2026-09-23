import { setAudioModeAsync } from 'expo-audio'
import { z } from 'zod'
import { parseInput, type Handler } from '../host'

// Kept apart from the other OS switches so App.tsx can set the session at launch without pulling in
// notifications/store-review.

/**
 * `playback` + mixWithOthers so Web Audio in the WebView ignores the silent switch. We do not force
 * `playAndRecord` at rest: WebKit moves the shared AVAudioSession to playAndRecord itself while
 * getUserMedia is live, and plain playback keeps full-quality output otherwise. WebKit may leave its
 * own category behind after the mic stops, so the studio can call `audio.mode` again to restore it.
 */
export async function applyAudioMode(playsInSilent: boolean): Promise<void> {
  await setAudioModeAsync({
    playsInSilentMode: playsInSilent,
    interruptionMode: 'mixWithOthers',
    allowsRecording: false,
    shouldPlayInBackground: false,
  })
}

const audioSchema = z.object({ playsInSilent: z.boolean() })
export const audioMode: Handler<'audio.mode'> = async (input) => {
  const { playsInSilent } = parseInput(audioSchema, input)
  await applyAudioMode(playsInSilent)
  return {}
}
