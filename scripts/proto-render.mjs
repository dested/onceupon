/**
 * Render every benched story of a run/dialect to jpgs through the lab page (window.__proto.render).
 * Node, not Bun (Chrome's pipe transport hangs under Bun on Windows). Headless, throwaway profile, so
 * several agents can render at once without touching bx.
 *
 *   node scripts/proto-render.mjs <run> <dialect> [style=classic] [port=7710] [only=id,id]
 *
 * Needs the dev server on <port> (the lab file API writes the jpgs into lab/proto/<run>/<dialect>/).
 * Prints one line per story: images written, parse errors, warnings.
 */
import { readdirSync } from 'fs'
import { homedir } from 'os'
import { pathToFileURL } from 'url'

const home = homedir().split('\\').join('/')
const { chromium } = await import(
  pathToFileURL(process.env.PLAYWRIGHT_CORE ?? `${home}/.bun/install/global/node_modules/playwright-core/index.mjs`).href
)
const [run, dialect, ...rest] = process.argv.slice(2)
if (!run || !dialect) {
  console.error('usage: node scripts/proto-render.mjs <run> <dialect> [style=classic] [port=7710] [only=id,id]')
  process.exit(2)
}
const opt = Object.fromEntries(rest.map((a) => a.split('=')))
const style = opt.style ?? 'classic'
const port = opt.port ?? '7710'
const dir = `lab/proto/${run}/${dialect}`
let ids = readdirSync(dir)
  .filter((f) => f.endsWith('.json') && !f.startsWith('_'))
  .map((f) => f.slice(0, -5))
if (opt.only) ids = ids.filter((id) => opt.only.split(',').includes(id))

const browser = await chromium.launch({ channel: 'chrome', headless: true })
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
page.setDefaultTimeout(60000)
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
await page.goto(`http://localhost:${port}/lab.html`)
await page.waitForFunction(() => Boolean(window.__proto))
let failed = 0
for (const id of ids) {
  try {
    const r = await page.evaluate(([a, b, c, d]) => window.__proto.render(a, b, c, d), [run, dialect, id, style])
    const pe = r.parseErrors.length ? ` parse=${r.parseErrors.length}: ${r.parseErrors.slice(0, 3).join(' | ')}` : ''
    const w = r.warnings.length ? ` warn=${r.warnings.length}: ${r.warnings.slice(0, 3).join(' | ')}` : ''
    console.log(`${id}: ${r.images.length} img${pe}${w}`)
  } catch (e) {
    failed++
    console.log(`${id}: FAILED ${String(e).slice(0, 300)}`)
  }
}
if (errors.length) console.log('page errors:', errors.slice(0, 5).join('\n'))
await browser.close()
process.exit(failed ? 1 : 0)
