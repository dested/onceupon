import type { Device } from '@prisma/client'
import type { z } from 'zod'
import type { ApiErrorCode, ApiName, AppApi } from '../../../packages/shared/src/api'

/** Thrown by handlers; `server/app-api.ts` turns it into `{ error: { code, message } }` with the status. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ApiErrorCode,
    message: string
  ) {
    super(message)
  }
}

export interface HandlerCtx {
  /** The authenticated device (null only for `auth: 'none'` handlers). */
  device: Device | null
  ip: string
  userAgent: string
}

export interface DeviceCtx extends HandlerCtx {
  device: Device
}

export type Handler<K extends ApiName> =
  | {
      auth: 'device'
      input: z.ZodType<AppApi[K]['input']>
      run: (input: AppApi[K]['input'], ctx: DeviceCtx) => Promise<AppApi[K]['output']>
    }
  | {
      auth: 'none'
      input: z.ZodType<AppApi[K]['input']>
      run: (input: AppApi[K]['input'], ctx: HandlerCtx) => Promise<AppApi[K]['output']>
    }

export type Handlers = { [K in ApiName]?: Handler<K> }

/** Typed constructor so a handler's input schema and output type line up with the shared contract. */
export function deviceHandler<K extends ApiName>(
  input: z.ZodType<AppApi[K]['input']>,
  run: (input: AppApi[K]['input'], ctx: DeviceCtx) => Promise<AppApi[K]['output']>
): Handler<K> {
  return { auth: 'device', input, run }
}

export function publicHandler<K extends ApiName>(
  input: z.ZodType<AppApi[K]['input']>,
  run: (input: AppApi[K]['input'], ctx: HandlerCtx) => Promise<AppApi[K]['output']>
): Handler<K> {
  return { auth: 'none', input, run }
}
