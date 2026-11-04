import { expect, test } from 'bun:test'
import { fromSfSpeechCode, fromSwiftCode, fromThrownMessage } from './speech-codes'

test('swift codes map onto SpeechErrorCode, unknown is failed', () => {
  expect(fromSwiftCode('not-allowed')).toBe('not-allowed')
  expect(fromSwiftCode('interrupted')).toBe('interrupted')
  expect(fromSwiftCode('model')).toBe('model')
  expect(fromSwiftCode('unsupported-locale')).toBe('unsupported-locale')
  expect(fromSwiftCode('transcriber')).toBe('transcriber')
  expect(fromSwiftCode('no-format')).toBe('failed')
  expect(fromSwiftCode('no-weights')).toBe('failed')
})

test('expo-speech-recognition codes map onto SpeechErrorCode', () => {
  expect(fromSfSpeechCode('not-allowed')).toBe('not-allowed')
  expect(fromSfSpeechCode('interrupted')).toBe('interrupted')
  expect(fromSfSpeechCode('language-not-supported')).toBe('unsupported-locale')
  expect(fromSfSpeechCode('service-not-allowed')).toBe('failed')
  expect(fromSfSpeechCode('no-speech')).toBe('failed')
  expect(fromSfSpeechCode('aborted')).toBe('failed')
})

test('thrown messages: the code is found inside Expo wrapping', () => {
  expect(fromThrownMessage("Calling the 'start' function has failed\n→ Caused by: not-allowed: microphone permission denied")).toBe(
    'not-allowed'
  )
  expect(fromThrownMessage('unsupported-locale: no on-device model for xx-XX')).toBe('unsupported-locale')
  expect(fromThrownMessage('model: the language model could not download')).toBe('model')
  expect(fromThrownMessage('no-format: the analyzer offered no audio format')).toBe('failed')
  expect(fromThrownMessage('something odd')).toBe('failed')
})
