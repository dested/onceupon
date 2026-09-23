import { useState } from 'react'
import { Link, Outlet, ScrollRestoration } from 'react-router-dom'
import { StickerButton, StickerLink } from '~/components/paper'
import { BRAND } from '../../../../packages/shared/src/brand'
import { Footer, Wordmark } from './site-parts'

const NAV: { label: string; to: string; tilt: number }[] = [
  { label: 'How it works', to: '/how-it-works', tilt: -2 },
  { label: 'Pricing', to: '/pricing', tilt: 1 },
  { label: 'Gift', to: '/gift', tilt: -1 },
  { label: 'Support', to: '/support', tilt: 1 },
]

const APP_STORE = BRAND.appStoreUrl || '/#get-the-app'

export function Layout() {
  const [menuOpen, setMenuOpen] = useState(false)

  return (
    <div className="tabletop flex min-h-screen flex-col">
      <header className="mx-auto flex w-full max-w-6xl items-center gap-4 px-6 py-4">
        <Link to="/" className="text-ink" onClick={() => setMenuOpen(false)}>
          <Wordmark className="text-[28px]" />
        </Link>

        <nav className="ml-auto hidden items-center gap-3 md:flex">
          {NAV.map((n) => (
            <StickerLink key={n.to} to={n.to} tilt={n.tilt}>
              {n.label}
            </StickerLink>
          ))}
          <StickerLink to={APP_STORE} tone="yellow" tilt={-1} external={BRAND.appStoreUrl !== ''}>
            Get the app
          </StickerLink>
        </nav>

        <div className="relative ml-auto md:hidden">
          <StickerButton
            tone="paper"
            tilt={-1}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((v) => !v)}>
            Menu
          </StickerButton>
          {menuOpen ? (
            <div className="absolute right-0 z-20 mt-3 w-56 rounded-3xl border-[3px] border-ink bg-paper p-3 shadow-[6px_8px_0_0_rgba(59,47,47,0.3)]">
              <ul className="flex flex-col gap-1">
                {NAV.map((n) => (
                  <li key={n.to}>
                    <Link
                      to={n.to}
                      onClick={() => setMenuOpen(false)}
                      className="block rounded-xl px-3 py-2 font-hand text-xl text-ink hover:bg-paper-deep">
                      {n.label}
                    </Link>
                  </li>
                ))}
                <li>
                  {BRAND.appStoreUrl ? (
                    <a
                      href={BRAND.appStoreUrl}
                      target="_blank"
                      rel="noreferrer"
                      onClick={() => setMenuOpen(false)}
                      className="block rounded-xl bg-crayon-yellow px-3 py-2 font-hand text-xl text-ink">
                      Get the app
                    </a>
                  ) : (
                    <Link
                      to="/#get-the-app"
                      onClick={() => setMenuOpen(false)}
                      className="block rounded-xl bg-crayon-yellow px-3 py-2 font-hand text-xl text-ink">
                      Get the app
                    </Link>
                  )}
                </li>
              </ul>
            </div>
          ) : null}
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-6 pb-16">
        <Outlet />
      </main>

      <Footer />
      <ScrollRestoration />
    </div>
  )
}
