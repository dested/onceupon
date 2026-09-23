import { createExpressMiddleware } from '@trpc/server/adapters/express'
import { toNodeHandler } from 'better-auth/node'
import express, { type NextFunction, type Request, type Response } from 'express'
import * as fs from 'node:fs'
import * as http from 'node:http'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { appApiRouter } from './server/app-api'
import { auth } from './server/auth'
import { corsOrigins, env } from './server/env'
import { startJobs } from './server/jobs'
import { formatError, log, requestLogger, startupBanner } from './server/logger'
import { prisma } from './server/prisma'
import { appRouter } from './server/router'
import { shareRouter } from './server/share-routes'
import { createContext } from './server/trpc'
import { webhooksRouter } from './server/webhooks'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const isProd = process.env.NODE_ENV === 'production'
const PORT = Number(process.env.PORT ?? 7720)

const resolve = (p: string) => path.resolve(__dirname, p)

// Requests with a file extension that reach the SSR catch-all are misses (favicon.ico, source maps,
// stray .png). Render the SPA only for extension-less paths so these 404 fast.
const LOOKS_LIKE_FILE = /\.[a-zA-Z0-9]+$/

// Studio (the single-file drawing app) is built separately at the repo root.
const studioDir = path.resolve(__dirname, env.STUDIO_DIST)

// Studio <-> server calls arrive from the studio's own origin(s); reflect only the allow-listed ones.
function appCors(req: Request, res: Response, next: NextFunction) {
  const origin = req.headers.origin
  if (typeof origin === 'string' && corsOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin)
    res.setHeader('Vary', 'Origin')
    res.setHeader('Access-Control-Allow-Headers', 'content-type, x-device-token')
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
  }
  if (req.method === 'OPTIONS') {
    res.status(204).end()
    return
  }
  next()
}

async function createServer() {
  const app = express()
  // Vite's HMR websocket rides on this same server (see `hmr.server` below), so dev needs one port.
  const httpServer = http.createServer(app)
  app.disable('x-powered-by')

  // One tidy log line per request (status + timing), asset noise filtered out.
  app.use(requestLogger(isProd))

  // Liveness/readiness probe — pings the DB.
  app.get('/healthz', async (_req, res) => {
    try {
      await prisma.$queryRaw`SELECT 1`
      res.json({ status: 'ok', uptime: process.uptime() })
    } catch (e) {
      log.error(`healthz db check failed: ${formatError(e)}`)
      res.status(503).json({ status: 'error', error: 'database unreachable' })
    }
  })

  // Stripe + Apple webhooks register their own raw-body paths; MUST precede better-auth and json.
  app.use(webhooksRouter)

  // better-auth reads the raw body itself, so it is mounted before express.json().
  app.all('/api/auth/*splat', toNodeHandler(auth))

  // Every other API body is JSON; shares carry a base64 voice/cover blob, hence the large limit.
  app.use(express.json({ limit: '25mb' }))

  // CORS for the studio-facing API surface only.
  app.use('/api', appCors)

  // The studio <-> server contract and the streaming draw relay.
  app.use('/api/app', appApiRouter)
  // Public share player + assets (no token).
  app.use('/api/share', shareRouter)

  app.use(
    '/api/trpc',
    createExpressMiddleware({
      router: appRouter,
      createContext,
      onError({ error, type, path: trpcPath, input }) {
        log.error(`[trpc] ${type} ${trpcPath ?? '<unknown>'} ${error.code} — ${error.message}`, {
          input,
        })
        if (error.code === 'INTERNAL_SERVER_ERROR' && error.stack) {
          console.error(error.stack)
        }
      },
    })
  )

  // Serve the studio's single-file build at /app. Falls to a plain-text hint before it is built.
  app.get(['/app', '/app/'], (_req, res) => {
    const indexFile = path.join(studioDir, 'index.html')
    if (!fs.existsSync(indexFile)) {
      res
        .status(404)
        .type('txt')
        .end('studio not built: run `bun run build:hosted` at the repo root')
      return
    }
    res.setHeader('Cache-Control', 'no-cache')
    res.sendFile(indexFile)
  })
  app.use('/app', express.static(studioDir, { index: false, maxAge: '5m' }))

  let vite: Awaited<ReturnType<typeof import('vite').createServer>> | undefined

  if (!isProd) {
    vite = await (
      await import('vite')
    ).createServer({
      root: __dirname,
      server: { middlewareMode: true, hmr: { server: httpServer } },
      appType: 'custom',
    })
    app.use(vite.middlewares)
  } else {
    app.use(
      (await import('compression')).default(),
      express.static(resolve('./dist/client'), {
        index: false,
        setHeaders(res, filePath) {
          if (filePath.includes(`${path.sep}assets${path.sep}`)) {
            res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
          }
        },
      })
    )
  }

  const indexProd = isProd ? fs.readFileSync(resolve('./dist/client/index.html'), 'utf-8') : ''

  app.use(async (req, res) => {
    // Unmatched API routes return JSON, never the HTML SPA.
    if (req.path.startsWith('/api/')) {
      res.status(404).json({ error: 'Not found' })
      return
    }
    const navigational = req.method === 'GET' || req.method === 'HEAD'
    if (!navigational || LOOKS_LIKE_FILE.test(req.path)) {
      res.status(404).type('txt').end('Not found')
      return
    }
    try {
      let template: string
      let render: typeof import('./src/entry-server').render

      if (!isProd && vite) {
        template = fs.readFileSync(resolve('./index.html'), 'utf-8')
        template = await vite.transformIndexHtml(req.originalUrl, template)
        render = (await vite.ssrLoadModule('/src/entry-server.tsx')).render
      } else {
        template = indexProd
        // @ts-ignore — produced by `vite build --ssr`; may not exist before first build
        render = (await import('./dist/server/entry-server.js')).render
      }

      const { html: appHtml, status, dehydratedState } = await render(req)

      const stateScript = `<script>window.__SSR_STATE__ = ${jsonForScript({ dehydratedState })}</script>`
      const html = template
        .replace('<!--app-state-->', stateScript)
        .replace('<!--app-html-->', appHtml)

      res.status(status).set({ 'Content-Type': 'text/html' }).end(html)
    } catch (e: unknown) {
      if (e instanceof Response) {
        const location = e.headers.get('location')
        if (location) {
          res.redirect(e.status, location)
        } else {
          const body = await e.text()
          res.status(e.status).end(body)
        }
        return
      }
      if (!isProd && vite) vite.ssrFixStacktrace(e as Error)
      log.error(`SSR render failed for ${req.method} ${req.originalUrl}`)
      console.error(formatError(e))
      res
        .status(500)
        .type('txt')
        .end(isProd ? 'Internal Server Error' : formatError(e))
    }
  })

  httpServer.listen(PORT, () => {
    startupBanner({
      port: PORT,
      isProd,
      databaseUrl: env.DATABASE_URL,
      routes: ['/', '/app', '/healthz', '/api/app', '/api/share', '/api/trpc', '/api/auth'],
    })
    startJobs()
  })
}

// JSON for safe inline-script embedding: escape `<` so `</script>` can't terminate the script tag.
function jsonForScript(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c')
}

createServer().catch((e) => {
  log.error('failed to start server')
  console.error(formatError(e))
  process.exit(1)
})
