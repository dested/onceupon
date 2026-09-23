import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useMutation } from '@tanstack/react-query'
import { FIELD, LABEL, PaperCard, Scrawl, StickerButton } from '~/components/paper'
import { useTRPC } from '~/lib/trpc'
import { Head } from './seo'
import { Section, trpcCode } from './site-parts'

/** Uppercase, keep letters/digits, regroup into XXXX-XXXX-XXXX (max 12 chars). */
function formatGiftCode(input: string): string {
  const cleaned = input.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12)
  return (cleaned.match(/.{1,4}/g) ?? []).join('-')
}

function messageFor(code: string | null): string {
  if (code === 'NOT_FOUND') return 'That code doesn’t look right. Check the gift code and family code.'
  if (code === 'CONFLICT') return 'This code was already used.'
  return 'Something went wrong. Try again in a moment.'
}

export function RedeemPage() {
  const [params] = useSearchParams()
  const trpc = useTRPC()
  const [code, setCode] = useState(formatGiftCode(params.get('code') ?? ''))
  const [deviceCode, setDeviceCode] = useState('')
  const [error, setError] = useState<string | null>(null)

  const redeem = useMutation(
    trpc.site.gift.redeemOnWeb.mutationOptions({
      onError: (err) => setError(messageFor(trpcCode(err))),
    })
  )

  function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    redeem.mutate({ code: code.trim(), deviceCode: deviceCode.trim() })
  }

  if (redeem.isSuccess) {
    const minutes = Math.round(redeem.data.seconds / 60)
    return (
      <>
        <Head title="Minutes added" />
        <Section>
          <PaperCard tilt={-1} className="mx-auto max-w-xl text-center">
            <Scrawl as="h1" className="text-4xl text-ink">
              {minutes} minutes added to the family iPad
            </Scrawl>
            <p className="mt-4 font-hand text-xl text-ink">
              Open the app on the iPad and the new minutes are ready under Grown-ups.
            </p>
          </PaperCard>
        </Section>
      </>
    )
  }

  return (
    <>
      <Head title="Redeem a gift code" />
      <Section title="Redeem a gift code" headingClassName="text-4xl md:text-5xl text-ink">
        <PaperCard tilt={-1} className="max-w-xl">
          <p className="font-hand text-xl text-ink">
            Enter the gift code from the card, and the family code shown in the app under Grown-ups.
          </p>
          <form onSubmit={onSubmit} className="mt-6 flex flex-col gap-5">
            <div>
              <label htmlFor="giftCode" className={LABEL}>
                Gift code
              </label>
              <input
                id="giftCode"
                className={`${FIELD} font-scrawl tracking-[0.2em]`}
                value={code}
                onChange={(e) => setCode(formatGiftCode(e.target.value))}
                placeholder="XXXX-XXXX-XXXX"
                autoComplete="off"
                required
              />
            </div>
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

            {error ? (
              <p className="rounded-xl border-[3px] border-ink bg-crayon-red/15 px-4 py-2 font-hand text-lg text-ink">
                {error}
              </p>
            ) : null}

            <StickerButton
              type="submit"
              tone="green"
              tilt={-1}
              disabled={redeem.isPending || code.length < 14 || deviceCode.trim().length === 0}>
              {redeem.isPending ? 'Adding minutes…' : 'Add the minutes'}
            </StickerButton>
          </form>
        </PaperCard>
      </Section>
    </>
  )
}
