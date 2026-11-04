import { initTRPC, TRPCError } from '@trpc/server'
import type { CreateExpressContextOptions } from '@trpc/server/adapters/express'
import { auth, type Session } from './auth'
import { adminEmails } from './env'
import { allow, clientIp, type Bucket } from './rate-limit'

/** `ip` is absent for SSR's in-process caller (src/entry-server.tsx), which only runs queries. */
export type Context = { session: Session | null; ip?: string }

export async function createContext({ req }: CreateExpressContextOptions): Promise<Context> {
  const headers = new Headers()
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue
    if (Array.isArray(value)) {
      for (const v of value) headers.append(key, v)
    } else {
      headers.set(key, value)
    }
  }
  const session = await auth.api.getSession({ headers })
  return { session, ip: clientIp(req) }
}

const t = initTRPC.context<Context>().create()

export const router = t.router
export const publicProcedure = t.procedure
export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.session) {
    throw new TRPCError({ code: 'UNAUTHORIZED' })
  }
  return next({ ctx: { ...ctx, session: ctx.session } })
})

/** A public procedure under a per-IP limit (V-29): over it answers TOO_MANY_REQUESTS. */
export const limitedProcedure = (bucket: Bucket) =>
  t.procedure.use(({ ctx, next }) => {
    if (!allow(bucket, ctx.ip ?? 'ssr')) {
      throw new TRPCError({ code: 'TOO_MANY_REQUESTS', message: 'Too many tries. Wait a minute and try again.' })
    }
    return next({ ctx })
  })

/** Signed in AND on the admin allow-list; every admin-portal procedure uses this. */
export const adminProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (!adminEmails.includes(ctx.session.user.email.toLowerCase())) {
    throw new TRPCError({ code: 'FORBIDDEN' })
  }
  return next({ ctx })
})
