/**
 * Captures one marketing story told live in the hosted studio: the kid voice's words are fed to the fake
 * native shell (`__fakeShell.say`) at their spoken timestamps, the voice clip is handed back as the
 * shell's own recording (so Replay plays the child's voice), and the screen is captured frame by frame
 * (CDP screencast at device pixels) with the app's own audio tapped inside the page.
 *
 *   node scripts/marketing/cdp.mjs launch                  # once: headless Windows Chrome on :9333
 *   node scripts/marketing/capture-live.mjs <theme> <outDir> [studioUrl]
 *   AFTER=share node …   # end on "Send to grandma" → Make a link (events.shareUrl) instead of Play it again
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
import { READ_TAPS, TAP } from './tap.mjs'

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
if (process.env.AFTER === 'share') {
  // "Send to grandma": the share card, "Make a link" (with the voice), then the ready link.
  const btn = (re) => `(() => { const b = [...document.querySelectorAll('button')].find((b) => ${re}.test(b.textContent) && b.offsetParent); if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })()`
  await mark('shareTap')
  const sg = await cdp.eval(btn('/send to grandma/i'))
  if (!sg) throw new Error('no Send to grandma button')
  await cdp.tap(sg.x, sg.y)
  await sleep(1200)
  // Sharing sits behind the grown-up gate: solve it (the edit cuts it out).
  if (await cdp.eval(`!!document.querySelector('[data-testid=gate-question]')`)) {
    await mark('gate')
    const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve']
    const q = await cdp.eval(`document.querySelector('[data-testid=gate-question]').textContent`)
    const m = /what is (\w+) times (\w+)/i.exec(q)
    if (!m) throw new Error(`gate question not understood: ${q}`)
    await sleep(1000)
    await cdp.eval(`document.querySelector('[data-testid=gate-answer]').focus(); 1`)
    await cdp.send('Input.insertText', { text: String(WORDS.indexOf(m[1].toLowerCase()) * WORDS.indexOf(m[2].toLowerCase())) })
    await sleep(500)
    await mark('gateGo')
    await cdp.click('[data-testid=gate-go]')
    await sleep(1800)
  }
  if (!(await cdp.eval(`!!document.querySelector('[data-testid=share-voice-toggle]')?.checked`))) throw new Error('share card has no voice (consent off?)')
  await mark('makeTap')
  const mk = await cdp.eval(`(() => { const r = document.querySelector('[data-testid=share-make]').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })()`)
  await cdp.tap(mk.x, mk.y)
  for (let i = 0; i < 80 && !(await cdp.eval(`!!document.querySelector('[data-testid=share-url]')`)); i++) await sleep(250)
  await mark('linkReady')
  events.shareUrl = await cdp.eval(`document.querySelector('[data-testid=share-url]')?.textContent ?? ''`)
  if (!events.shareUrl) throw new Error('no share link')
  console.log('shareUrl', events.shareUrl)
  await sleep(4000)
} else {
  await mark('replayTap')
  const pa = await cdp.eval(`(() => { const b = ${playAgainJs}; if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })()`)
  if (!pa) throw new Error('no Play it again button')
  await cdp.tap(pa.x, pa.y)
  await sleep(Math.round(schedule.total * 1000) + 6000)
  await mark('shelfTap')
  await cdp.click('[data-testid=replay-back]')
  await sleep(3500)
}
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

const taps = await cdp.eval(READ_TAPS)
const tapMeta = taps.map((t, i) => {
  const file = `tap-${i}-${t.kind}.webm`
  writeFileSync(join(outDir, file), Buffer.from(t.b64, 'base64'))
  return { file, kind: t.kind, start: t.start, runAt: t.runAt, state: t.state }
})
writeFileSync(join(outDir, 'taps.json'), JSON.stringify(tapMeta, null, 2))
console.log(`frames ${frames.length} over ${(frames.at(-1).ts - frames[0].ts).toFixed(1)} s; taps ${tapMeta.map((t) => `${t.file}@${t.start}`).join(', ')}`)
cdp.close()
