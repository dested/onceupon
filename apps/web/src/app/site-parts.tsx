import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { TRPCClientError } from '@trpc/client'
import { PaperCard, Scrawl, StickerLink } from '~/components/paper'
import { BRAND } from '../../../../packages/shared/src/brand'
import {
  PACKS,
  centsPerMinute,
  formatUsd,
  type Pack,
  type PackId,
} from '../../../../packages/shared/src/packs'

/** Shared building blocks for the crayon picture-book website: wordmark, the storybook book frame,
 * section wrapper, pack cards/chooser, footer, and small props (phone mockup, speech bubble). */

/** The handwritten wordmark: the brand name lowercased, a coral star tucked up like the studio's. */
export function Wordmark({ className = '' }: { className?: string }) {
  return (
    <span className={`font-scrawl leading-none ${className}`} style={{ letterSpacing: '-1px' }}>
      {BRAND.name.toLowerCase()}
      <span className="text-coral align-super" style={{ fontSize: '0.55em', marginLeft: 3 }}>
        ✦
      </span>
    </span>
  )
}

/** A section band with an optional hand heading (never an eyebrow; heading never ends in a period). */
export function Section({
  title,
  children,
  className = '',
  headingClassName = 'text-3xl md:text-4xl text-ink',
}: {
  title?: string
  children: ReactNode
  className?: string
  headingClassName?: string
}) {
  return (
    <section className={`py-10 ${className}`}>
      {title ? <Scrawl className={`mb-6 ${headingClassName}`}>{title}</Scrawl> : null}
      {children}
    </section>
  )
}

/**
 * The studio's storybook cover, in CSS, wrapping the drawing player iframe. Values copied from the
 * studio's `.storybook` / `.book-binding` / `.story-paper` (root src/styles/app.css) so the site's
 * book reads as the same object as the app.
 */
export function StudioFrame({
  src,
  title,
  className = '',
}: {
  src: string
  title: string
  className?: string
}) {
  return (
    <div
      className={className}
      style={{
        position: 'relative',
        display: 'flex',
        padding: '7px 7px 9px 0',
        background: '#d9937e',
        border: '2px solid #876351',
        borderRadius: '17px 23px 23px 17px',
        boxShadow: '2px 5px 0 #c4b59e, 3px 8px 0 #d9ccba',
      }}>
      <div
        aria-hidden
        style={{
          width: 29,
          flex: '0 0 29px',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-around',
          alignItems: 'center',
          padding: '22px 0',
          backgroundImage:
            'repeating-linear-gradient(0deg, transparent 0 3px, #995c4312 3px 4px)',
        }}>
        {[0, 1, 2, 3, 4].map((i) => (
          <span
            key={i}
            style={{
              width: 12,
              height: 28,
              borderLeft: '2px solid #f9dbbf',
              borderRight: '2px solid #a66c55',
              borderRadius: '50%',
              transform: 'rotate(-7deg)',
            }}
          />
        ))}
      </div>
      <div
        style={{
          position: 'relative',
          minWidth: 0,
          flex: 1,
          overflow: 'hidden',
          border: '1px solid #cbbb9f',
          borderRadius: '7px 16px 15px 6px',
          background: '#fbf6ea',
          boxShadow: 'inset 8px 0 10px #694d2c0b',
          aspectRatio: '16 / 10',
        }}>
        <iframe
          src={src}
          title={title}
          loading="lazy"
          allow="autoplay"
          sandbox="allow-scripts allow-same-origin"
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            border: 0,
            display: 'block',
          }}
        />
      </div>
    </div>
  )
}

const CARD_TILTS = [-1.5, 2, -1]

/** Display pack cards for the landing and pricing pages: price, per-minute, blurb, buy links. */
export function PackCards({ compact = false }: { compact?: boolean }) {
  return (
    <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
      {PACKS.map((pack, i) => (
        <PackCard key={pack.id} pack={pack} tilt={CARD_TILTS[i % CARD_TILTS.length] ?? 0} compact={compact} />
      ))}
    </div>
  )
}

function PackCard({ pack, tilt, compact }: { pack: Pack; tilt: number; compact: boolean }) {
  return (
    <PaperCard
      tilt={pack.featured ? 2 : tilt}
      className={`relative flex flex-col gap-3 ${pack.featured ? 'ring-4 ring-crayon-yellow/50' : ''}`}>
      {pack.featured ? (
        <span
          className="absolute -right-3 -top-4 rounded-xl border-[3px] border-ink bg-crayon-yellow px-3 py-1 font-hand text-base leading-none text-ink shadow-[2px_3px_0_0_rgba(59,47,47,0.35)]"
          style={{ transform: 'rotate(4deg)' }}>
          Most popular
        </span>
      ) : null}
      <Scrawl className="text-3xl text-ink">{pack.name}</Scrawl>
      <p className="font-hand text-2xl text-ink">{pack.minutes} minutes</p>
      <div className="flex items-baseline gap-2">
        <span className="font-scrawl text-4xl text-purple">{formatUsd(pack.priceCents)}</span>
        <span className="font-hand text-lg text-ink-soft">{centsPerMinute(pack)}¢ a minute</span>
      </div>
      <p className="font-hand text-lg text-ink-soft">{pack.blurb}</p>
      {compact ? null : (
        <div className="mt-2 flex flex-col gap-2">
          <StickerLink to="/#get-the-app" tone={pack.featured ? 'yellow' : 'paper'} tilt={-1}>
            Buy in the app
          </StickerLink>
          <Link to="/shop" className="text-center font-hand text-lg text-purple underline">
            or buy on the web with your family code
          </Link>
        </div>
      )}
    </PaperCard>
  )
}

/** Selectable pack cards for the shop and gift forms (radio group). */
export function PackChooser({
  value,
  onChange,
  name = 'pack',
}: {
  value: PackId
  onChange: (id: PackId) => void
  name?: string
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-3" role="radiogroup" aria-label="Choose a pack">
      {PACKS.map((pack) => {
        const active = pack.id === value
        return (
          <button
            key={pack.id}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(pack.id)}
            className={`flex flex-col items-start gap-1 rounded-2xl border-[3px] border-ink p-4 text-left shadow-[3px_4px_0_0_rgba(59,47,47,0.3)] transition ${
              active ? 'bg-crayon-yellow' : 'bg-paper'
            }`}>
            <span className="font-scrawl text-2xl text-ink">{pack.name}</span>
            <span className="font-hand text-lg text-ink">{pack.minutes} minutes</span>
            <span className="font-scrawl text-2xl text-purple">{formatUsd(pack.priceCents)}</span>
            <span className="font-hand text-base text-ink-soft">{centsPerMinute(pack)}¢ a minute</span>
          </button>
        )
      })}
    </div>
  )
}

/** A fake iMessage on a paper phone: the grandma share moment, no real chrome. */
export function PhoneMockup() {
  return (
    <div
      className="mx-auto rounded-[2.5rem] border-[3px] border-ink bg-paper-deep p-4 shadow-[6px_8px_0_0_rgba(59,47,47,0.3)]"
      style={{ width: 260, height: 520, transform: 'rotate(2deg)' }}>
      <div className="flex h-full flex-col gap-3 rounded-[1.8rem] border-2 border-ink/30 bg-white p-4">
        <p className="text-center font-hand text-base text-ink-soft">Family</p>
        <div className="max-w-[80%] self-start rounded-2xl rounded-bl-sm border-2 border-ink bg-lilac px-3 py-2">
          <p className="font-scrawl text-lg leading-tight text-ink">Ellie made this story</p>
        </div>
        <div className="max-w-[85%] self-start rounded-2xl rounded-bl-sm border-2 border-ink bg-paper px-3 py-2">
          <p className="break-all font-hand text-base leading-tight text-purple underline">
            {BRAND.origin}/s/…
          </p>
        </div>
        <div className="mt-auto self-end rounded-2xl rounded-br-sm border-2 border-ink bg-sage px-3 py-2">
          <p className="font-hand text-base leading-tight text-ink">oh my goodness 😭 playing it now</p>
        </div>
      </div>
    </div>
  )
}

/** A speech bubble pill for the sample-sentence strip. */
export function SpeechBubble({ children, tilt = -1 }: { children: ReactNode; tilt?: number }) {
  return (
    <div
      className="rounded-3xl rounded-bl-sm border-[3px] border-ink bg-paper px-5 py-3 shadow-[3px_4px_0_0_rgba(59,47,47,0.25)]"
      style={{ transform: `rotate(${tilt}deg)` }}>
      <p className="font-hand text-xl text-ink">“{children}”</p>
    </div>
  )
}

const FOOTER_COLUMNS: { heading: string; links: { label: string; to: string }[] }[] = [
  {
    heading: 'Squiggletale',
    links: [
      { label: 'How it works', to: '/how-it-works' },
      { label: 'Pricing', to: '/pricing' },
      { label: 'Gift a story', to: '/gift' },
      { label: 'Redeem a code', to: '/redeem' },
    ],
  },
  {
    heading: 'The fine print',
    links: [
      { label: 'Privacy', to: '/privacy' },
      { label: 'Terms', to: '/terms' },
      { label: 'Delete my data', to: '/delete-my-data' },
    ],
  },
  {
    heading: 'Help',
    links: [
      { label: 'Support', to: '/support' },
      { label: 'FAQ', to: '/faq' },
    ],
  },
]

export function Footer() {
  return (
    <footer className="mt-8 border-t-[3px] border-dashed border-ink/40 bg-paper/60">
      <div className="mx-auto grid max-w-6xl gap-8 px-6 py-10 sm:grid-cols-3">
        {FOOTER_COLUMNS.map((col, i) => (
          <div key={col.heading} className="flex flex-col gap-2">
            <Scrawl className="text-2xl text-ink">
              {i === 0 ? <Wordmark /> : col.heading}
            </Scrawl>
            {col.links.map((l) => (
              <Link key={l.to} to={l.to} className="font-hand text-lg text-ink hover:text-purple">
                {l.label}
              </Link>
            ))}
            {i === 2 ? (
              <span className="font-hand text-lg text-ink-soft">{BRAND.supportEmail}</span>
            ) : null}
          </div>
        ))}
      </div>
      <div className="mx-auto max-w-6xl px-6 pb-8">
        <p className="font-hand text-base text-ink-soft">
          © 2026 {BRAND.company}. Made with crayons
        </p>
      </div>
    </footer>
  )
}

/** Pulls the tRPC error code (NOT_FOUND, PRECONDITION_FAILED, CONFLICT…) off a client error. */
export function trpcCode(err: unknown): string | null {
  if (!(err instanceof TRPCClientError)) return null
  const data: unknown = err.data
  if (data && typeof data === 'object' && 'code' in data) {
    const code = data.code
    return typeof code === 'string' ? code : null
  }
  return null
}
