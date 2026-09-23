import express, { type NextFunction, type Request, type Response } from 'express'
import type { z } from 'zod'
import { ApiError, type DeviceCtx, type Handler, type HandlerCtx, type Handlers } from './app-api-types'
import { coreHandlers } from './app-handlers/core'
import { moneyHandlers } from './app-handlers/money'
import { shareHandlers } from './app-handlers/share'
import { deviceFromToken } from './device'
import { drawHandler } from './relay'
import { log } from './logger'
import type { Device } from '@prisma/client'
import type { ApiErrorCode, ApiName } from '../../../packages/shared/src/api'

// The authenticated device rides on res.locals so the streaming relay (which is not a Handler) can
// read it too. Typed here so no `any` leaks out of Express's default Locals.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Locals {
      device?: Device
    }
  }
}

/** Read the device set by `requireDevice`; throws if the route was mounted without it. */
export function deviceOf(res: Response): Device {
  const device = res.locals.device
  if (!device) throw new ApiError(401, 'unauthorized', 'device unauthenticated')
  return device
}

function headerToken(req: Request): string | null {
  const h = req.headers['x-device-token']
  if (typeof h === 'string') return h.length > 0 ? h : null
  if (Array.isArray(h)) return h[0] ?? null
  return null
}

function sendError(res: Response, status: number, code: ApiErrorCode, message: string): void {
  res.status(status).json({ error: { code, message } })
}

function firstIssue(err: z.ZodError): string {
  const issue = err.issues[0]
  if (!issue) return 'bad request'
  const path = issue.path.join('.')
  return path ? `${path}: ${issue.message}` : issue.message
}

function ipOf(req: Request): string {
  const fwd = req.headers['x-forwarded-for']
  if (typeof fwd === 'string' && fwd.length > 0) return fwd.split(',')[0]?.trim() ?? ''
  return req.ip ?? ''
}

function uaOf(req: Request): string {
  const ua = req.headers['user-agent']
  return typeof ua === 'string' ? ua : ''
}

function onError(req: Request, res: Response, e: unknown): void {
  if (e instanceof ApiError) {
    if (!res.headersSent) sendError(res, e.status, e.code, e.message)
    else res.end()
    return
  }
  log.error(`[app-api] ${req.path}: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`)
  if (!res.headersSent) sendError(res, 500, 'internal', 'something went wrong')
  else res.end()
}

async function runHandler<K extends ApiName>(
  handler: Handler<K>,
  req: Request,
  res: Response
): Promise<void> {
  const base: HandlerCtx = { device: null, ip: ipOf(req), userAgent: uaOf(req) }

  if (handler.auth === 'device') {
    const token = headerToken(req)
    const device = token ? await deviceFromToken(token) : null
    if (!device) {
      sendError(res, 401, 'unauthorized', 'device token required')
      return
    }
    if (device.blocked) {
      sendError(res, 403, 'blocked', 'this device is blocked')
      return
    }
    const parsed = handler.input.safeParse(req.body ?? {})
    if (!parsed.success) {
      sendError(res, 400, 'bad_request', firstIssue(parsed.error))
      return
    }
    const ctx: DeviceCtx = { ...base, device }
    res.json(await handler.run(parsed.data, ctx))
    return
  }

  const parsed = handler.input.safeParse(req.body ?? {})
  if (!parsed.success) {
    sendError(res, 400, 'bad_request', firstIssue(parsed.error))
    return
  }
  res.json(await handler.run(parsed.data, base))
}

// Keep K a type parameter so `map[name]` resolves to Handler<K>, not the union of every handler
// (which would fail the contravariant `run` check).
function mountFrom<K extends ApiName>(map: Handlers, name: K): void {
  const handler = map[name]
  if (!handler) return
  appApiRouter.post(`/${name}`, (req, res) => {
    runHandler(handler, req, res).catch((e: unknown) => onError(req, res, e))
  })
}

/** Auth guard for the streaming relay (not a Handler): sets res.locals.device or answers 401/403. */
export async function requireDevice(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const token = headerToken(req)
    const device = token ? await deviceFromToken(token) : null
    if (!device) {
      sendError(res, 401, 'unauthorized', 'device token required')
      return
    }
    if (device.blocked) {
      sendError(res, 403, 'blocked', 'this device is blocked')
      return
    }
    res.locals.device = device
    next()
  } catch (e) {
    log.error(`[app-api] requireDevice: ${e instanceof Error ? e.message : String(e)}`)
    sendError(res, 500, 'internal', 'something went wrong')
  }
}

export const appApiRouter = express.Router()

const handlers: Handlers = { ...coreHandlers, ...moneyHandlers, ...shareHandlers }

for (const name of Object.keys(handlers) as ApiName[]) {
  mountFrom(handlers, name)
}

appApiRouter.post('/draw', requireDevice, (req, res) => {
  drawHandler(req, res).catch((e: unknown) => onError(req, res, e))
})
