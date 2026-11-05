import { hashString, mulberry32 } from './rng'

/** What the Stage drives: scratch loudness every frame, a whoosh per page turn. */
export interface StageAudio {
  setIntensity(v: number): void
  pageFlip(): void
}

const SCRATCH_SECONDS = 3
const SCRATCH_GAIN = 0.09
const FLIP_SECONDS = 0.45
const FLIP_GAIN = 0.12
/** Live play has no story at audio start; any fixed seed keeps the noise off Math.random. */
const LIVE_SEED = 0x0ce0

let playback: AudioContext | null = null

/**
 * The page's one AudioContext for sound you hear: the crayon scratch and page flips, and the child's
 * voice in replay. One context means one tap (`primePlayback`) unlocks all of it on iOS, which also
 * caps how many contexts a page may hold. Null where Web Audio is missing.
 */
export function playbackContext(): AudioContext | null {
  if (playback && playback.state !== 'closed') return playback
  if (typeof AudioContext === 'undefined') return null
  try {
    playback = new AudioContext()
  } catch {
    playback = null
  }
  return playback
}

/**
 * Call synchronously inside a tap. Creates or resumes the playback context and starts one silent
 * sample: iOS only lets a context sound once something was started inside a user gesture.
 */
export function primePlayback(): void {
  const ctx = playbackContext()
  if (!ctx) return
  if (ctx.state !== 'running') void ctx.resume().catch(() => undefined)
  try {
    const src = ctx.createBufferSource()
    src.buffer = ctx.createBuffer(1, 1, ctx.sampleRate)
    src.connect(ctx.destination)
    src.start()
  } catch {
    // a context that cannot start a source yet still got its resume()
  }
}

/**
 * Synthesized wax-on-paper scratch and page flip. No assets. Noise is seeded, so the same seed
 * always makes the same sound. Live: `start()` from a user gesture. Video export: `attach()` to an
 * OfflineAudioContext with a time source (see `renderAudioCues`).
 */
export class CrayonAudio implements StageAudio {
  private ctx: BaseAudioContext | null = null
  private out: AudioNode | null = null
  private gain: GainNode | null = null
  private loop: AudioBufferSourceNode | null = null
  private time: () => number = () => 0
  private enabled = true
  private target = 0
  private flips = 0

  constructor(private seed = LIVE_SEED) {}

  async start(): Promise<void> {
    if (this.ctx) {
      if (this.ctx instanceof AudioContext && this.ctx.state === 'suspended')
        await this.ctx.resume().catch(() => undefined)
      return
    }
    const ctx = playbackContext()
    if (!ctx) return
    this.attach(ctx, ctx.destination, () => ctx.currentTime)
    if (ctx.state === 'suspended') await ctx.resume().catch(() => undefined)
  }

  /** Wire the scratch loop into `out` on `ctx`; `time` says "now" in the context's seconds. */
  attach(ctx: BaseAudioContext, out: AudioNode, time: () => number): void {
    const buffer = ctx.createBuffer(1, ctx.sampleRate * SCRATCH_SECONDS, ctx.sampleRate)
    const data = buffer.getChannelData(0)
    const rng = mulberry32(hashString(`${this.seed}:scratch`))
    let env = 0
    for (let i = 0; i < data.length; i++) {
      // crackly amplitude envelope so it sounds like fibers catching, not hiss
      if (rng() < 0.004) env = 0.4 + rng() * 0.6
      env *= 0.9992
      data[i] = (rng() * 2 - 1) * (0.25 + env)
    }
    const src = ctx.createBufferSource()
    src.buffer = buffer
    src.loop = true
    const band = ctx.createBiquadFilter()
    band.type = 'bandpass'
    band.frequency.value = 2100
    band.Q.value = 0.7
    const low = ctx.createBiquadFilter()
    low.type = 'lowpass'
    low.frequency.value = 5200
    const gain = ctx.createGain()
    gain.gain.value = 0
    src.connect(band).connect(low).connect(gain).connect(out)
    src.start(time())
    this.ctx = ctx
    this.out = out
    this.gain = gain
    this.loop = src
    this.time = time
  }

  /**
   * Stop the scratch loop and let go of the context. The shared playback context outlives every
   * screen, so a screen that is done with its CrayonAudio must dispose it or its loop runs on.
   */
  dispose(): void {
    try {
      this.loop?.stop()
    } catch {
      // never started
    }
    this.gain?.disconnect()
    this.loop = null
    this.gain = null
    this.out = null
    this.ctx = null
  }

  setEnabled(on: boolean): void {
    this.enabled = on
    if (!on) this.setIntensity(0)
  }

  /** 0 = silent, 1 = scribbling hard. Call every frame. */
  setIntensity(v: number): void {
    if (!this.ctx || !this.gain) return
    const t = this.enabled ? Math.max(0, Math.min(1, v)) : 0
    if (Math.abs(t - this.target) < 0.01) return
    this.target = t
    this.gain.gain.setTargetAtTime(t * SCRATCH_GAIN, this.time(), 0.04)
  }

  /** Whoosh for a page turn. */
  pageFlip(): void {
    if (!this.ctx || !this.out || !this.enabled) return
    const ctx = this.ctx
    const at = this.time()
    const buffer = ctx.createBuffer(1, ctx.sampleRate * FLIP_SECONDS, ctx.sampleRate)
    const d = buffer.getChannelData(0)
    const rng = mulberry32(hashString(`${this.seed}:flip:${this.flips++}`))
    for (let i = 0; i < d.length; i++) {
      const t = i / d.length
      d[i] = (rng() * 2 - 1) * Math.sin(t * Math.PI) ** 2
    }
    const src = ctx.createBufferSource()
    src.buffer = buffer
    const f = ctx.createBiquadFilter()
    f.type = 'bandpass'
    f.frequency.setValueAtTime(600, at)
    f.frequency.exponentialRampToValueAtTime(3000, at + FLIP_SECONDS)
    f.Q.value = 1.2
    const g = ctx.createGain()
    g.gain.value = FLIP_GAIN
    src.connect(f).connect(g).connect(this.out)
    src.start(at)
  }
}

export type AudioCue = { t: number; k: 'level'; v: number } | { t: number; k: 'flip' }

/** Records what the Stage asks of its audio (with clock time in ms) so it can be rendered offline afterwards. */
export class AudioCues implements StageAudio {
  readonly cues: AudioCue[] = []
  constructor(private now: () => number) {}

  setIntensity(v: number): void {
    this.cues.push({ t: this.now(), k: 'level', v })
  }

  pageFlip(): void {
    this.cues.push({ t: this.now(), k: 'flip' })
  }
}

export const EXPORT_SAMPLE_RATE = 48000

/**
 * Play recorded cues through a CrayonAudio attached to an OfflineAudioContext: the same engine and
 * seed as live play, rendered faster than real time. `extra` mixes more sources in (the child's voice).
 */
export function renderAudioCues(
  cues: readonly AudioCue[],
  seconds: number,
  seed: number,
  extra?: (ctx: OfflineAudioContext) => void
): Promise<AudioBuffer> {
  const ctx = new OfflineAudioContext(
    2,
    Math.max(1, Math.ceil(seconds * EXPORT_SAMPLE_RATE)),
    EXPORT_SAMPLE_RATE
  )
  let now = 0
  const audio = new CrayonAudio(seed)
  audio.attach(ctx, ctx.destination, () => now)
  for (const cue of cues) {
    now = cue.t / 1000
    if (cue.k === 'level') audio.setIntensity(cue.v)
    else audio.pageFlip()
  }
  extra?.(ctx)
  return ctx.startRendering()
}
