/**
 * Grandma's phone: captures a share link's page (apps/web /s/:id) the way it opens on a phone, taps Play
 * and records the story playing in the child's voice (screencast at device pixels + the audio tap).
 *   node scripts/marketing/capture-player.mjs <shareId> <outDir> [seconds=30]
 * The page is the local API's (http://localhost:7820/s/<id>). Its player frame is pointed at the local
 * studio dev server (same player code), because the built studio in dist-hosted calls the production API.
 * The page is laid out below a 62 px status bar (viewport 443x898 @2), so the edit can put the status bar
 * above it. Writes frames/ + frames.json, events.json (play, stop), tap-*.webm + taps.json.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { page } from './cdp.mjs'
import { READ_TAPS, TAP } from './tap.mjs'

const [id, outDir, secArg] = process.argv.slice(2)
if (!id || !outDir) {
  console.error('usage: capture-player.mjs <shareId> <outDir> [seconds]')
  process.exit(2)
}
const seconds = Number(secArg ?? 30)
const W = 443
const H = 960 - 62
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
mkdirSync(join(outDir, 'frames'), { recursive: true })

const cdp = await page()
await cdp.send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 2, mobile: true })
const contexts = new Map()
cdp.on('Runtime.executionContextCreated', (p) => contexts.set(p.context.origin, p.context.id))
await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: TAP })
await cdp.send('Page.navigate', { url: `http://localhost:7820/s/${id}` })
await sleep(3500)
await cdp.eval(`(() => { const f = document.querySelector('iframe'); f.src = 'http://localhost:7811/?player=${id}&embed=1'; return 1 })()`)
await sleep(5000)
const inPlayer = async (expression) => {
  const ctx = contexts.get('http://localhost:7811')
  if (!ctx) throw new Error('player frame context not found')
  const r = await cdp.send('Runtime.evaluate', { expression, contextId: ctx, awaitPromise: true, returnByValue: true })
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text)
  return r.result.value
}
// The Play button, in page coordinates (frame offset + button box).
const play = await inPlayer(`(() => { const b = [...document.querySelectorAll('button')].find((b) => /play/i.test(b.textContent) && b.offsetParent); if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })()`)
if (!play) throw new Error('no Play button in the player')
const frameBox = await cdp.eval(`(() => { const r = document.querySelector('iframe').getBoundingClientRect(); return { x: r.x, y: r.y } })()`)

const frames = []
cdp.on('Page.screencastFrame', (p) => {
  frames.push({ ts: p.metadata.timestamp, data: p.data })
  void cdp.send('Page.screencastFrameAck', { sessionId: p.sessionId })
})
await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 95, maxWidth: W * 2, maxHeight: H * 2, everyNthFrame: 1 })
await sleep(1500)
const events = { play: await cdp.eval('Date.now()') }
await cdp.tap(frameBox.x + play.x, frameBox.y + play.y)
await sleep(seconds * 1000)
events.stop = await cdp.eval('Date.now()')
await cdp.send('Page.stopScreencast')

frames.forEach((f, i) => writeFileSync(join(outDir, 'frames', `${String(i).padStart(5, '0')}.jpg`), Buffer.from(f.data, 'base64')))
writeFileSync(join(outDir, 'frames.json'), JSON.stringify(frames.map((f) => f.ts)))
writeFileSync(join(outDir, 'events.json'), JSON.stringify(events, null, 2))
const taps = await inPlayer(READ_TAPS)
const tapMeta = taps.map((t, i) => {
  const file = `tap-${i}-${t.kind}.webm`
  writeFileSync(join(outDir, file), Buffer.from(t.b64, 'base64'))
  return { file, kind: t.kind, start: t.start, runAt: t.runAt, state: t.state }
})
writeFileSync(join(outDir, 'taps.json'), JSON.stringify(tapMeta, null, 2))
console.log(`frames ${frames.length}; taps ${tapMeta.map((t) => `${t.file}@${t.start}`).join(', ')}`)
cdp.close()
process.exit(0)
