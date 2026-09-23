import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useMutation } from '@tanstack/react-query'
import { FIELD, LABEL, PaperCard, Scrawl, StickerButton } from '~/components/paper'
import { useTRPC } from '~/lib/trpc'
import { isPackId, type PackId } from '../../../../packages/shared/src/packs'
import { Head } from './seo'
import { PackChooser, Section, trpcCode } from './site-parts'

const DEFAULT_PACK: PackId = 'pack_120'

function initialPack(param: string | null): PackId {
  return param && isPackId(param) ? param : DEFAULT_PACK
}

function messageFor(code: string | null): string {
  if (code === 'NOT_FOUND') return 'We couldn’t find that family code. Check it in the app under Grown-ups.'
  if (code === 'PRECONDITION_FAILED') return 'The shop is taking a short nap; try again soon.'
  return 'Something went wrong. Try again in a moment.'
}

export function ShopPage() {
  const [params] = useSearchParams()
  const trpc = useTRPC()
  const [deviceCode, setDeviceCode] = useState((params.get('d') ?? '').toUpperCase())
  const [pack, setPack] = useState<PackId>(initialPack(params.get('pack')))
  const [error, setError] = useState<string | null>(null)

  const checkout = useMutation(
    trpc.site.shop.checkout.mutationOptions({
      onSuccess: (res) => {
        window.location.assign(res.url)
      },
      onError: (err) => setError(messageFor(trpcCode(err))),
    })
  )

  function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    checkout.mutate({ packId: pack, deviceCode: deviceCode.trim() })
  }

  return (
    <>
      <Head title="Buy minutes on the web" />
      <Section title="Buy minutes on the web" headingClassName="text-4xl md:text-5xl text-ink">
        <PaperCard tilt={-1} className="max-w-2xl">
          <p className="font-hand text-xl text-ink">
            Open the app, tap Grown-ups, and read the family code shown there. Enter it below and pick
            a pack.
          </p>
          <form onSubmit={onSubmit} className="mt-6 flex flex-col gap-5">
            <div>
              <label htmlFor="deviceCode" className={LABEL}>
                Family code
              </label>
              <input
                id="deviceCode"
                className={`${FIELD} font-scrawl uppercase tracking-[0.3em]`}
                value={deviceCode}
                onChange={(e) => setDeviceCode(e.target.value.toUpperCase())}
                maxLength={8}
                autoCapitalize="characters"
                autoComplete="off"
                placeholder="ABCD1234"
                required
              />
            </div>

            <div>
              <span className={LABEL}>Pick a pack</span>
              <PackChooser value={pack} onChange={setPack} />
            </div>

            {error ? (
              <p className="rounded-xl border-[3px] border-ink bg-crayon-red/15 px-4 py-2 font-hand text-lg text-ink">
                {error}
              </p>
            ) : null}

            <StickerButton
              type="submit"
              tone="yellow"
              tilt={-1}
              disabled={checkout.isPending || deviceCode.trim().length === 0}>
              {checkout.isPending ? 'Opening checkout…' : 'Checkout with Stripe'}
            </StickerButton>
            <p className="font-hand text-lg text-ink-soft">
              Minutes land on the iPad within a minute of paying.
            </p>
          </form>
        </PaperCard>
      </Section>
    </>
  )
}
