import { setAudioModeAsync } from 'expo-audio'

/**
 * `playback` + mixWithOthers so Web Audio in the WebView ignores the silent switch. Set once at launch
 * (App.tsx). We do not force `playAndRecord` at rest: the ears modules move the shared AVAudioSession
 * to playAndRecord while they listen and put it back to playback when they stop.
 */
export async function applyAudioMode(playsInSilent: boolean): Promise<void> {
  await setAudioModeAsync({
    playsInSilentMode: playsInSilent,
    interruptionMode: 'mixWithOthers',
    allowsRecording: false,
    shouldPlayInBackground: false,
  })
}
