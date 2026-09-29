import { Directory, File, Paths } from 'expo-file-system'
import { ExpoSpeechRecognitionModule, type ExpoSpeechRecognitionResultEvent } from 'expo-speech-recognition'
import { z } from 'zod'
import type { SpeechEngine } from '../../../../../packages/shared/src/bridge'
import { analyzerAvailable, onDeviceEars } from '../../../modules/on-device-ears'
import { parseInput, type Emit, type Handler } from '../host'

// On-device ears (free, no network after the first model download). Two engines behind one contract:
// - `analyzer`: SpeechAnalyzer on iPadOS 26+ (modules/on-device-ears), segments finalize as the child
//   pauses, the live tail streams as volatile text;
// - `sfspeech`: on-device SFSpeechRecognizer (expo-speech-recognition) on older iPadOS, one growing
//   segment that turns final when recognition stops.
// Both push `speech.result` in the studio's RecResult shape plus `speech.level` / `speech.ready`, and
// with `record` both keep the span's audio: `speech.stop` hands it back as base64 (the studio's voice
// clip; its own mic stays closed while these ears listen).

interface Session {
  engine: SpeechEngine
  subs: Array<{ remove(): void }>
  record: boolean
  /** sfspeech: resolves with the persisted file once `audioend` fires. */
  audioEnd: Promise<{ uri: string | null; ms: number }> | null
  startedAt: number
}

let session: Session | null = null

function endSession(): void {
  if (!session) return
  for (const sub of session.subs) sub.remove()
  session = null
}

function clipDir(): Directory {
  const dir = new Directory(Paths.cache, 'ears')
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true })
  return dir
}

async function readClip(uri: string | null, mime: string, ms: number): Promise<{ base64: string; mime: string; ms: number } | null> {
  if (!uri) return null
  const file = new File(uri)
  try {
    if (!file.exists || file.size === 0) return null
    return { base64: await file.base64(), mime, ms }
  } catch {
    return null
  } finally {
    try {
      if (file.exists) file.delete()
    } catch {
      // cache files are cleaned by the OS eventually
    }
  }
}

function listenAnalyzer(emit: Emit): Session['subs'] {
  const mod = onDeviceEars()
  if (!mod) return []
  return [
    mod.addListener('onReady', () => emit('speech.ready', {})),
    mod.addListener('onResult', (e) => {
      const results = e.finals.map((t) => ({ transcript: t, isFinal: true }))
      if (e.volatile) results.push({ transcript: e.volatile, isFinal: false })
      emit('speech.result', { results, isFinal: e.volatile === '' })
    }),
    mod.addListener('onLevel', (e) => emit('speech.level', { level: e.level })),
    mod.addListener('onError', (e) => emit('speech.error', { code: e.code, message: e.message })),
    mod.addListener('onEnd', () => emit('speech.end', {})),
  ]
}

function toResults(ev: ExpoSpeechRecognitionResultEvent): Array<{ transcript: string; isFinal: boolean }> {
  const best = ev.results[0]
  return best ? [{ transcript: best.transcript, isFinal: ev.isFinal }] : []
}

function listenSfSpeech(emit: Emit, s: Session): void {
  const mod = ExpoSpeechRecognitionModule
  let startTs = 0
  let resolveEnd: ((v: { uri: string | null; ms: number }) => void) | null = null
  s.audioEnd = new Promise((resolve) => {
    resolveEnd = resolve
  })
  s.subs.push(
    mod.addListener('start', () => emit('speech.ready', {})),
    mod.addListener('audiostart', (ev) => {
      startTs = ev.timestamp
    }),
    mod.addListener('audioend', (ev) => {
      resolveEnd?.({ uri: ev.uri, ms: Math.max(0, Math.round(ev.timestamp - startTs)) })
    }),
    // volumechange is -2..10; the studio's level is 0..1 with a voice around 0.3+.
    mod.addListener('volumechange', (ev) => emit('speech.level', { level: Math.max(0, Math.min(1, ev.value / 10)) })),
    mod.addListener('result', (ev) => emit('speech.result', { results: toResults(ev), isFinal: ev.isFinal })),
    mod.addListener('error', (ev) => emit('speech.error', { code: ev.error, message: ev.message })),
    mod.addListener('end', () => {
      emit('speech.end', {})
      resolveEnd?.({ uri: null, ms: 0 })
    })
  )
}

async function pickEngine(locale: string, onDevice: boolean): Promise<SpeechEngine | null> {
  if (await analyzerAvailable(locale)) return 'analyzer'
  const mod = ExpoSpeechRecognitionModule
  if (!mod.isRecognitionAvailable()) return null
  if (onDevice && !mod.supportsOnDeviceRecognition()) return null
  return 'sfspeech'
}

const availableSchema = z.object({ locale: z.string().min(2) })
export const speechAvailable: Handler<'speech.available'> = async (input) => {
  const { locale } = parseInput(availableSchema, input)
  const engine = await pickEngine(locale, true)
  const mic = await ExpoSpeechRecognitionModule.getMicrophonePermissionsAsync()
  const permission = mic.granted ? 'granted' : mic.canAskAgain ? 'undetermined' : 'denied'
  return { engine, permission }
}

const startSchema = z.object({ locale: z.string().min(2), onDevice: z.boolean(), record: z.boolean().optional() })
export const speechStart: Handler<'speech.start'> = async (input, ctx) => {
  const { locale, onDevice, record = false } = parseInput(startSchema, input)
  const engine = await pickEngine(locale, onDevice)
  if (!engine) return { available: false }
  endSession()
  const s: Session = { engine, subs: [], record, audioEnd: null, startedAt: Date.now() }

  if (engine === 'analyzer') {
    const mod = onDeviceEars()
    if (!mod) return { available: false }
    s.subs = listenAnalyzer(ctx.emit)
    session = s
    const path = record ? new File(clipDir(), `span-${Date.now()}.m4a`).uri : null
    try {
      await mod.start(locale, path)
    } catch (e) {
      endSession()
      const message = e instanceof Error ? e.message : String(e)
      ctx.emit('speech.error', { code: /not-allowed/.test(message) ? 'not-allowed' : 'analyzer', message })
      return { available: false }
    }
    return { available: true, engine }
  }

  const mod = ExpoSpeechRecognitionModule
  const perm = await mod.requestPermissionsAsync()
  if (!perm.granted) return { available: false }
  listenSfSpeech(ctx.emit, s)
  session = s
  mod.start({
    lang: locale,
    interimResults: true,
    continuous: true,
    requiresOnDeviceRecognition: onDevice,
    addsPunctuation: true,
    volumeChangeEventOptions: { enabled: true, intervalMillis: 100 },
    ...(record
      ? { recordingOptions: { persist: true, outputDirectory: clipDir().uri, outputSampleRate: 16000 } }
      : {}),
  })
  return { available: true, engine }
}

export const speechStop: Handler<'speech.stop'> = async () => {
  const s = session
  if (!s) return { clip: null }
  if (s.engine === 'analyzer') {
    const mod = onDeviceEars()
    const out = mod ? await mod.stop() : null
    endSession()
    return { clip: s.record && out ? await readClip(out.uri, 'audio/mp4', out.ms) : null }
  }
  ExpoSpeechRecognitionModule.stop()
  const end = s.audioEnd ? await Promise.race([s.audioEnd, new Promise<null>((r) => setTimeout(() => r(null), 3000))]) : null
  endSession()
  return { clip: s.record && end ? await readClip(end.uri, 'audio/wav', end.ms) : null }
}
