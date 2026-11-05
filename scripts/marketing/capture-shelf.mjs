/**
 * Captures the bookshelf ("My stories") as the studio shows it: opens the studio, taps the shelf button
 * and screencasts it at device pixels. Run after the stories are told (capture-live.mjs) and the shelf
 * holds only the finished takes.
 *   node scripts/marketing/capture-shelf.mjs <outDir> [seconds=4] [studioUrl]
 * Writes <outDir>/frames/NNNNN.jpg + frames.json + events.json (shelfTap, epoch ms).
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { page } from './cdp.mjs'

const [outDir, secArg, studioArg] = process.argv.slice(2)
if (!outDir) {
  console.error('usage: capture-shelf.mjs <outDir> [seconds] [studioUrl]')
  process.exit(2)
}
const seconds = Number(secArg ?? 4)
const STUDIO = studioArg ?? 'http://localhost:7811/?shell=native&fakeshell=1'
const INSETS = { top: 62, right: 0, bottom: 34, left: 0 }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

mkdirSync(join(outDir, 'frames'), { recursive: true })
const cdp = await page()
await cdp.send('Page.navigate', { url: STUDIO })
await sleep(4000)
await cdp.eval(`window.__viewport.fakeInsets(${JSON.stringify(INSETS)}); 1`)
await sleep(800)

const frames = []
cdp.on('Page.screencastFrame', (p) => {
  frames.push({ ts: p.metadata.timestamp, data: p.data })
  void cdp.send('Page.screencastFrameAck', { sessionId: p.sessionId })
})
await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 95, maxWidth: 886, maxHeight: 1920, everyNthFrame: 1 })
await sleep(800)
const shelfTap = await cdp.eval('Date.now()')
await cdp.click('[aria-label="Bookshelf"]')
await sleep(seconds * 1000)
const stop = await cdp.eval('Date.now()')
await cdp.send('Page.stopScreencast')
frames.forEach((f, i) => writeFileSync(join(outDir, 'frames', `${String(i).padStart(5, '0')}.jpg`), Buffer.from(f.data, 'base64')))
writeFileSync(join(outDir, 'frames.json'), JSON.stringify(frames.map((f) => f.ts)))
writeFileSync(join(outDir, 'events.json'), JSON.stringify({ shelfTap, stop }, null, 2))
console.log(`frames ${frames.length} over ${(frames.at(-1).ts - frames[0].ts).toFixed(1)} s`)
cdp.close()
