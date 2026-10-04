import { Directory, File, Paths } from 'expo-file-system'
import { ExpoSpeechRecognitionModule, type ExpoSpeechRecognitionResultEvent } from 'expo-speech-recognition'
import { z } from 'zod'
import { SPEECH_ENGINES, type SpeechEngine } from '../../../../../packages/shared/src/bridge'
import { analyzerAvailable, onDeviceEars, type EarsNativeModule } from '../../../modules/on-device-ears'
import { whistleAvailable, whistleEars } from '../../../modules/whistle-ears'
import { parseInput, type Emit, type Handler } from '../host'

// On-device ears (free, no network after the first model download). Three engines behind one contract:
// - `analyzer`: SpeechAnalyzer on iPadOS 26+ (modules/on-device-ears), segments finalize as the child
//   pauses, the live tail streams as volatile text;
// - `sfspeech`: on-device SFSpeechRecognizer (expo-speech-recognition) on older iPadOS, one growing
//   segment that turns final when recognition stops;
// - `whistle`: the bundled Cactus Whistle model (modules/whistle-ears), same events as the analyzer;
//   never picked by the shell itself, only when the studio asks for it.
// All push `speech.result` in the studio's RecResult shape plus `speech.level` / `speech.ready`, and
// with `record` all keep the span's audio: `speech.stop` hands it back as base64 (the studio's voice
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

/** The native module behind an engine that has one (sfspeech runs through expo-speech-recognition). */
function nativeEars(engine: SpeechEngine): EarsNativeModule | null {
  if (engine === 'analyzer') return onDeviceEars()
  if (engine === 'whistle') return whistleEars()
  return null
}

function listenNative(mod: EarsNativeModule, emit: Emit): Session['subs'] {
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

/** Every engine this iPad can run for the locale, in the shell's own order of preference. */
async function availableEngines(locale: string, onDevice: boolean): Promise<SpeechEngine[]> {
  const out: SpeechEngine[] = []
  if (await analyzerAvailable(locale)) out.push('analyzer')
  const mod = ExpoSpeechRecognitionModule
  if (mod.isRecognitionAvailable() && (!onDevice || mod.supportsOnDeviceRecognition())) out.push('sfspeech')
  if (await whistleAvailable(locale)) out.push('whistle')
  return out
}

/** The asked-for engine when it can run, else the shell's pick (never whistle by itself). */
function pickEngine(engines: SpeechEngine[], want?: SpeechEngine): SpeechEngine | null {
  if (want && engines.includes(want)) return want
  return engines.find((e) => e !== 'whistle') ?? null
}

const availableSchema = z.object({ locale: z.string().min(2) })
export const speechAvailable: Handler<'speech.available'> = async (input) => {
  const { locale } = parseInput(availableSchema, input)
  const engines = await availableEngines(locale, true)
  const engine = pickEngine(engines)
  const mic = await ExpoSpeechRecognitionModule.getMicrophonePermissionsAsync()
  const permission = mic.granted ? 'granted' : mic.canAskAgain ? 'undetermined' : 'denied'
  return { engine, engines, permission }
}

const startSchema = z.object({
  locale: z.string().min(2),
  onDevice: z.boolean(),
  record: z.boolean().optional(),
  engine: z.enum(SPEECH_ENGINES).optional(),
})
export const speechStart: Handler<'speech.start'> = async (input, ctx) => {
  const { locale, onDevice, record = false, engine: want } = parseInput(startSchema, input)
  const engine = pickEngine(await availableEngines(locale, onDevice), want)
  if (!engine) return { available: false }
  endSession()
  const s: Session = { engine, subs: [], record, audioEnd: null, startedAt: Date.now() }

  if (engine !== 'sfspeech') {
    const mod = nativeEars(engine)
    if (!mod) return { available: false }
    s.subs = listenNative(mod, ctx.emit)
    session = s
    // The analyzer writes AAC, whistle 16 kHz PCM.
    const path = record ? new File(clipDir(), `span-${Date.now()}.${engine === 'whistle' ? 'wav' : 'm4a'}`).uri : null
    try {
      await mod.start(locale, path)
    } catch (e) {
      endSession()
      const message = e instanceof Error ? e.message : String(e)
      ctx.emit('speech.error', { code: /not-allowed/.test(message) ? 'not-allowed' : engine, message })
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
  if (s.engine !== 'sfspeech') {
    const mod = nativeEars(s.engine)
    const out = mod ? await mod.stop() : null
    endSession()
    const mime = s.engine === 'whistle' ? 'audio/wav' : 'audio/mp4'
    return { clip: s.record && out ? await readClip(out.uri, mime, out.ms) : null }
  }
  ExpoSpeechRecognitionModule.stop()
  const end = s.audioEnd ? await Promise.race([s.audioEnd, new Promise<null>((r) => setTimeout(() => r(null), 3000))]) : null
  endSession()
  return { clip: s.record && end ? await readClip(end.uri, 'audio/wav', end.ms) : null }
}
