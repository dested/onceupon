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

/**
 * Synthesized wax-on-paper scratch and page flip. No assets. Noise is seeded, so the same seed
 * always makes the same sound. Live: `start()` from a user gesture. Video export: `attach()` to an
 * OfflineAudioContext with a time source (see `renderAudioCues`).
 */
export class CrayonAudio implements StageAudio {
  private ctx: BaseAudioContext | null = null
  private out: AudioNode | null = null
  private gain: GainNode | null = null
  private time: () => number = () => 0
  private enabled = true
  private target = 0
  private flips = 0

  constructor(private seed = LIVE_SEED) {}

  async start(): Promise<void> {
    if (this.ctx) {
      if (this.ctx instanceof AudioContext && this.ctx.state === 'suspended')
        await this.ctx.resume()
      return
    }
    const ctx = new AudioContext()
    this.attach(ctx, ctx.destination, () => ctx.currentTime)
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
    this.time = time
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
