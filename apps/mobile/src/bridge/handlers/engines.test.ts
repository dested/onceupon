import { expect, test } from 'bun:test'
import { listEngines, pickEngine, sfspeechUsable } from './engines'

test('only engines that can start are listed, in preference order', () => {
  expect(listEngines({ analyzer: true, sfspeech: true, whistle: true })).toEqual(['analyzer', 'sfspeech', 'whistle'])
  // The Simulator: the analyzer's transcriber is unavailable and the locale's recognizer is not.
  expect(listEngines({ analyzer: false, sfspeech: false, whistle: false })).toEqual([])
  expect(listEngines({ analyzer: false, sfspeech: true, whistle: false })).toEqual(['sfspeech'])
})

test('sfspeech: the per-locale native check wins over the default-locale checks', () => {
  const base = { recognitionAvailable: true, onDeviceSupported: true, onDevice: true }
  expect(sfspeechUsable({ ...base, native: false })).toBe(false)
  expect(sfspeechUsable({ ...base, native: true })).toBe(true)
  expect(sfspeechUsable({ ...base, native: true, recognitionAvailable: false })).toBe(true)
})

test('sfspeech: without the native check, on-device needs both default-locale checks', () => {
  expect(sfspeechUsable({ native: null, recognitionAvailable: true, onDeviceSupported: true, onDevice: true })).toBe(true)
  expect(sfspeechUsable({ native: null, recognitionAvailable: true, onDeviceSupported: false, onDevice: true })).toBe(false)
  expect(sfspeechUsable({ native: null, recognitionAvailable: true, onDeviceSupported: false, onDevice: false })).toBe(true)
  expect(sfspeechUsable({ native: null, recognitionAvailable: false, onDeviceSupported: true, onDevice: false })).toBe(false)
})

test('pickEngine: asked-for when listed, else first non-whistle, else null', () => {
  expect(pickEngine(['analyzer', 'sfspeech', 'whistle'])).toBe('analyzer')
  expect(pickEngine(['analyzer', 'sfspeech', 'whistle'], 'whistle')).toBe('whistle')
  expect(pickEngine(['sfspeech'], 'analyzer')).toBe('sfspeech')
  expect(pickEngine(['whistle'])).toBeNull()
  expect(pickEngine([])).toBeNull()
})
