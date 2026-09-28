/**
 * Play benched stories in real time through window.__proto.live: per-frame Stage render timings
 * (p50/p95/max ms) and reveal snapshots every 500ms into lab/proto/<run>/<dialect>/live-*.jpg.
 * Headless Chrome keeps rAF at full rate (a background bx tab throttles it).
 *
 *   node scripts/proto-live.mjs <run> <dialect> <story,story> [style=classic] [port=7710]
 */
import { homedir } from 'os'
import { pathToFileURL } from 'url'

const home = homedir().split('\\').join('/')
const { chromium } = await import(
  pathToFileURL(process.env.PLAYWRIGHT_CORE ?? `${home}/.bun/install/global/node_modules/playwright-core/index.mjs`).href
)
const [run, dialect, stories, ...rest] = process.argv.slice(2)
if (!run || !dialect || !stories) {
  console.error('usage: node scripts/proto-live.mjs <run> <dialect> <story,story> [style=classic] [port=7710]')
  process.exit(2)
}
const opt = Object.fromEntries(rest.map((a) => a.split('=')))
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
page.setDefaultTimeout(120000)
await page.goto(`http://localhost:${opt.port ?? '7710'}/lab.html`)
await page.waitForFunction(() => Boolean(window.__proto))
for (const id of stories.split(',')) {
  const r = await page.evaluate(([a, b, c, d]) => window.__proto.live(a, b, c, d), [run, dialect, id, opt.style ?? 'classic'])
  console.log(`${id} ${opt.style ?? 'classic'}: ${JSON.stringify(r)}`)
}
await browser.close()
