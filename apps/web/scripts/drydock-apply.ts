// Drydock project `onceupon` (local portal at :4400): its build/deploy config and its SSM environment.
// Run from apps/web. Nothing is printed but key names and lengths.
//
//   bun scripts/drydock-apply.ts list                 env names + value lengths in SSM
//   bun scripts/drydock-apply.ts env                  set the managed vars below (stored; live on the next deploy)
//   bun scripts/drydock-apply.ts unset KEY [KEY...]   delete vars from SSM (stored; live on the next deploy)
//   bun scripts/drydock-apply.ts apply                Apply + redeploy now (restarts production)
//   bun scripts/drydock-apply.ts config               write the ssr + Postgres config below and apply it
//   bun scripts/drydock-apply.ts rotate-auth-secret   new BETTER_AUTH_SECRET (logs every admin out; device
//                                                     tokens too while DEVICE_TOKEN_SECRET is unset)
//
// Secrets come from apps/web/.env. BETTER_AUTH_SECRET is never touched by `env` (it used to be regenerated
// on every run, which logged everyone out).
export {}

const base = 'http://localhost:4400/trpc'
const project = 'onceupon'

async function call(proc: string, input: unknown): Promise<unknown> {
  const res = await fetch(`${base}/${proc}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`${proc} ${res.status}: ${text.slice(0, 400)}`)
  return text ? JSON.parse(text) : null
}

async function query(proc: string, input: unknown): Promise<unknown> {
  const res = await fetch(`${base}/${proc}?input=${encodeURIComponent(JSON.stringify(input))}`)
  const text = await res.text()
  if (!res.ok) throw new Error(`${proc} ${res.status}: ${text.slice(0, 400)}`)
  return text ? JSON.parse(text) : null
}

async function readEnv(): Promise<Map<string, string>> {
  const env = new Map<string, string>()
  for (const line of (await Bun.file('.env').text()).split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (m && m[1] && m[2] !== undefined) env.set(m[1], m[2].replace(/^["']|["']$/g, ''))
  }
  return env
}

const config = {
  kind: 'ssr',
  runtime: 'bun',
  prisma: true,
  database: true,
  glibc: false,
  rootDir: 'apps/web',
  dataDir: '',
  size: 's',
  buildCommand:
    'cd ../.. && bun install --frozen-lockfile && bun run build:hosted && cd apps/web && bun run build',
  startCommand: 'bun run start',
  outputDir: 'dist',
  domains: ['onceupon.dested.com'],
  dnsZone: '',
  // No --accept-data-loss: a destructive schema diff must fail the deploy, not delete ledger or purchase rows.
  predeployCommand: 'bunx prisma db push',
  port: 3000,
  healthPath: '/healthz',
}

const mode = process.argv[2] ?? 'list'
const args = process.argv.slice(3)

if (mode === 'config') {
  await call('projects.updateConfig', { name: project, config, apply: true })
  console.log('config applied')
} else if (mode === 'apply') {
  await call('projects.env.applyChanges', { name: project })
  console.log('applied: redeploy started')
} else if (mode === 'list') {
  const out = await query('projects.env.list', { name: project })
  for (const [k, len] of envLengths(out)) console.log(`${k} (${len} chars)`)
} else if (mode === 'unset') {
  if (args.length === 0) throw new Error('unset needs at least one KEY')
  for (const key of args) {
    await call('projects.env.delete', { name: project, key })
    console.log(`unset ${key}`)
  }
} else if (mode === 'rotate-auth-secret') {
  const secret = [...crypto.getRandomValues(new Uint8Array(24))].map((b) => b.toString(16).padStart(2, '0')).join('')
  await call('projects.env.set', { name: project, key: 'BETTER_AUTH_SECRET', value: secret })
  console.log(`set BETTER_AUTH_SECRET (${secret.length} chars); run \`apply\` to make it live`)
} else if (mode === 'env') {
  const env = await readEnv()
  const vars: Record<string, string | undefined> = {
    BETTER_AUTH_URL: 'https://onceupon.dested.com',
    PUBLIC_ORIGIN: 'https://onceupon.dested.com',
    ADMIN_EMAILS: 'dested@gmail.com,sal@quickga.me',
    APPLE_ENVIRONMENT: 'Production',
    APPLE_APP_APPLE_ID: '6815029998',
    APPLE_BUNDLE_ID: 'com.quickgame.squiggletale',
    STUDIO_DIST: '../../dist-hosted',
    ANTHROPIC_API_KEY: env.get('ANTHROPIC_API_KEY'),
  }
  for (const [key, value] of Object.entries(vars)) {
    if (!value) {
      console.log(`skip ${key} (empty)`)
      continue
    }
    await call('projects.env.set', { name: project, key, value })
    console.log(`set ${key} (${value.length} chars)`)
  }
  console.log('stored; live on the next deploy (or run `apply`)')
} else {
  console.error(`unknown mode ${mode}: list | env | unset KEY... | apply | config | rotate-auth-secret`)
  process.exit(2)
}

/** [name, value length] pairs from projects.env.list, whatever envelope the portal returns. */
function envLengths(out: unknown): Array<[string, number]> {
  const unwrap = (v: unknown, k: string): unknown =>
    typeof v === 'object' && v !== null && k in v ? Reflect.get(v, k) : v
  const data = unwrap(unwrap(unwrap(out, 'result'), 'data'), 'json')
  if (Array.isArray(data)) {
    return data.flatMap((e): Array<[string, number]> => {
      const k = unwrap(e, 'key')
      const v = unwrap(e, 'value')
      return typeof k === 'string' ? [[k, typeof v === 'string' ? v.length : 0]] : []
    })
  }
  if (typeof data === 'object' && data !== null) {
    return Object.entries(data).map(([k, v]): [string, number] => [k, typeof v === 'string' ? v.length : 0])
  }
  return []
}
