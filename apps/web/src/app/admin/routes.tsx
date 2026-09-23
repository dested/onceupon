import { redirect, type LoaderFunctionArgs, type RouteObject } from 'react-router-dom'
import type { Session } from '../../../server/auth'
import { fetchClientSession, type SsrLoaderContext } from '../routes'
import { AdminLayout } from './layout'
import { AdminSignIn } from './sign-in'
import { AdminSignUp } from './sign-up'
import { OverviewPage } from './overview'
import { UsagePage } from './usage'
import { LedgerPage } from './ledger'
import { RevenuePage } from './revenue'
import { CostsPage } from './costs'
import { SharesPage } from './shares'
import { SafetyPage } from './safety'
import { SettingsPage } from './settings'
import { AlertsPage } from './alerts'
import { AuditPage } from './audit'

export type AdminLoaderData = { session: Session }

/** Gate every /admin page behind a signed-in (allow-listed) session. */
async function adminLoader({ context }: LoaderFunctionArgs): Promise<AdminLoaderData> {
  const session =
    typeof window === 'undefined'
      ? (context as SsrLoaderContext).session
      : await fetchClientSession()
  if (!session) throw redirect('/admin/sign-in')
  return { session }
}

/** `/admin/*` — its own crayon-paper layout, outside the marketing site's Layout. */
export const adminRoutes: RouteObject[] = [
  {
    id: 'admin',
    path: '/admin',
    Component: AdminLayout,
    loader: adminLoader,
    children: [
      { index: true, Component: OverviewPage },
      { path: 'usage', Component: UsagePage },
      { path: 'ledger', Component: LedgerPage },
      { path: 'revenue', Component: RevenuePage },
      { path: 'costs', Component: CostsPage },
      { path: 'shares', Component: SharesPage },
      { path: 'safety', Component: SafetyPage },
      { path: 'settings', Component: SettingsPage },
      { path: 'alerts', Component: AlertsPage },
      { path: 'audit', Component: AuditPage },
    ],
  },
  { path: '/admin/sign-in', Component: AdminSignIn },
  { path: '/admin/sign-up', Component: AdminSignUp },
]
