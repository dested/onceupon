import type { LoaderFunctionArgs } from 'react-router-dom'
import { useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { PaperCard, Scrawl, StickerButton, StickerLink } from '~/components/paper'
import { getBrowserClients } from '~/lib/trpc'
import { useTRPC } from '~/lib/trpc'
import { BRAND } from '../../../../packages/shared/src/brand'
import type { SsrLoaderContext } from './routes'
import { Head } from './seo'
import { Section, StudioFrame } from './site-parts'

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

// UTC + fixed month names so SSR and client render the same string (no hydration mismatch).
function formatDate(iso: string): string {
  const d = new Date(iso)
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`
}

/** SSR-prefetch the share metadata so the OG tags are in the first byte for iMessage unfurls. */
export async function shareLoader({ params, context }: LoaderFunctionArgs): Promise<null> {
  const id = params.id
  if (!id) return null
  if (typeof window === 'undefined') {
    const ctx = context as SsrLoaderContext
    await ctx.queryClient.prefetchQuery(ctx.trpc.site.share.meta.queryOptions({ id }))
  } else {
    const { queryClient, trpc } = getBrowserClients()
    await queryClient.prefetchQuery(trpc.site.share.meta.queryOptions({ id }))
  }
  return null
}

export function SharePage() {
  const { id = '' } = useParams()
  const trpc = useTRPC()
  const { data: meta, isLoading } = useQuery(
    trpc.site.share.meta.queryOptions({ id }, { enabled: id.length > 0 })
  )

  if (!meta) {
    return (
      <>
        <Head title="This story has gone back on the shelf" />
        <Section>
          <PaperCard tilt={-1} className="mx-auto max-w-xl text-center">
            <Scrawl as="h1" className="text-4xl text-ink">
              This story has gone back on the shelf
            </Scrawl>
            <p className="mt-4 font-hand text-xl text-ink-soft">
              {isLoading ? 'Finding the story…' : 'The link may have expired or been taken down.'}
            </p>
            <div className="mt-6 flex justify-center">
              <StickerLink to="/" tone="yellow" tilt={-1}>
                Make your own
              </StickerLink>
            </div>
          </PaperCard>
        </Section>
      </>
    )
  }

  const heading = meta.childName ? `${meta.childName} made this story` : 'A story by a young storyteller'
  const appStore = BRAND.appStoreUrl || '/'

  function getTheApp() {
    fetch(`/api/share/${id}/install`, { method: 'POST' }).catch(() => {})
    window.location.href = appStore
  }

  return (
    <>
      <Head
        title={heading}
        description="Told out loud and drawn by a crayon"
        image={meta.coverUrl ? `${BRAND.origin}${meta.coverUrl}` : undefined}
      />
      {/* Phones and short landscape screens: a 28 px heading and tight padding, so heading, picture and
          play are on the first screen. */}
      <Section className="py-3 [@media(min-width:40rem)_and_(min-height:33rem)]:py-8">
        <Scrawl
          as="h1"
          className="mb-3 line-clamp-2 text-center text-[28px] leading-tight text-ink [@media(min-width:40rem)_and_(min-height:33rem)]:mb-6 [@media(min-width:40rem)_and_(min-height:33rem)]:text-4xl [@media(min-width:48rem)_and_(min-height:33rem)]:text-5xl">
          {heading}
        </Scrawl>
        {/* Phones: 16 px gutters (the layout pads 24). Short landscape screens: the whole book fits the height. */}
        <div className="-mx-2 sm:mx-auto sm:max-w-[min(56rem,calc((100svh-40px)*1.6))]">
          <StudioFrame src={`/app/?player=${id}&embed=1`} title={heading} bareOnPhone />
        </div>
        <div className="mx-auto mt-1 flex max-w-4xl flex-col items-center gap-3 text-center sm:mt-8">
          <p className="font-hand text-xl text-ink">
            Made with {BRAND.name}. Your kid’s turn:
          </p>
          <StickerButton type="button" tone="yellow" tilt={-2} onClick={getTheApp}>
            Get it on the App Store
          </StickerButton>
          <p className="font-hand text-lg text-ink-soft">
            This link goes back on the shelf on {formatDate(meta.expiresAt)}.
          </p>
        </div>
      </Section>
    </>
  )
}
