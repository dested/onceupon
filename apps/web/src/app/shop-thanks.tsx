import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { PaperCard, Scrawl, StickerLink } from '~/components/paper'
import { BRAND } from '../../../../packages/shared/src/brand'
import { useTRPC } from '~/lib/trpc'
import { Head } from './seo'
import { Section } from './site-parts'

const TIMEOUT_MS = 60_000

export function ShopThanksPage() {
  const [params] = useSearchParams()
  const sessionId = params.get('session_id') ?? ''
  const trpc = useTRPC()
  const [startedAt] = useState(() => Date.now())

  const query = useQuery(
    trpc.site.shop.bySession.queryOptions(
      { sessionId },
      {
        enabled: sessionId.length > 0,
        refetchInterval: (q) => {
          const d = q.state.data
          if (d && d.credited) return false
          if (Date.now() - startedAt > TIMEOUT_MS) return false
          return 2000
        },
      }
    )
  )

  const credited = query.data?.credited === true
  const timedOut = !credited && Date.now() - startedAt > TIMEOUT_MS

  return (
    <>
      <Head title="Thank you" />
      <Section>
        <PaperCard tilt={-1} className="mx-auto max-w-xl text-center">
          {credited ? (
            <>
              <Scrawl as="h1" className="text-4xl text-ink">
                Minutes added
              </Scrawl>
              <p className="mt-4 font-hand text-xl text-ink">
                Open {BRAND.name} on the iPad. The new minutes are waiting under Grown-ups.
              </p>
              <div className="mt-6 flex justify-center">
                <StickerLink to="/" tone="yellow" tilt={-1}>
                  Back to the start
                </StickerLink>
              </div>
            </>
          ) : timedOut ? (
            <>
              <Scrawl as="h1" className="text-4xl text-ink">
                Almost there
              </Scrawl>
              <p className="mt-4 font-hand text-xl text-ink">
                The minutes will show up on the iPad shortly. If they don’t, write to us at{' '}
                <a href={`mailto:${BRAND.supportEmail}`} className="text-purple underline">
                  {BRAND.supportEmail}
                </a>{' '}
                and we’ll sort it out.
              </p>
            </>
          ) : (
            <>
              <Scrawl as="h1" className="text-4xl text-ink">
                Paying…
              </Scrawl>
              <p className="mt-4 font-hand text-xl text-ink-soft">
                Hang on a moment while we add your minutes.
              </p>
            </>
          )}
          {sessionId.length === 0 ? (
            <p className="mt-4 font-hand text-lg text-ink-soft">
              No checkout to show.{' '}
              <Link to="/shop" className="text-purple underline">
                Back to the shop
              </Link>
            </p>
          ) : null}
        </PaperCard>
      </Section>
    </>
  )
}
