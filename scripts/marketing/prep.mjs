/**
 * Readies the capture browser's studio like a family that bought minutes: closes the first-launch intro,
 * passes the grown-up gate and the consent card once, makes the local device a buyer (buyer.ts, local
 * DATABASE_URL only), and empties the shelf. Run after `cdp.mjs launch`, before capture-live.mjs.
 *   node scripts/marketing/prep.mjs [studioUrl]
 */
import { execFileSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { page } from './cdp.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const STUDIO = process.argv[2] ?? 'http://localhost:7811/?shell=native&fakeshell=1'
const DB = 'postgresql://postgres@localhost:5432/onceupon_voice'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve']

const cdp = await page()
const visible = (sel) => cdp.eval(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); return !!el && !!el.offsetParent })()`)
const clickText = (text) =>
  cdp.eval(`(() => { const b = [...document.querySelectorAll('button')].find((b) => b.offsetParent && (b.getAttribute('aria-label') || b.textContent.trim()) === ${JSON.stringify(text)}); if (b) b.click(); return !!b })()`)

await cdp.send('Page.navigate', { url: STUDIO })
await sleep(4000)
if (await clickText('Skip')) await sleep(800)

// One mic tap opens the gate, then the consent card; agree, then pause the mic again.
await cdp.click('[data-testid=mic]')
await sleep(1200)
if (await visible('[data-testid=gate-question]')) {
  const q = await cdp.eval(`document.querySelector('[data-testid=gate-question]').textContent`)
  const m = /what is (\w+) times (\w+)/i.exec(q)
  if (!m) throw new Error(`gate question not understood: ${q}`)
  const answer = WORDS.indexOf(m[1].toLowerCase()) * WORDS.indexOf(m[2].toLowerCase())
  await cdp.eval(`document.querySelector('[data-testid=gate-answer]').focus(); 1`)
  await cdp.send('Input.insertText', { text: String(answer) })
  await cdp.click('[data-testid=gate-go]')
  await sleep(1200)
}
if (await clickText('I agree')) await sleep(1500)
if (await cdp.eval(`window.__fakeShell.listening`)) {
  await cdp.click('[data-testid=mic]')
  await sleep(1000)
}

const installId = await cdp.eval(`localStorage.getItem('fakeshell.installId')`)
console.log(
  execFileSync('bun', [join(ROOT, 'scripts', 'marketing', 'buyer.ts'), installId], {
    cwd: join(ROOT, 'apps', 'web'),
    env: { ...process.env, DATABASE_URL: DB },
    encoding: 'utf8',
  }).trim()
)

// Empty shelf: drop the fake shell's saved stories and voice blobs, then reload into a fresh story.
await cdp.eval(`Object.keys(localStorage).filter((k) => k.startsWith('fakeshell.story.') || k.startsWith('fakeshell.blob.')).forEach((k) => localStorage.removeItem(k)); 1`)
await cdp.send('Page.navigate', { url: STUDIO })
await sleep(4000)
console.log(await cdp.eval(`JSON.stringify({ mic: !!document.querySelector('[data-testid=mic]'), chip: document.querySelector('[aria-label*="story time left"]')?.getAttribute('aria-label') ?? null })`))
cdp.close()
