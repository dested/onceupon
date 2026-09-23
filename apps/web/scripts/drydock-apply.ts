// Reconfigure the Drydock project `onceupon` (local portal at :4400) to an ssr + Postgres deploy of
// this monorepo and push its environment into SSM. `bun scripts/drydock-apply.ts env|config` from apps/web.
// Values come from apps/web/.env; nothing is printed but key names and lengths.
const base = 'http://localhost:4400/trpc'

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

const envFile = await Bun.file('.env').text()
const env = new Map<string, string>()
for (const line of envFile.split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
  if (m && m[1] && m[2] !== undefined) env.set(m[1], m[2].replace(/^["']|["']$/g, ''))
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
  predeployCommand: 'bunx prisma db push --accept-data-loss',
  port: 3000,
  healthPath: '/healthz',
}

const mode = process.argv[2] ?? 'env'
if (mode === 'config') {
  await call('projects.updateConfig', { name: 'onceupon', config, apply: true })
  console.log('config applied')
} else {
  const secret = [...crypto.getRandomValues(new Uint8Array(24))]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
  const vars: Record<string, string | undefined> = {
    BETTER_AUTH_SECRET: secret,
    BETTER_AUTH_URL: 'https://onceupon.dested.com',
    PUBLIC_ORIGIN: 'https://onceupon.dested.com',
    ADMIN_EMAILS: 'dested@gmail.com,sal@quickga.me',
    APPLE_ENVIRONMENT: 'Sandbox',
    APPLE_BUNDLE_ID: 'com.quickgame.squiggletale',
    STUDIO_DIST: '../../dist-hosted',
    ANTHROPIC_API_KEY: env.get('ANTHROPIC_API_KEY'),
    DEEPGRAM_API_KEY: env.get('DEEPGRAM_API_KEY'),
    OPENAI_API_KEY: env.get('OPENAI_API_KEY'),
  }
  for (const [key, value] of Object.entries(vars)) {
    if (!value) {
      console.log(`skip ${key} (empty)`)
      continue
    }
    await call('projects.env.set', { name: 'onceupon', key, value })
    console.log(`set ${key} (${value.length} chars)`)
  }
}
