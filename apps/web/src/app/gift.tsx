import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { FIELD, LABEL, PaperCard, Scrawl, StickerButton } from '~/components/paper'
import { BRAND } from '../../../../packages/shared/src/brand'
import { useTRPC } from '~/lib/trpc'
import type { PackId } from '../../../../packages/shared/src/packs'
import { Head } from './seo'
import { PackChooser, Section, trpcCode } from './site-parts'

function messageFor(code: string | null): string {
  if (code === 'PRECONDITION_FAILED') return 'Gifting is taking a short nap; try again soon.'
  return 'Something went wrong. Try again in a moment.'
}

export function GiftPage() {
  const trpc = useTRPC()
  const [pack, setPack] = useState<PackId>('pack_120')
  const [fromName, setFromName] = useState('')
  const [toName, setToName] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState<string | null>(null)

  const checkout = useMutation(
    trpc.site.gift.checkout.mutationOptions({
      onSuccess: (res) => {
        window.location.assign(res.url)
      },
      onError: (err) => setError(messageFor(trpcCode(err))),
    })
  )

  function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    checkout.mutate({
      packId: pack,
      fromName: fromName.trim() || undefined,
      toName: toName.trim() || undefined,
      message: message.trim() || undefined,
    })
  }

  return (
    <>
      <Head title="Give a story" />
      <Section title="Give a story" headingClassName="text-4xl md:text-5xl text-ink">
        <p className="max-w-2xl font-hand text-xl text-ink">
          Buy a pack of minutes as a gift and we’ll give you a code with a printable card. The family
          adds the minutes in the app, and the storytelling begins.
        </p>

        <PaperCard tilt={-1} className="mt-6 max-w-2xl">
          <form onSubmit={onSubmit} className="flex flex-col gap-5">
            <div>
              <span className={LABEL}>Pick a pack</span>
              <PackChooser value={pack} onChange={setPack} />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="fromName" className={LABEL}>
                  From
                </label>
                <input
                  id="fromName"
                  className={FIELD}
                  value={fromName}
                  onChange={(e) => setFromName(e.target.value)}
                  maxLength={40}
                  placeholder="Grandma"
                />
              </div>
              <div>
                <label htmlFor="toName" className={LABEL}>
                  To
                </label>
                <input
                  id="toName"
                  className={FIELD}
                  value={toName}
                  onChange={(e) => setToName(e.target.value)}
                  maxLength={40}
                  placeholder="Ellie"
                />
              </div>
            </div>

            <div>
              <label htmlFor="message" className={LABEL}>
                A little message
              </label>
              <textarea
                id="message"
                className={`${FIELD} min-h-24`}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                maxLength={200}
                placeholder="Can’t wait to hear your stories!"
              />
            </div>

            {error ? (
              <p className="rounded-xl border-[3px] border-ink bg-crayon-red/15 px-4 py-2 font-hand text-lg text-ink">
                {error}
              </p>
            ) : null}

            <StickerButton type="submit" tone="yellow" tilt={-1} disabled={checkout.isPending}>
              {checkout.isPending ? 'Opening checkout…' : 'Buy a gift code'}
            </StickerButton>
          </form>
        </PaperCard>

        <p className="mt-5 max-w-2xl font-hand text-lg text-ink-soft">
          They redeem it in the app under Grown-ups, or at {BRAND.origin}/redeem.
        </p>
      </Section>
    </>
  )
}
