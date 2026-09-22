/**
 * Vite dev plugin: a tiny file API confined to the repo's `lab/` directory, plus a promote route
 * that rewrites the OPS_SYSTEM_PROMPT template literal in src/llm/ops-prompt.ts. Dev-only; not part
 * of the production build. Node-side: no `~` alias, only relative/absolute node paths.
 *
 * Contract in plans/2026-09-22-drawing-lab.md. Every `path` value must resolve inside `lab/`; `..`
 * anywhere or an escape is 400. Bodies are capped at 24 MB (413).
 */
import { promises as fs } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import path from 'node:path'
import type { Plugin } from 'vite'

const MAX_BODY = 24 * 1024 * 1024

function errCode(e: unknown): unknown {
  if (typeof e === 'object' && e !== null && 'code' in e) return e.code
  return undefined
}

function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message
  return String(e)
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status
  res.setHeader('content-type', 'application/json')
  res.end(JSON.stringify(body))
}

function sendError(res: ServerResponse, status: number, message: string): void {
  sendJson(res, status, { error: message })
}

function contentTypeFor(filePath: string): string {
  switch (path.extname(filePath).toLowerCase()) {
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg'
    case '.png':
      return 'image/png'
    case '.json':
      return 'application/json'
    case '.txt':
    case '.md':
      return 'text/plain; charset=utf-8'
    default:
      return 'application/octet-stream'
  }
}

/** Collect the request body to a Buffer, or null when it exceeds MAX_BODY. */
function readBody(req: IncomingMessage): Promise<Buffer | null> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    let tooLarge = false
    req.on('data', (chunk: Buffer) => {
      if (tooLarge) return
      size += chunk.length
      if (size > MAX_BODY) {
        tooLarge = true
        resolve(null)
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (!tooLarge) resolve(Buffer.concat(chunks))
    })
    req.on('error', reject)
  })
}

export function labPlugin(): Plugin {
  return {
    name: 'once-upon-lab',
    configureServer(server) {
      const viteRoot = server.config.root
      const labRoot = path.resolve(viteRoot, 'lab')
      const opsPromptPath = path.resolve(viteRoot, 'src/llm/ops-prompt.ts')

      /** Resolve a request path inside `lab/`, or null when it escapes or contains `..`. */
      const resolveSafe = (p: string | null): string | null => {
        if (p === null || p.length === 0) return null
        if (p.includes('..')) return null
        const abs = path.resolve(viteRoot, p)
        if (abs !== labRoot && !abs.startsWith(labRoot + path.sep)) return null
        return abs
      }

      const handleFile = async (
        req: IncomingMessage,
        res: ServerResponse,
        params: URLSearchParams
      ): Promise<void> => {
        const abs = resolveSafe(params.get('path'))
        if (abs === null) {
          sendError(res, 400, 'bad path')
          return
        }
        const method = req.method ?? 'GET'
        const b64 = params.get('b64') === '1'
        const raw = params.get('raw') === '1'

        if (method === 'GET') {
          try {
            const buf = await fs.readFile(abs)
            if (raw) {
              res.statusCode = 200
              res.setHeader('content-type', contentTypeFor(abs))
              res.end(buf)
              return
            }
            if (b64) {
              sendJson(res, 200, { b64: buf.toString('base64') })
              return
            }
            res.statusCode = 200
            res.setHeader('content-type', 'text/plain; charset=utf-8')
            res.end(buf.toString('utf8'))
          } catch (e) {
            if (errCode(e) === 'ENOENT') sendError(res, 404, 'not found')
            else sendError(res, 500, errorMessage(e))
          }
          return
        }

        if (method === 'PUT') {
          const body = await readBody(req)
          if (body === null) {
            sendError(res, 413, 'body too large')
            return
          }
          const data = b64 ? Buffer.from(body.toString('utf8'), 'base64') : body
          await fs.mkdir(path.dirname(abs), { recursive: true })
          await fs.writeFile(abs, data)
          sendJson(res, 200, { ok: true, bytes: data.length })
          return
        }

        if (method === 'DELETE') {
          try {
            const stat = await fs.stat(abs)
            if (stat.isDirectory()) {
              sendError(res, 400, 'not a file')
              return
            }
            await fs.unlink(abs)
            sendJson(res, 200, { ok: true })
          } catch (e) {
            if (errCode(e) === 'ENOENT') sendError(res, 404, 'not found')
            else sendError(res, 500, errorMessage(e))
          }
          return
        }

        sendError(res, 405, `method ${method} not allowed`)
      }

      const handleAppend = async (
        req: IncomingMessage,
        res: ServerResponse,
        params: URLSearchParams
      ): Promise<void> => {
        if ((req.method ?? 'GET') !== 'POST') {
          sendError(res, 405, 'append is POST only')
          return
        }
        const abs = resolveSafe(params.get('path'))
        if (abs === null) {
          sendError(res, 400, 'bad path')
          return
        }
        const body = await readBody(req)
        if (body === null) {
          sendError(res, 413, 'body too large')
          return
        }
        await fs.mkdir(path.dirname(abs), { recursive: true })
        await fs.appendFile(abs, `${body.toString('utf8')}\n`)
        sendJson(res, 200, { ok: true })
      }

      const handleList = async (
        req: IncomingMessage,
        res: ServerResponse,
        params: URLSearchParams
      ): Promise<void> => {
        if ((req.method ?? 'GET') !== 'GET') {
          sendError(res, 405, 'list is GET only')
          return
        }
        const abs = resolveSafe(params.get('path'))
        if (abs === null) {
          sendError(res, 400, 'bad path')
          return
        }
        try {
          const names = await fs.readdir(abs)
          const entries: Array<{ name: string; dir: boolean; size: number; mtime: number }> = []
          for (const name of names) {
            const stat = await fs.stat(path.join(abs, name))
            entries.push({ name, dir: stat.isDirectory(), size: stat.size, mtime: stat.mtimeMs })
          }
          sendJson(res, 200, { entries })
        } catch (e) {
          if (errCode(e) === 'ENOENT') sendJson(res, 200, { entries: [] })
          else sendError(res, 500, errorMessage(e))
        }
      }

      const handlePromote = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
        if ((req.method ?? 'GET') !== 'POST') {
          sendError(res, 405, 'promote is POST only')
          return
        }
        const body = await readBody(req)
        if (body === null) {
          sendError(res, 413, 'body too large')
          return
        }
        let version: number
        try {
          const parsed: unknown = JSON.parse(body.toString('utf8'))
          if (
            typeof parsed !== 'object' ||
            parsed === null ||
            !('version' in parsed) ||
            typeof parsed.version !== 'number' ||
            !Number.isInteger(parsed.version) ||
            parsed.version < 0
          ) {
            sendError(res, 400, 'version (non-negative integer) required')
            return
          }
          version = parsed.version
        } catch {
          sendError(res, 400, 'bad json')
          return
        }

        const mdPath = path.resolve(labRoot, 'prompts', `v${String(version).padStart(3, '0')}.md`)
        let promptText: string
        try {
          promptText = await fs.readFile(mdPath, 'utf8')
        } catch (e) {
          if (errCode(e) === 'ENOENT') sendError(res, 404, `prompt v${version} not found`)
          else sendError(res, 500, errorMessage(e))
          return
        }
        if (promptText.includes('`') || promptText.includes('${')) {
          sendError(res, 400, 'prompt contains a backtick or ${ and cannot be embedded')
          return
        }

        let source: string
        try {
          source = await fs.readFile(opsPromptPath, 'utf8')
        } catch (e) {
          sendError(res, 500, errorMessage(e))
          return
        }

        const openMarker = 'export const OPS_SYSTEM_PROMPT = `'
        if (source.split(openMarker).length - 1 !== 1) {
          sendError(res, 409, 'open marker not found exactly once in ops-prompt.ts')
          return
        }
        const contentStart = source.indexOf(openMarker) + openMarker.length
        const closeMatches = [...source.matchAll(/`\r?\n\r?\n\/\*\* The same prompt/g)]
        if (closeMatches.length !== 1) {
          sendError(res, 409, 'close marker not found exactly once in ops-prompt.ts')
          return
        }
        const closeMatch = closeMatches[0]
        const closeIndex = closeMatch?.index
        if (closeIndex === undefined || closeIndex < contentStart) {
          sendError(res, 409, 'ops-prompt.ts markers are out of order')
          return
        }

        const next = source.slice(0, contentStart) + promptText + source.slice(closeIndex)
        await fs.writeFile(opsPromptPath, next)
        await fs.mkdir(path.dirname(mdPath), { recursive: true })
        await fs.writeFile(
          path.resolve(labRoot, 'prompts', 'promoted.json'),
          JSON.stringify({ version, at: new Date().toISOString() }, null, 2)
        )
        sendJson(res, 200, { ok: true, chars: promptText.length })
      }

      server.middlewares.use((req, res, next) => {
        const url = req.url
        if (url === undefined || !url.startsWith('/__lab/')) {
          next()
          return
        }
        const parsed = new URL(url, 'http://localhost')
        const route = parsed.pathname
        const params = parsed.searchParams
        const run = (): Promise<void> => {
          if (route === '/__lab/file') return handleFile(req, res, params)
          if (route === '/__lab/append') return handleAppend(req, res, params)
          if (route === '/__lab/list') return handleList(req, res, params)
          if (route === '/__lab/promote') return handlePromote(req, res)
          sendError(res, 404, `no lab route ${route}`)
          return Promise.resolve()
        }
        run().catch((e: unknown) => {
          if (!res.headersSent) sendError(res, 500, errorMessage(e))
          else res.end()
        })
      })
    },
  }
}
