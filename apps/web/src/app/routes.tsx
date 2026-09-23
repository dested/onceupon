import type { RouteObject, LoaderFunctionArgs } from 'react-router-dom'
import type { QueryClient } from '@tanstack/react-query'
import type { TRPCOptionsProxy } from '@trpc/tanstack-react-query'
import { authClient } from '~/lib/auth-client'
import type { Session } from '../../server/auth'
import type { AppRouter } from '../../server/router'
import { RouteErrorBoundary } from './error-boundary'
import { Layout } from './layout'
import { siteRoutes } from './site-routes'
import { adminRoutes } from './admin/routes'

// Per-request context populated by entry-server.tsx and handed to loaders via
// createStaticHandler.query(req, { requestContext }). Only available SSR-side.
// On the client, loaders fall back to authClient HTTP calls.
export type SsrLoaderContext = {
  session: Session | null
  queryClient: QueryClient
  trpc: TRPCOptionsProxy<AppRouter>
}

export type RootLoaderData = { session: Session | null }

export async function fetchClientSession(): Promise<Session | null> {
  const { data, error } = await authClient.getSession()
  if (error || !data) return null
  return data as Session
}

async function rootLoader({ context }: LoaderFunctionArgs): Promise<RootLoaderData> {
  if (typeof window === 'undefined') {
    return { session: (context as SsrLoaderContext).session }
  }
  return { session: await fetchClientSession() }
}

/** The site (marketing, shop, share pages) nests under Layout; /admin has its own layout inside adminRoutes. */
export const routes: RouteObject[] = [
  {
    id: 'root',
    path: '/',
    Component: Layout,
    loader: rootLoader,
    ErrorBoundary: RouteErrorBoundary,
    children: siteRoutes,
  },
  ...adminRoutes,
]
