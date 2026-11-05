/**
 * Captures one marketing story told live in the hosted studio: the kid voice's words are fed to the fake
 * native shell (`__fakeShell.say`) at their spoken timestamps, the voice clip is handed back as the
 * shell's own recording (so Replay plays the child's voice), and the screen is captured frame by frame
 * (CDP screencast at device pixels) with the app's own audio tapped inside the page.
 *
 *   node scripts/marketing/cdp.mjs launch                  # once: headless Windows Chrome on :9333
 *   node scripts/marketing/capture-live.mjs <theme> <outDir> [studioUrl]
 *
 * Needs the local studio (hosted mode) and API (local DATABASE_URL), a device that already passed the
 * grown-up gate and consent in this Chrome profile, and `scripts/marketing/voice.ts` output.
 * Writes to <outDir>: frames/NNNNN.jpg + frames.json ({ ts } per frame, epoch s), tap-*.webm (app audio)
 * + taps.json, clip.m4a + voice.wav (the spoken timeline), schedule.json, events.json (epoch ms).
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { page } from './cdp.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const [theme, outDir, studioArg] = process.argv.slice(2)
if (!theme || !outDir) {
  console.error('usage: capture-live.mjs <theme> <outDir> [studioUrl]')
  process.exit(2)
}
const STUDIO = studioArg ?? 'http://localhost:7811/?shell=native&fakeshell=1'
/** iPhone 17 Pro Max portrait safe area (pt). */
const INSETS = { top: 62, right: 0, bottom: 34, left: 0 }
/** Seconds: mic open → first word; between sentences; before "The End" (the crayon finishes); after. */
const LEAD = 0.9
const GAP = 1.3
const GAP_BEFORE_END = 3.4
const TAIL = 0.8

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// --- the spoken timeline ---------------------------------------------------------------------------
const voiceDir = join(ROOT, 'store', 'marketing', 'voice')
const voice = JSON.parse(readFileSync(join(voiceDir, `${theme}.json`), 'utf8'))
mkdirSync(join(outDir, 'frames'), { recursive: true })

const schedule = { lead: LEAD, lines: [], total: 0 }
let at = LEAD
voice.lines.forEach((line, i) => {
  schedule.lines.push({ text: line.text.replace(/!$/, ''), at, dur: line.dur, file: line.file, words: line.words })
  const next = voice.lines[i + 1]
  at += line.dur + (next ? (/^the end/i.test(next.text) ? GAP_BEFORE_END : GAP) : TAIL)
})
schedule.total = at
writeFileSync(join(outDir, 'schedule.json'), JSON.stringify(schedule, null, 2))

// One wav of the whole span (silence + lines at their offsets), then the clip the shell hands back.
const inputs = schedule.lines.flatMap((l) => ['-i', join(voiceDir, l.file)])
const delays = schedule.lines
  .map((l, i) => `[${i}:a]aresample=48000,adelay=${Math.round(l.at * 1000)}:all=1[a${i}]`)
  .join(';')
const mix = `${delays};${schedule.lines.map((_, i) => `[a${i}]`).join('')}amix=inputs=${schedule.lines.length}:normalize=0,apad=whole_dur=${schedule.total},atrim=0:${schedule.total}[out]`
execFileSync('ffmpeg', ['-y', '-v', 'error', ...inputs, '-filter_complex', mix, '-map', '[out]', '-ac', '1', join(outDir, 'voice.wav')])
execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', join(outDir, 'voice.wav'), '-c:a', 'aac', '-b:a', '96k', join(outDir, 'clip.m4a')])
const clipB64 = readFileSync(join(outDir, 'clip.m4a')).toString('base64')

// --- in-page instruments -----------------------------------------------------------------------------
// Taps every AudioContext the app makes (and media elements, routed through one tap context) into
// MediaRecorders, timestamped with the page's Date.now().
const TAP = `(() => {
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
        const rec = new MediaRecorder(dest.stream, { mimeType: 'audio/webm;codecs=opus', audioBitsPerSecond: 256000 })
        const tap = { kind: 'ctx', dest, rec, chunks: [], start: Date.now(), ctx: this }
        rec.ondataavailable = (e) => { if (e.data.size) tap.chunks.push(e.data) }
        rec.start(500)
        tap.start = Date.now()
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

// Answers speech.start by playing the schedule into __fakeShell.say, and speech.stop with the clip.
const SPEAKER = (sched, clip) => `(() => {
  const sched = ${JSON.stringify(sched)}
  const shell = window.__fakeShell
  const rn = window.ReactNativeWebView
  if (!shell || !rn) throw new Error('fake shell missing')
  const post = rn.postMessage
  window.__speak = { t0: 0, stopAt: 0, said: [] }
  const reply = (id, output) => setTimeout(() => window.__onceuponBridge.receive({ v: 1, id, ok: true, output }), 5)
  rn.postMessage = (raw) => {
    const r = JSON.parse(raw)
    if (r.type === 'speech.start' && !window.__speak.t0) {
      const t0 = Date.now()
      window.__speak.t0 = t0
      for (const line of sched.lines) {
        const words = line.text.split(/\\s+/)
        line.words.forEach((w, i) => {
          setTimeout(() => {
            const partial = words.slice(0, i + 1).join(' ')
            shell.say(partial, false)
            window.__speak.said.push([Date.now() - t0, partial])
          }, Math.round((line.at + w.start) * 1000))
        })
        setTimeout(() => { shell.say(line.text, true); window.__speak.said.push([Date.now() - t0, 'FINAL ' + line.text]) }, Math.round((line.at + line.dur + 0.25) * 1000))
      }
    }
    if (r.type === 'speech.stop' && window.__speak.t0 && !window.__speak.stopAt) {
      window.__speak.stopAt = Date.now()
      shell.calls.push({ type: r.type, input: r.input })
      shell.listening = false
      reply(r.id, { clip: { base64: ${JSON.stringify(clip)}, mime: 'audio/mp4', ms: Date.now() - window.__speak.t0 } })
      return
    }
    return post(raw)
  }
  return 'armed'
})()`

// --- capture -------------------------------------------------------------------------------------------
const cdp = await page()
await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: TAP })
await cdp.send('Page.navigate', { url: STUDIO })
await sleep(4000)
await cdp.eval(`window.__viewport.fakeInsets(${JSON.stringify(INSETS)}); 1`)
await sleep(800)
const micReady = await cdp.eval(`!!document.querySelector('[data-testid=mic]')`)
if (!micReady) throw new Error('no mic button: is the story screen up (tutorial closed, gate passed)?')
console.log(await cdp.eval(SPEAKER(schedule, clipB64)))

const frames = []
cdp.on('Page.screencastFrame', (p) => {
  frames.push({ ts: p.metadata.timestamp, data: p.data })
  void cdp.send('Page.screencastFrameAck', { sessionId: p.sessionId })
})
const events = {}
const mark = async (name) => {
  events[name] = await cdp.eval('Date.now()')
  console.log(`${name} ${events[name]}`)
}
await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 95, maxWidth: 886, maxHeight: 1920, everyNthFrame: 1 })
await sleep(1500)
await mark('micTap')
await cdp.click('[data-testid=mic]')

// Wait for the closing card's "Play it again".
const playAgainJs = `[...document.querySelectorAll('[data-testid=the-end-card] button')].find((b) => /play it again/i.test(b.textContent))`
// A note about the crayon slipping (a failed drawing) spoils the take: flag it.
const notes = new Set()
for (let i = 0; i < 160; i++) {
  if (await cdp.eval(`!!${playAgainJs}`)) break
  const note = await cdp.eval(`document.querySelector('[data-testid=note]')?.textContent ?? ''`)
  if (note) notes.add(note)
  await sleep(250)
}
events.notes = [...notes]
writeFileSync(join(outDir, 'debug-report.txt'), String(await cdp.eval(`(() => { try { return window.__onceupon?.report?.() ?? '' } catch (e) { return String(e) } })()`)))
if (notes.size > 0) console.log(`NOTES (retake?): ${[...notes].join(' | ')}`)
await mark('endCard')
await sleep(3000)
await mark('replayTap')
const pa = await cdp.eval(`(() => { const b = ${playAgainJs}; if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })()`)
if (!pa) throw new Error('no Play it again button')
await cdp.tap(pa.x, pa.y)
await sleep(Math.round(schedule.total * 1000) + 6000)
await mark('shelfTap')
await cdp.click('[data-testid=replay-back]')
await sleep(3500)
await mark('done')
await mark('stop')
await cdp.send('Page.stopScreencast')

// --- write everything ---------------------------------------------------------------------------------
frames.forEach((f, i) => writeFileSync(join(outDir, 'frames', `${String(i).padStart(5, '0')}.jpg`), Buffer.from(f.data, 'base64')))
writeFileSync(join(outDir, 'frames.json'), JSON.stringify(frames.map((f) => f.ts)))
const speak = await cdp.eval('window.__speak')
events.speakT0 = speak.t0
events.speechStop = speak.stopAt
writeFileSync(join(outDir, 'events.json'), JSON.stringify({ ...events, said: speak.said, gain: await cdp.eval('window.__gainLog') }, null, 2))

const taps = await cdp.eval(`Promise.all(window.__taps.map((t) => new Promise((res) => {
  const done = () => { const fr = new FileReader(); fr.onload = () => res({ kind: t.kind, start: t.start, state: t.ctx.state, b64: String(fr.result).split(',')[1] ?? '' }); fr.readAsDataURL(new Blob(t.chunks, { type: 'audio/webm' })) }
  if (t.rec.state === 'inactive') done(); else { t.rec.onstop = done; t.rec.stop() }
})))`)
const tapMeta = taps.map((t, i) => {
  const file = `tap-${i}-${t.kind}.webm`
  writeFileSync(join(outDir, file), Buffer.from(t.b64, 'base64'))
  return { file, kind: t.kind, start: t.start, state: t.state }
})
writeFileSync(join(outDir, 'taps.json'), JSON.stringify(tapMeta, null, 2))
console.log(`frames ${frames.length} over ${(frames.at(-1).ts - frames[0].ts).toFixed(1)} s; taps ${tapMeta.map((t) => `${t.file}@${t.start}`).join(', ')}`)
cdp.close()
