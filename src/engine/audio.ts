/** Synthesized wax-on-paper scratch. No assets. Must be started from a user gesture. */
export class CrayonAudio {
  private ctx: AudioContext | null = null
  private gain: GainNode | null = null
  private enabled = true
  private target = 0

  async start(): Promise<void> {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') await this.ctx.resume()
      return
    }
    const ctx = new AudioContext()
    const seconds = 3
    const buffer = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate)
    const data = buffer.getChannelData(0)
    let env = 0
    for (let i = 0; i < data.length; i++) {
      // crackly amplitude envelope so it sounds like fibers catching, not hiss
      if (Math.random() < 0.004) env = 0.4 + Math.random() * 0.6
      env *= 0.9992
      data[i] = (Math.random() * 2 - 1) * (0.25 + env)
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
    src.connect(band).connect(low).connect(gain).connect(ctx.destination)
    src.start()
    this.ctx = ctx
    this.gain = gain
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
    this.gain.gain.setTargetAtTime(t * 0.09, this.ctx.currentTime, 0.04)
  }

  /** Whoosh for a page turn. */
  pageFlip(): void {
    if (!this.ctx || !this.enabled) return
    const ctx = this.ctx
    const len = 0.45
    const buffer = ctx.createBuffer(1, ctx.sampleRate * len, ctx.sampleRate)
    const d = buffer.getChannelData(0)
    for (let i = 0; i < d.length; i++) {
      const t = i / d.length
      d[i] = (Math.random() * 2 - 1) * Math.sin(t * Math.PI) ** 2
    }
    const src = ctx.createBufferSource()
    src.buffer = buffer
    const f = ctx.createBiquadFilter()
    f.type = 'bandpass'
    f.frequency.setValueAtTime(600, ctx.currentTime)
    f.frequency.exponentialRampToValueAtTime(3000, ctx.currentTime + len)
    f.Q.value = 1.2
    const g = ctx.createGain()
    g.gain.value = 0.12
    src.connect(f).connect(g).connect(ctx.destination)
    src.start()
  }
}
