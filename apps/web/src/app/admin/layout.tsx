import { NavLink, Outlet, ScrollRestoration, useLoaderData, useNavigate } from 'react-router-dom'
import { authClient } from '~/lib/auth-client'
import { BRAND } from '../../../../../packages/shared/src/brand'
import type { AdminLoaderData } from './routes'

const NAV: { to: string; label: string; end?: boolean }[] = [
  { to: '/admin', label: 'Overview', end: true },
  { to: '/admin/usage', label: 'Usage' },
  { to: '/admin/ledger', label: 'Ledger' },
  { to: '/admin/revenue', label: 'Revenue' },
  { to: '/admin/costs', label: 'Costs' },
  { to: '/admin/shares', label: 'Shares' },
  { to: '/admin/safety', label: 'Kid-safety' },
  { to: '/admin/settings', label: 'Settings' },
  { to: '/admin/alerts', label: 'Alerts' },
  { to: '/admin/audit', label: 'Audit' },
]

export function AdminLayout() {
  const data = useLoaderData() as AdminLoaderData
  const email = data.session.user.email
  const navigate = useNavigate()

  async function signOut() {
    await authClient.signOut()
    navigate('/admin/sign-in', { replace: true })
  }

  return (
    <div className="tabletop min-h-dvh md:grid md:grid-cols-[240px_1fr]">
      {/* Mobile top bar: wordmark + a nav select */}
      <div className="flex items-center gap-3 border-b-[3px] border-ink bg-table px-4 py-3 md:hidden">
        <span className="font-scrawl text-xl text-ink">{BRAND.name} admin</span>
        <select
          className="ml-auto rounded-xl border-[3px] border-ink bg-paper px-2 py-1 font-hand text-base"
          onChange={(e) => navigate(e.target.value)}
          value={typeof window !== 'undefined' ? window.location.pathname : '/admin'}>
          {NAV.map((n) => (
            <option key={n.to} value={n.to}>
              {n.label}
            </option>
          ))}
        </select>
        <button type="button" onClick={signOut} className="font-hand text-base text-ink-soft underline">
          Sign out
        </button>
      </div>

      {/* Desktop rail */}
      <aside className="hidden border-r-[3px] border-ink bg-table px-4 py-6 md:flex md:flex-col">
        <div className="mb-6 px-2">
          <div className="font-scrawl text-2xl leading-tight text-ink">{BRAND.name}</div>
          <div className="font-hand text-lg text-ink-soft">admin</div>
        </div>
        <nav className="flex flex-1 flex-col gap-2">
          {NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.end}
              className={({ isActive }) =>
                `rounded-xl border-[3px] border-ink px-3 py-2 font-hand text-lg leading-none shadow-[2px_3px_0_0_rgba(59,47,47,0.28)] transition ${
                  isActive ? 'bg-crayon-yellow text-ink' : 'bg-paper text-ink hover:bg-paper-deep'
                }`
              }>
              {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="mt-6 border-t-[3px] border-ink/30 pt-4">
          <div className="mb-2 truncate font-hand text-sm text-ink-soft" title={email}>
            {email}
          </div>
          <button
            type="button"
            onClick={signOut}
            className="w-full rounded-xl border-[3px] border-ink bg-paper px-3 py-1.5 font-hand text-base text-ink shadow-[2px_3px_0_0_rgba(59,47,47,0.28)] transition active:translate-y-[2px] hover:bg-paper-deep">
            Sign out
          </button>
        </div>
      </aside>

      <main className="min-w-0 bg-paper p-5 md:p-8">
        <Outlet />
        <ScrollRestoration />
      </main>
    </div>
  )
}

/** Standard page header: title in font-scrawl (no eyebrow, no trailing period) + optional right slot. */
export function PageHeader({ title, right }: { title: string; right?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <h1 className="font-scrawl text-[34px] leading-none text-ink">{title}</h1>
      {right}
    </div>
  )
}
