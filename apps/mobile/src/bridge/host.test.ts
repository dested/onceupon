import { expect, test } from 'bun:test'
import type { BridgeRequest } from '../../../../packages/shared/src/bridge'
import { BridgeHost, type Handlers, type HostContext } from './host'

const ctx: HostContext = {
  platform: 'ios',
  getSource: () => 'remote',
  getOnline: () => true,
}

// The expo modules can't run under bun, so the host is exercised with a fake handler map and a fake
// `send` that just collects the JS strings the shell would have injected into the WebView.
function makeHost() {
  const sent: string[] = []
  const handlers: Partial<Handlers> = {
    'net.state': async () => ({ online: true }),
    'speech.stop': async (_input, handlerCtx) => {
      handlerCtx.emit('speech.end', {})
      return {}
    },
  }
  const host = new BridgeHost((js) => sent.push(js), handlers, ctx)
  return { host, sent }
}

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

test('answers a net.state request with a response carrying the same id', async () => {
  const { host, sent } = makeHost()
  const request: BridgeRequest = { v: 1, id: 'req-1', type: 'net.state', input: {} }
  host.handle(JSON.stringify(request))
  await flush()
  expect(sent.length).toBe(1)
  const injected = sent[0] ?? ''
  expect(injected).toContain('window.__onceuponBridge')
  expect(injected).toContain('"id":"req-1"')
  expect(injected).toContain('"ok":true')
  expect(injected).toContain('"online":true')
})

test('ignores malformed messages without throwing or replying', async () => {
  const { host, sent } = makeHost()
  expect(() => host.handle('this is not json')).not.toThrow()
  expect(() => host.handle(JSON.stringify({ v: 2, nope: true }))).not.toThrow()
  expect(() => host.handle(JSON.stringify({ id: 42 }))).not.toThrow()
  await flush()
  expect(sent.length).toBe(0)
})

test('replies with bad_request for an unknown bridge type', async () => {
  const { host, sent } = makeHost()
  host.handle(JSON.stringify({ v: 1, id: 'req-2', type: 'does.not.exist', input: {} }))
  await flush()
  expect(sent.length).toBe(1)
  const injected = sent[0] ?? ''
  expect(injected).toContain('"id":"req-2"')
  expect(injected).toContain('"ok":false')
  expect(injected).toContain('"code":"bad_request"')
})

test('escapes a script-closing sequence in the injected payload', async () => {
  const { host, sent } = makeHost()
  // A handler whose output contains `</script>` must be escaped so it can't break out of the inject.
  const handlers: Partial<Handlers> = {
    'kv.get': async () => ({ value: '</script><script>alert(1)</script>' }),
  }
  const evil = new BridgeHost((js) => sent.push(js), handlers, ctx)
  evil.handle(JSON.stringify({ v: 1, id: 'req-3', type: 'kv.get', input: { key: 'x' } }))
  await flush()
  const injected = sent[0] ?? ''
  expect(injected).not.toContain('</script>')
  expect(injected).toContain('\\u003c/script>')
})

test('a handler can push an event through its context before replying', async () => {
  const { host, sent } = makeHost()
  const request: BridgeRequest = { v: 1, id: 'req-9', type: 'speech.stop', input: {} }
  host.handle(JSON.stringify(request))
  await flush()
  expect(sent.length).toBe(2)
  expect(sent[0] ?? '').toContain('"event":"speech.end"')
  expect(sent[1] ?? '').toContain('"id":"req-9"')
})
