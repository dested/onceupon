/**
 * End-to-end smoke test for /api/app/* against a running server (bun run dev on :7720).
 * Run: `bun scripts/smoke-api.ts` (optionally BASE=http://localhost:7720).
 *
 * Proves: register -> state -> config -> session.start -> beat -> stop, that a second register with the
 * same installId rotates the token and keeps the balance, and that /api/app/draw answers (503 upstream
 * with no ANTHROPIC key, or an NDJSON text + usage stream with one).
 */
const BASE = process.env.BASE ?? 'http://localhost:7720'

let failures = 0

function check(name: string, ok: boolean, detail?: unknown): void {
  if (ok) {
    console.log(`  ok   ${name}`)
  } else {
    failures++
    console.error(`  FAIL ${name}${detail === undefined ? '' : ` — ${JSON.stringify(detail)}`}`)
  }
}

async function call(name: string, body: unknown, token: string | null): Promise<unknown> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (token) headers['x-device-token'] = token
  const res = await fetch(`${BASE}/api/app/${name}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })
  const json = await res.json().catch(() => null)
  if (!res.ok) throw new Error(`${name} ${res.status}: ${JSON.stringify(json)}`)
  return json
}

function asRecord(v: unknown): Record<string, unknown> {
  if (typeof v !== 'object' || v === null) throw new Error('expected an object response')
  const out: Record<string, unknown> = {}
  for (const [k, val] of Object.entries(v)) out[k] = val
  return out
}

async function main(): Promise<void> {
  const installId = `smoke-${Date.now()}`

  const reg = asRecord(await call('device.register', { installId, platform: 'web', appVersion: '0.0.0', storefront: null }, null))
  const token = String(reg.deviceToken)
  check('register returns a token', token.length > 0)
  check('register grants the free first story (120s)', reg.balanceSec === 120, reg.balanceSec)

  const state = asRecord(await call('device.state', {}, token))
  check('state balance is 120', state.balanceSec === 120, state.balanceSec)

  const config = asRecord(await call('config', {}, token))
  check('config has a model', typeof config.model === 'string')
  check('config has shopUrl', typeof config.shopUrl === 'string')

  const start = asRecord(await call('session.start', { storyId: 'story-1', ears: 'browser' }, token))
  const sessionId = String(start.sessionId)
  check('session.start remaining is 120', start.remainingSec === 120, start.remainingSec)
  check('session.start ears is null for browser', start.ears === null, start.ears)

  const beat = asRecord(await call('session.beat', { sessionId, listeningMs: 15000 }, token))
  check('beat leaves 105s', beat.remainingSec === 105, beat.remainingSec)

  const stop = asRecord(await call('session.stop', { sessionId, listeningMs: 3000, ended: 'the-end' }, token))
  check('stop leaves 102s', stop.remainingSec === 102, stop.remainingSec)

  // Re-register the same install: new token, same (kept) balance.
  const reg2 = asRecord(await call('device.register', { installId, platform: 'web', appVersion: '0.0.1', storefront: null }, null))
  check('re-register rotates the token', String(reg2.deviceToken) !== token)
  check('re-register keeps the balance (102)', reg2.balanceSec === 102, reg2.balanceSec)

  // Draw relay.
  const start2 = asRecord(await call('session.start', { storyId: 'story-2', ears: 'browser' }, String(reg2.deviceToken)))
  const drawRes = await fetch(`${BASE}/api/app/draw`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-device-token': String(reg2.deviceToken) },
    body: JSON.stringify({
      sessionId: String(start2.sessionId),
      system: 'You draw. Reply with one short line.',
      user: [{ text: 'a red circle' }],
      maxTokens: 200,
      dialect: 'ops',
      restart: false,
    }),
  })
  if (drawRes.status === 503) {
    const body = await drawRes.json().catch(() => null)
    check('draw answers 503 upstream with no ANTHROPIC key', asRecord(body).error !== undefined, body)
  } else if (drawRes.ok && drawRes.body) {
    const text = await drawRes.text()
    const lines = text.split('\n').filter((l) => l.trim().length > 0)
    const kinds = lines.map((l) => {
      try {
        return asRecord(JSON.parse(l)).k
      } catch {
        return null
      }
    })
    check('draw streams NDJSON with a usage line', kinds.includes('usage'), kinds)
  } else {
    check('draw returned a known outcome', false, drawRes.status)
  }

  console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`)
  if (failures > 0) process.exit(1)
}

main().catch((e) => {
  console.error(`smoke run failed: ${e instanceof Error ? e.message : String(e)}`)
  process.exit(1)
})
