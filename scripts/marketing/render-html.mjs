/**
 * Renders a page of HTML to a transparent PNG in the capture Chrome (cdp.mjs launch), on the studio dev
 * server's origin so the app's fonts load: Gloria Hallelujah (`font-family: Scrawl`) and Patrick Hand
 * (`font-family: Hand`) are declared for you. Local images go in as data URLs (dataUrl()).
 *   import { renderHtml } from './render-html.mjs'
 *   await renderHtml('<div …>', { width: 1920, height: 1080, out: 'end.png' })
 * The body is the canvas: width x height CSS px at `scale` (default 1), transparent where nothing is drawn.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { extname } from 'node:path'
import { Cdp, PORT } from './cdp.mjs'

const STUDIO = process.env.STUDIO_ORIGIN ?? 'http://localhost:7811'
const FONTS = `
  @font-face { font-family: 'Scrawl'; src: url('/node_modules/@fontsource/gloria-hallelujah/files/gloria-hallelujah-latin-400-normal.woff2') format('woff2'); }
  @font-face { font-family: 'Hand'; src: url('/node_modules/@fontsource/patrick-hand/files/patrick-hand-latin-400-normal.woff2') format('woff2'); }
`
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml' }

export const dataUrl = (file) => `data:${MIME[extname(file).toLowerCase()] ?? 'application/octet-stream'};base64,${readFileSync(file).toString('base64')}`

export async function renderHtml(body, { width, height, out, scale = 1, css = '' }) {
  const version = await (await fetch(`http://localhost:${PORT}/json/version`)).json()
  const browser = await Cdp.connect(version.webSocketDebuggerUrl)
  const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' })
  const list = await (await fetch(`http://localhost:${PORT}/json/list`)).json()
  const cdp = await Cdp.connect(list.find((t) => t.id === targetId).webSocketDebuggerUrl)
  try {
    await cdp.send('Page.enable')
    await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: scale, mobile: false })
    await cdp.send('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } })
    await cdp.send('Page.navigate', { url: `${STUDIO}/node_modules/@fontsource/gloria-hallelujah/index.css` })
    await sleep(800)
    const html = `<!doctype html><html><head><style>${FONTS}
      html, body { margin: 0; background: transparent; width: ${width}px; height: ${height}px; overflow: hidden; }
      ${css}</style></head><body>${body}</body></html>`
    await cdp.eval(`document.open(); document.write(${JSON.stringify(html)}); document.close(); 1`)
    await cdp.eval(`Promise.all([document.fonts.load("40px Scrawl"), document.fonts.load("40px Hand")]).then(() => document.fonts.ready).then(() => Promise.all([...document.images].map((i) => i.decode().catch(() => 0)))).then(() => 1)`)
    await sleep(300)
    const shot = await cdp.send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width, height, scale: 1 } })
    writeFileSync(out, Buffer.from(shot.data, 'base64'))
    return out
  } finally {
    cdp.close()
    await browser.send('Target.closeTarget', { targetId })
    browser.close()
  }
}
