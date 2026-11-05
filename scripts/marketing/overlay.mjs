/**
 * Renders a text overlay as a transparent PNG in the studio's own look: a paper sticker (ink outline,
 * hard offset shadow, slight tilt) with the words in the scrawl hand (Gloria Hallelujah), at 2x.
 * Uses the capture Chrome (cdp.mjs launch) and the studio dev server for the font.
 *   node scripts/marketing/overlay.mjs <out.png> "<text>" [cssFontPx=30] [tiltDeg=-2]
 */
import { writeFileSync } from 'node:fs'
import { Cdp, PORT } from './cdp.mjs'

const [out, text, sizeArg, tiltArg] = process.argv.slice(2)
if (!out || !text) {
  console.error('usage: overlay.mjs <out.png> "<text>" [cssFontPx] [tiltDeg]')
  process.exit(2)
}
if (text.split(/\s+/).length > 4 || /\.$/.test(text)) throw new Error('overlays are at most 4 words, no period')
const size = Number(sizeArg ?? 30)
const tilt = Number(tiltArg ?? -2)
const STUDIO = process.env.STUDIO_ORIGIN ?? 'http://localhost:7811'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const version = await (await fetch(`http://localhost:${PORT}/json/version`)).json()
const browser = await Cdp.connect(version.webSocketDebuggerUrl)
const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' })
const list = await (await fetch(`http://localhost:${PORT}/json/list`)).json()
const target = list.find((t) => t.id === targetId)
const cdp = await Cdp.connect(target.webSocketDebuggerUrl)
try {
  await cdp.send('Page.enable')
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 443, height: 300, deviceScaleFactor: 2, mobile: true })
  await cdp.send('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } })
  // Same origin as the dev server, so the font loads without CORS.
  await cdp.send('Page.navigate', { url: `${STUDIO}/node_modules/@fontsource/gloria-hallelujah/index.css` })
  await sleep(800)
  const html = `<!doctype html><html><head><style>
    @font-face { font-family: 'Gloria Hallelujah'; src: url('/node_modules/@fontsource/gloria-hallelujah/files/gloria-hallelujah-latin-400-normal.woff2') format('woff2'); }
    html, body { margin: 0; background: transparent; }
    .wrap { padding: 24px; display: inline-block; }
    .sticker { display: inline-block; font-family: 'Gloria Hallelujah'; font-size: ${size}px; line-height: 1.25; color: #3b2f2f;
      background: #fbf6ea; border: 3px solid #3b2f2f; border-radius: 18px; box-shadow: 4px 5px 0 #3b2f2f;
      padding: 6px 22px 8px; transform: rotate(${tilt}deg); white-space: nowrap; }
  </style></head><body><div class="wrap"><div class="sticker">${text.replace(/</g, '&lt;')}</div></div></body></html>`
  await cdp.eval(`document.open(); document.write(${JSON.stringify(html)}); document.close(); 1`)
  await cdp.eval(`document.fonts.load("${size}px 'Gloria Hallelujah'").then(() => document.fonts.ready).then(() => 1)`)
  await sleep(300)
  const box = await cdp.eval(`(() => { const r = document.querySelector('.wrap').getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height } })()`)
  const shot = await cdp.send('Page.captureScreenshot', {
    format: 'png',
    clip: { ...box, scale: 1 },
    captureBeyondViewport: true,
  })
  writeFileSync(out, Buffer.from(shot.data, 'base64'))
  console.log(`${out} ${Math.round(box.width * 2)}x${Math.round(box.height * 2)}`)
} finally {
  cdp.close()
  await browser.send('Target.closeTarget', { targetId })
  browser.close()
}
