/**
 * In-page audio tap shared by the capture scripts. Inject with Page.addScriptToEvaluateOnNewDocument (it runs
 * in every frame): every AudioContext the page makes, and media elements routed through one tap context,
 * are recorded by MediaRecorders (webm/opus 256k), timestamped with the page's Date.now(). Read them back
 * with READ_TAPS (an expression that resolves to [{ kind, start, runAt, state, b64 }]); the audio starts at
 * runAt (when the context first ran), which is start unless it began suspended.
 */
// Taps every AudioContext the app makes (and media elements, routed through one tap context) into
// MediaRecorders, timestamped with the page's Date.now().
export const TAP = `(() => {
  const Orig = window.AudioContext
  if (!Orig || window.__taps) return
  const taps = (window.__taps = [])
  // Every gain ramp the app asks for (the crayon scratch follows the reveal), epoch ms.
  window.__gainLog = []
  const stt = AudioParam.prototype.setTargetAtTime
  AudioParam.prototype.setTargetAtTime = function (v, t, c) { window.__gainLog.push([Date.now(), Math.round(v * 1000) / 1000]); return stt.call(this, v, t, c) }
  const connect = AudioNode.prototype.connect
  class Tapped extends Orig {
    constructor(...a) {
      super(...a)
      try {
        const dest = this.createMediaStreamDestination()
        // A silent source keeps the stream running, so stretches with no sound stay in the recording
        // (otherwise the recorder's timeline can skip them and drift from the wall clock).
        const keep = this.createConstantSource()
        keep.offset.value = 0
        connect.call(keep, dest)
        keep.start()
        const rec = new MediaRecorder(dest.stream, { mimeType: 'audio/webm;codecs=opus', audioBitsPerSecond: 256000 })
        const tap = { kind: 'ctx', dest, rec, chunks: [], start: Date.now(), ctx: this }
        rec.ondataavailable = (e) => { if (e.data.size) tap.chunks.push(e.data) }
        rec.start(500)
        tap.start = Date.now()
        // A context made before any gesture starts suspended, and its recording only begins on resume.
        if (this.state === 'running') tap.runAt = tap.start
        else this.addEventListener('statechange', () => { if (this.state === 'running' && !tap.runAt) tap.runAt = Date.now() })
        this.__tap = tap
        taps.push(tap)
      } catch (e) { console.warn('tap failed', e) }
    }
  }
  window.AudioContext = Tapped
  window.webkitAudioContext = Tapped
  AudioNode.prototype.connect = function (dest, ...rest) {
    const r = connect.call(this, dest, ...rest)
    if (dest instanceof AudioDestinationNode && dest.context.__tap) {
      try { connect.call(this, dest.context.__tap.dest, ...rest) } catch {}
    }
    return r
  }
  const play = HTMLMediaElement.prototype.play
  HTMLMediaElement.prototype.play = function (...a) {
    if (!this.__tapped) {
      this.__tapped = true
      try {
        if (!window.__mediaCtx) { window.__mediaCtx = new Tapped(); window.__mediaCtx.__tap.kind = 'media' }
        const src = window.__mediaCtx.createMediaElementSource(this)
        src.connect(window.__mediaCtx.destination)
      } catch (e) { console.warn('media tap', e) }
    }
    return play.apply(this, a)
  }
})()`


export const READ_TAPS = `Promise.all((window.__taps ?? []).map((t) => new Promise((res) => {
  const done = () => { const fr = new FileReader(); fr.onload = () => res({ kind: t.kind, start: t.start, runAt: t.runAt ?? null, state: t.ctx.state, b64: String(fr.result).split(',')[1] ?? '' }); fr.readAsDataURL(new Blob(t.chunks, { type: 'audio/webm' })) }
  if (t.rec.state === 'inactive') done(); else { t.rec.onstop = done; t.rec.stop() }
})))`
