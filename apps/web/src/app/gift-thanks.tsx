import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { PaperCard, Scrawl, StickerButton } from '~/components/paper'
import { BRAND } from '../../../../packages/shared/src/brand'
import { useTRPC } from '~/lib/trpc'
import type { inferRouterOutputs } from '@trpc/server'
import type { AppRouter } from '../../server/router'
import { Head } from './seo'
import { Section, Wordmark } from './site-parts'

type GiftPublicView = NonNullable<inferRouterOutputs<AppRouter>['site']['gift']['bySession']>

const TIMEOUT_MS = 60_000

export function GiftThanksPage() {
  const [params] = useSearchParams()
  const sessionId = params.get('session_id') ?? ''
  const trpc = useTRPC()
  const [startedAt] = useState(() => Date.now())

  const query = useQuery(
    trpc.site.gift.bySession.queryOptions(
      { sessionId },
      {
        enabled: sessionId.length > 0,
        refetchInterval: (q) => {
          if (q.state.data) return false
          if (Date.now() - startedAt > TIMEOUT_MS) return false
          return 2000
        },
      }
    )
  )

  const gift = query.data ?? null
  const timedOut = !gift && Date.now() - startedAt > TIMEOUT_MS

  return (
    <>
      <Head title="Your gift is ready" />
      <Section>
        {gift ? (
          <GiftReady gift={gift} />
        ) : (
          <PaperCard tilt={-1} className="no-print mx-auto max-w-xl text-center">
            <Scrawl as="h1" className="text-4xl text-ink">
              {timedOut ? 'Almost there' : 'Wrapping your gift…'}
            </Scrawl>
            <p className="mt-4 font-hand text-xl text-ink">
              {timedOut ? (
                <>
                  Your code is on its way. If it doesn’t appear, write to{' '}
                  <a href={`mailto:${BRAND.supportEmail}`} className="text-purple underline">
                    {BRAND.supportEmail}
                  </a>
                  .
                </>
              ) : (
                'Hang on a moment while we mint your gift code.'
              )}
            </p>
            {sessionId.length === 0 ? (
              <p className="mt-4 font-hand text-lg text-ink-soft">
                No gift to show.{' '}
                <Link to="/gift" className="text-purple underline">
                  Buy a gift
                </Link>
              </p>
            ) : null}
          </PaperCard>
        )}
      </Section>
    </>
  )
}

function GiftReady({ gift }: { gift: GiftPublicView }) {
  const [copied, setCopied] = useState(false)

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(gift.code)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopied(false)
    }
  }

  return (
    <div className="flex flex-col items-center gap-6">
      <GiftCard gift={gift} />
      <div className="no-print flex flex-wrap justify-center gap-4">
        <StickerButton type="button" tone="yellow" tilt={-1} onClick={() => window.print()}>
          Print this card
        </StickerButton>
        <StickerButton type="button" tone="paper" tilt={1} onClick={copyCode}>
          {copied ? 'Copied' : 'Copy code'}
        </StickerButton>
      </div>
    </div>
  )
}

function GiftCard({ gift }: { gift: GiftPublicView }) {
  return (
    <div
      className="w-full max-w-[600px] bg-paper p-8 text-center"
      style={{
        border: '4px dashed #3b2f2f',
        borderRadius: 24,
        boxShadow: '6px 8px 0 0 rgba(59,47,47,0.25)',
      }}>
      <Wordmark className="text-3xl" />
      <Scrawl as="h1" className="mt-4 text-4xl text-ink">
        A story gift
      </Scrawl>
      <p className="mt-2 font-hand text-2xl text-ink">{gift.minutes} minutes of storytelling</p>

      <div
        className="mx-auto mt-6 inline-block rounded-2xl border-[3px] border-ink bg-white px-6 py-4"
        style={{ transform: 'rotate(-1deg)' }}>
        <p className="font-scrawl text-4xl text-purple" style={{ letterSpacing: '0.12em' }}>
          {gift.code}
        </p>
      </div>

      {gift.toName ? (
        <p className="mt-6 font-hand text-xl text-ink">To {gift.toName}</p>
      ) : null}
      {gift.message ? (
        <p className="mt-1 font-hand text-lg text-ink-soft">“{gift.message}”</p>
      ) : null}
      {gift.fromName ? (
        <p className="mt-1 font-hand text-xl text-ink">From {gift.fromName}</p>
      ) : null}

      <p className="mt-6 font-hand text-base text-ink-soft">
        Redeem in the app under Grown-ups, or at {BRAND.origin}/redeem
      </p>
    </div>
  )
}
