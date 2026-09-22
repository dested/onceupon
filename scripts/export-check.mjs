/**
 * MP4 export check (see verify.md). Node, not Bun: Chrome's pipe transport hangs under Bun on Windows.
 *   bx stop   # frees bx's profile, which holds the saved stories
 *   node scripts/export-check.mjs <outDir> <storyId> [runs=2]
 * Exports the story through the replay screen's Download button `runs` times, writes
 * <outDir>/<storyId>-<n>.mp4 and hashes-<n>.txt (a hash of every frame fed to the encoder), and
 * prints bytes, wall time and the longest main-thread gap. Automated Chrome here exits on any real
 * download, so the Blob handed to the download link is captured instead.
 * Env: PLAYWRIGHT_CORE (default: bx's global playwright-core), BX_PROFILE (default: bx default profile).
 */
import { writeFileSync } from 'fs'
import { homedir } from 'os'
import { pathToFileURL } from 'url'
const home = homedir().split('\\').join('/')
const { chromium } = await import(
  pathToFileURL(
    process.env.PLAYWRIGHT_CORE ??
      `${home}/.bun/install/global/node_modules/playwright-core/index.mjs`
  ).href
)
const [S, id, runsArg] = process.argv.slice(2)
const runs = Number(runsArg ?? 2)
const ctx = await chromium.launchPersistentContext(
  process.env.BX_PROFILE ?? `${home}/.bx/profiles/default`,
  { channel: 'chrome', headless: true, viewport: { width: 1280, height: 800 } }
)
// Automated Chrome here exits on any download, so capture the exact Blob the app hands to its download link.
await ctx.addInitScript(() => {
  const VF = window.VideoFrame
  window.__hashes = []
  window.VideoFrame = class extends VF {
    constructor(src, init) {
      super(src, init)
      if (src instanceof HTMLCanvasElement) {
        const d = src.getContext('2d').getImageData(0, 0, src.width, src.height).data
        let h = 2166136261
        for (let k = 0; k < d.length; k += 7) {
          h ^= d[k]
          h = Math.imul(h, 16777619)
        }
        window.__hashes.push(h >>> 0)
      }
    }
  }
  const orig = URL.createObjectURL.bind(URL)
  URL.createObjectURL = (b) => {
    if (b instanceof Blob && b.type === 'video/mp4') window.__mp4 = b
    return orig(b)
  }
  const click = HTMLAnchorElement.prototype.click
  HTMLAnchorElement.prototype.click = function () {
    if (this.download) {
      window.__mp4Name = this.download
      return
    }
    return click.call(this)
  }
})
const page = await ctx.newPage()
page.setDefaultTimeout(15000)
page.on('console', (m) => {
  if (m.type() === 'error' && !m.text().includes('WebSocket')) console.log('console:', m.text())
})
await page.goto('http://localhost:7710/')
const title = await page.evaluate(
  (id) => JSON.parse(localStorage.getItem('onceupon.stories')).find((r) => r.id === id).title,
  id
)
if (process.env.CANCEL) {
  await page
    .getByRole('button', { name: /Bookshelf|My stories/ })
    .first()
    .click()
  await page
    .getByRole('button', { name: `Play ${title}` })
    .first()
    .click()
  await page.waitForTimeout(800)
  await page.getByTestId('download-video').click()
  await page.waitForTimeout(600)
  await page.getByTestId('export-cancel').click()
  await page.waitForTimeout(3000)
  console.log(
    'card after cancel:',
    await page.getByTestId('export-card').count(),
    'mp4 handed to download:',
    await page.evaluate(() => Boolean(window.__mp4Name))
  )
}
for (let i = 1; i <= runs; i++) {
  await page.goto('http://localhost:7710/')
  await page
    .getByRole('button', { name: /Bookshelf|My stories/ })
    .first()
    .click()
  await page
    .getByRole('button', { name: `Play ${title}` })
    .first()
    .click()
  await page.waitForTimeout(800)
  const t0 = Date.now()
  await page.getByTestId('download-video').click()
  let maxLag = 0
  // Main-thread responsiveness while exporting: longest gap between rAF ticks.
  await page.evaluate(() => {
    window.__lag = 0
    let last = performance.now()
    const tick = (now) => {
      window.__lag = Math.max(window.__lag, now - last)
      last = now
      if (!window.__mp4Name) requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })
  if (i === 1) {
    await page.waitForTimeout(700)
    await page.screenshot({ path: `${S}/progress-card.png` })
  }
  await page.waitForFunction(() => window.__mp4Name, null, { timeout: 300000 })
  maxLag = await page.evaluate(() => window.__lag)
  const b64 = await page.evaluate(async () => {
    const buf = new Uint8Array(await window.__mp4.arrayBuffer())
    let s = ''
    for (let k = 0; k < buf.length; k += 0x8000)
      s += String.fromCharCode(...buf.subarray(k, k + 0x8000))
    window.__mp4Name = null
    return btoa(s)
  })
  const bytes = Buffer.from(b64, 'base64')
  writeFileSync(`${S}/${id}-${i}.mp4`, bytes)
  writeFileSync(
    `${S}/hashes-${i}.txt`,
    (
      await page.evaluate(() => {
        const h = window.__hashes
        window.__hashes = []
        return h
      })
    ).join(',')
  )
  console.log(
    `run ${i}: ${bytes.length} bytes in ${((Date.now() - t0) / 1000).toFixed(1)}s, longest frame gap ${maxLag.toFixed(0)}ms`
  )
}
await ctx.close()
