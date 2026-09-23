import { router } from './trpc'
import { siteRouter } from './routers/site'
import { adminRouter } from './routers/admin'

export const appRouter = router({
  site: siteRouter,
  admin: adminRouter,
})

export type AppRouter = typeof appRouter
