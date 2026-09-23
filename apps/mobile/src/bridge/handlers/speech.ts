import { ExpoSpeechRecognitionModule, type ExpoSpeechRecognitionResultEvent } from 'expo-speech-recognition'
import { z } from 'zod'
import { parseInput, type Emit, type Handler } from '../host'

// On-device iOS speech recognition (SFSpeechRecognizer via expo-speech-recognition), a possible free
// "ears" vendor. Not wired into the studio yet. Results are pushed as `speech.result` events in the
// studio's RecResult shape: iOS reports the whole transcript so far as one growing segment, so the
// list carries a single entry that turns final when recognition stops.

interface Session {
  subs: Array<{ remove(): void }>
}

let session: Session | null = null

function endSession(): void {
  if (!session) return
  for (const sub of session.subs) sub.remove()
  session = null
}

function toResults(ev: ExpoSpeechRecognitionResultEvent): Array<{ transcript: string; isFinal: boolean }> {
  const best = ev.results[0]
  return best ? [{ transcript: best.transcript, isFinal: ev.isFinal }] : []
}

function listen(emit: Emit): Session {
  const mod = ExpoSpeechRecognitionModule
  return {
    subs: [
      mod.addListener('result', (ev) => {
        emit('speech.result', { results: toResults(ev), isFinal: ev.isFinal })
      }),
      mod.addListener('error', (ev) => {
        emit('speech.error', { code: ev.error, message: ev.message })
      }),
      mod.addListener('end', () => {
        emit('speech.end', {})
        endSession()
      }),
    ],
  }
}

const startSchema = z.object({ locale: z.string().min(2), onDevice: z.boolean() })
export const speechStart: Handler<'speech.start'> = async (input, ctx) => {
  const { locale, onDevice } = parseInput(startSchema, input)
  const mod = ExpoSpeechRecognitionModule
  if (!mod.isRecognitionAvailable()) return { available: false }
  if (onDevice && !mod.supportsOnDeviceRecognition()) return { available: false }
  const perm = await mod.requestPermissionsAsync()
  if (!perm.granted) return { available: false }
  endSession()
  session = listen(ctx.emit)
  mod.start({
    lang: locale,
    interimResults: true,
    continuous: true,
    requiresOnDeviceRecognition: onDevice,
    addsPunctuation: true,
  })
  return { available: true }
}

export const speechStop: Handler<'speech.stop'> = async () => {
  if (session) ExpoSpeechRecognitionModule.stop()
  return {}
}
