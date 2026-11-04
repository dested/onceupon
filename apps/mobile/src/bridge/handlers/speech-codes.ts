import { type SpeechErrorCode } from '../../../../../packages/shared/src/bridge'

// Native ears report their own error codes: the Swift modules (on-device-ears, whistle-ears) emit
// `onError {code}` and throw `"<code>: <reason>"`, expo-speech-recognition emits its Web Speech style
// codes. The studio only ever sees SpeechErrorCode. Pure on purpose, so bun test covers it.

const SWIFT_CODES: Readonly<Record<string, SpeechErrorCode>> = {
  'not-allowed': 'not-allowed',
  interrupted: 'interrupted',
  model: 'model',
  'unsupported-locale': 'unsupported-locale',
  transcriber: 'transcriber',
}

const SF_CODES: Readonly<Record<string, SpeechErrorCode>> = {
  'not-allowed': 'not-allowed',
  interrupted: 'interrupted',
  'language-not-supported': 'unsupported-locale',
}

/** A code from a Swift ears module's `onError` event. Unknown codes are `failed`. */
export function fromSwiftCode(code: string): SpeechErrorCode {
  return SWIFT_CODES[code] ?? 'failed'
}

/** A code from expo-speech-recognition's `error` event. Unknown codes are `failed`. */
export function fromSfSpeechCode(code: string): SpeechErrorCode {
  return SF_CODES[code] ?? 'failed'
}

const THROWN = /\b(not-allowed|interrupted|model|unsupported-locale|transcriber):/

/**
 * The code inside a rejected `start()` from a Swift ears module. Expo wraps the Exception reason
 * (`"not-allowed: microphone permission denied"`) in its own text, so the code is found, not parsed.
 */
export function fromThrownMessage(message: string): SpeechErrorCode {
  const hit = THROWN.exec(message)
  return hit?.[1] ? fromSwiftCode(hit[1]) : 'failed'
}
