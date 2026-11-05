/**
 * A tiny Chrome DevTools Protocol client (Node 22+ global WebSocket, no dependencies) and a CLI to poke
 * the capture browser by hand. The capture browser is Windows Chrome, headless, started by
 * `node scripts/marketing/cdp.mjs launch`; WSL reaches its debugging port over mirrored localhost.
 *
 *   node scripts/marketing/cdp.mjs launch [w h dpr]   start headless Chrome (port 9333, profile in W:\junk\onceupon-f\assets\chrome)
 *   node scripts/marketing/cdp.mjs open <url>         navigate the capture tab
 *   node scripts/marketing/cdp.mjs js '<expr>'        evaluate (awaits promises), prints JSON
 *   node scripts/marketing/cdp.mjs shot <file.png>    full-resolution screenshot
 *   node scripts/marketing/cdp.mjs tap <x> <y>        a touch tap at CSS pixels
 *   node scripts/marketing/cdp.mjs click '<selector>' a touch tap at the element's centre
 *   node scripts/marketing/cdp.mjs type '<text>'      insert text into the focused field
 *   node scripts/marketing/cdp.mjs quit               close Chrome
 */
import { spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'

export const PORT = Number(process.env.CDP_PORT ?? 9333)
const CHROME = '/mnt/c/Program Files/Google/Chrome/Application/chrome.exe'
const PROFILE = 'W:\\junk\\onceupon-f\\assets\\chrome'

export const DEVICE = { width: 443, height: 960, dpr: 2 }

export class Cdp {
  constructor(ws) {
    this.ws = ws
    this.id = 0
    this.pending = new Map()
    this.handlers = new Map()
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(String(ev.data))
      if (msg.id !== undefined) {
        const p = this.pending.get(msg.id)
        if (!p) return
        this.pending.delete(msg.id)
        if (msg.error) p.reject(new Error(`${p.method}: ${msg.error.message}`))
        else p.resolve(msg.result)
      } else {
        for (const h of this.handlers.get(msg.method) ?? []) h(msg.params)
      }
    })
  }

  static async connect(url) {
    const ws = new WebSocket(url)
    await new Promise((res, rej) => {
      ws.addEventListener('open', res, { once: true })
      ws.addEventListener('error', rej, { once: true })
    })
    return new Cdp(ws)
  }

  send(method, params = {}) {
    const id = ++this.id
    this.ws.send(JSON.stringify({ id, method, params }))
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject, method }))
  }

  on(method, fn) {
    const list = this.handlers.get(method) ?? []
    list.push(fn)
    this.handlers.set(method, list)
  }

  async eval(expression) {
    const r = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (r.exceptionDetails) throw new Error(`eval: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`)
    return r.result.value
  }

  async tap(x, y) {
    const pt = [{ x, y, radiusX: 4, radiusY: 4, force: 1, id: 1 }]
    await this.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pt })
    await new Promise((r) => setTimeout(r, 60))
    await this.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  }

  async center(selector) {
    const r = await this.eval(
      `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return null; const b = el.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 } })()`
    )
    if (!r) throw new Error(`no element ${selector}`)
    return r
  }

  async click(selector) {
    const { x, y } = await this.center(selector)
    await this.tap(x, y)
  }

  async emulate(d = DEVICE) {
    await this.send('Emulation.setDeviceMetricsOverride', {
      width: d.width,
      height: d.height,
      deviceScaleFactor: d.dpr,
      mobile: true,
      screenWidth: d.width,
      screenHeight: d.height,
    })
    await this.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 })
  }

  close() {
    this.ws.close()
  }
}

export async function pageWsUrl() {
  const res = await fetch(`http://localhost:${PORT}/json/list`)
  const list = await res.json()
  const page = list.find((t) => t.type === 'page')
  if (!page) throw new Error('no page target: is the capture Chrome running? (cdp.mjs launch)')
  return page.webSocketDebuggerUrl
}

export async function page() {
  const cdp = await Cdp.connect(await pageWsUrl())
  await cdp.send('Page.enable')
  await cdp.send('Runtime.enable')
  // Emulation lives as long as this session, so every connection sets it again.
  await cdp.emulate()
  return cdp
}

export function launch(d = DEVICE) {
  const args = [
    '--headless=new',
    `--remote-debugging-port=${PORT}`,
    '--remote-allow-origins=*',
    `--user-data-dir=${PROFILE}`,
    '--autoplay-policy=no-user-gesture-required',
    '--no-first-run',
    '--no-default-browser-check',
    '--hide-scrollbars',
    // Headless screencasts are taken at the window's real scale, not the emulated one.
    `--force-device-scale-factor=${d.dpr}`,
    `--window-size=${d.width},${d.height}`,
    'about:blank',
  ]
  const child = spawn(CHROME, args, { detached: true, stdio: 'ignore' })
  child.unref()
  return child.pid
}

async function cli() {
  const [cmd, ...rest] = process.argv.slice(2)
  if (cmd === 'launch') {
    const d = rest.length >= 3 ? { width: Number(rest[0]), height: Number(rest[1]), dpr: Number(rest[2]) } : DEVICE
    console.log(`chrome pid ${launch(d)}`)
    for (let i = 0; i < 40; i++) {
      try {
        const cdp = await page()
        cdp.close()
        console.log(`ready on ${PORT}`)
        return
      } catch {
        await new Promise((r) => setTimeout(r, 250))
      }
    }
    throw new Error('chrome did not come up')
  }
  const cdp = await page()
  try {
    if (cmd === 'open') {
      await cdp.send('Page.navigate', { url: rest[0] })
      await new Promise((r) => setTimeout(r, 1500))
    } else if (cmd === 'js') {
      console.log(JSON.stringify(await cdp.eval(rest[0]), null, 1))
    } else if (cmd === 'shot') {
      const r = await cdp.send('Page.captureScreenshot', { format: 'png' })
      writeFileSync(rest[0], Buffer.from(r.data, 'base64'))
      console.log(rest[0])
    } else if (cmd === 'tap') {
      await cdp.tap(Number(rest[0]), Number(rest[1]))
    } else if (cmd === 'click') {
      await cdp.click(rest[0])
    } else if (cmd === 'type') {
      await cdp.send('Input.insertText', { text: rest[0] })
    } else if (cmd === 'quit') {
      const b = await (await fetch(`http://localhost:${PORT}/json/version`)).json()
      const browser = await Cdp.connect(b.webSocketDebuggerUrl)
      await browser.send('Browser.close').catch(() => undefined)
      browser.close()
    } else {
      console.log('usage: launch | open <url> | js <expr> | shot <file> | tap x y | click <sel> | type <text> | quit')
    }
  } finally {
    cdp.close()
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  cli().catch((e) => {
    console.error(e.message ?? e)
    process.exit(1)
  })
}
