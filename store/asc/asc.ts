#!/usr/bin/env bun
/**
 * Tiny App Store Connect API client for Squiggletale's listing work (store lane).
 *
 *   bun store/asc/asc.ts GET  /v1/apps/6815029998
 *   bun store/asc/asc.ts PATCH /v1/appStoreVersions/<id> --file store/asc/payloads/version.json
 *   bun store/asc/asc.ts POST /v1/... --data '{"data":{...}}'
 *   bun store/asc/asc.ts upload <reservation-json-file> <local file>   (asset upload operations)
 *
 * Key: QuickGame World team key, read from ASC_ENV (default G:\code\wslosx\.secrets\asc-*.env, the same
 * file app-review's preflight uses). The key is never printed. Exit 0 on 2xx, 1 on an API error, 2 on usage.
 */
import { readFileSync, readdirSync } from 'node:fs'

const SECRETS = '/mnt/g/code/wslosx/.secrets'

function winToWsl(p: string): string {
  const m = /^([A-Za-z]):[\\/](.*)$/.exec(p)
  if (!m || m[1] === undefined || m[2] === undefined) return p
  return `/mnt/${m[1].toLowerCase()}/${m[2].replace(/\\/g, '/')}`
}

function loadEnv(): { keyId: string; issuerId: string; pem: string } {
  const file =
    process.env.ASC_ENV ??
    `${SECRETS}/${readdirSync(SECRETS).find((f) => /^asc-.*\.env$/.test(f)) ?? 'missing-asc.env'}`
  const vars = new Map<string, string>()
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z_]+)\s*=\s*(.*)\s*$/.exec(line)
    if (m && m[1] !== undefined && m[2] !== undefined) vars.set(m[1], m[2].replace(/^["']|["']$/g, ''))
  }
  const keyId = vars.get('ASC_KEY_ID')
  const issuerId = vars.get('ASC_ISSUER_ID')
  const keyPath = vars.get('ASC_KEY_PATH')
  const inline = vars.get('ASC_PRIVATE_KEY')
  if (!keyId || !issuerId || (!keyPath && !inline)) throw new Error(`${file}: needs ASC_KEY_ID, ASC_ISSUER_ID and ASC_KEY_PATH`)
  const pem = inline ?? readFileSync(winToWsl(keyPath ?? ''), 'utf8')
  return { keyId, issuerId, pem }
}

async function token(): Promise<string> {
  const { keyId, issuerId, pem } = loadEnv()
  const der = Buffer.from(pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, ''), 'base64')
  const key = await crypto.subtle.importKey('pkcs8', der, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign'])
  const now = Math.floor(Date.now() / 1000)
  const enc = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url')
  const head = enc({ alg: 'ES256', kid: keyId, typ: 'JWT' })
  const body = enc({ iss: issuerId, iat: now, exp: now + 900, aud: 'appstoreconnect-v1' })
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, new TextEncoder().encode(`${head}.${body}`))
  return `${head}.${body}.${Buffer.from(new Uint8Array(sig)).toString('base64url')}`
}

export async function asc(method: string, path: string, data?: unknown): Promise<{ status: number; json: unknown }> {
  const url = path.startsWith('http') ? path : `https://api.appstoreconnect.apple.com${path}`
  const res = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${await token()}`, 'Content-Type': 'application/json' },
    body: data === undefined ? undefined : JSON.stringify(data),
  })
  const text = await res.text()
  let json: unknown = null
  try {
    json = text.length > 0 ? JSON.parse(text) : null
  } catch {
    json = text
  }
  return { status: res.status, json }
}

interface UploadOp {
  method: string
  url: string
  length: number
  offset: number
  requestHeaders: { name: string; value: string }[]
}

function isUploadOp(x: unknown): x is UploadOp {
  if (typeof x !== 'object' || x === null) return false
  return 'url' in x && 'method' in x && 'length' in x && 'offset' in x && 'requestHeaders' in x
}

/** Runs a reservation's uploadOperations against a local file (presigned URLs, no bearer). */
async function upload(opsFile: string, file: string): Promise<void> {
  const ops: unknown = JSON.parse(readFileSync(opsFile, 'utf8'))
  if (!Array.isArray(ops)) throw new Error('upload: expected a JSON array of uploadOperations')
  const bytes = readFileSync(file)
  for (const op of ops) {
    if (!isUploadOp(op)) throw new Error('upload: bad upload operation')
    const headers = Object.fromEntries(op.requestHeaders.map((h) => [h.name, h.value]))
    const res = await fetch(op.url, { method: op.method, headers, body: bytes.subarray(op.offset, op.offset + op.length) })
    if (!res.ok) throw new Error(`upload: ${res.status} at offset ${op.offset}`)
  }
  console.log(JSON.stringify({ uploaded: file, parts: ops.length }))
}

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name)
  if (i < 0) return undefined
  const v = args[i + 1]
  args.splice(i, 2)
  return v
}

async function main(): Promise<number> {
  const args = process.argv.slice(2)
  if (args.length === 0 || args[0] === '--help') {
    console.log('usage: bun store/asc/asc.ts <GET|POST|PATCH|DELETE> <path> [--data <json> | --file <json file>]\n       bun store/asc/asc.ts upload <uploadOperations json file> <local file>')
    return args.length === 0 ? 2 : 0
  }
  if (args[0] === 'upload') {
    const [, ops, file] = args
    if (!ops || !file) return 2
    await upload(ops, file)
    return 0
  }
  const data = flag(args, '--data')
  const file = flag(args, '--file')
  const [method, path] = args
  if (!method || !path) return 2
  const body: unknown = file !== undefined ? JSON.parse(readFileSync(file, 'utf8')) : data !== undefined ? JSON.parse(data) : undefined
  const { status, json } = await asc(method.toUpperCase(), path, body)
  console.log(JSON.stringify(json, null, 2))
  if (status >= 300) {
    console.error(`ASC ${method.toUpperCase()} ${path}: HTTP ${status}`)
    return 1
  }
  return 0
}

if (import.meta.main) process.exit(await main())
