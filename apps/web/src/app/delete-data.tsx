import { useState } from 'react'
import { FIELD, LABEL, PaperCard, Scrawl, StickerButton } from '~/components/paper'
import { BRAND } from '../../../../packages/shared/src/brand'
import { Head } from './seo'
import { Section } from './site-parts'

export function DeleteDataPage() {
  const [deviceCode, setDeviceCode] = useState('')
  const [email, setEmail] = useState('')

  const ready = deviceCode.trim().length > 0 && email.trim().length > 0
  const subject = `Delete my data (${deviceCode.trim() || 'family code'})`
  const body = `Please delete the server-side data for this family.\n\nFamily code: ${deviceCode.trim()}\nContact email: ${email.trim()}`
  const mailto = `mailto:${BRAND.supportEmail}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`

  function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (ready) window.location.href = mailto
  }

  return (
    <>
      <Head title="Delete my data" />
      <Section title="Delete my data" headingClassName="text-4xl md:text-5xl text-ink">
        <PaperCard tilt={-1} className="max-w-2xl">
          <p className="font-hand text-xl text-ink">
            Deleting removes the server-side records tied to your device: the minutes balance, purchase
            receipts, and any stories you have shared. Shared links go down straight away. We complete
            deletion requests within 30 days.
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
              <label htmlFor="email" className={LABEL}>
                Email for confirmation
              </label>
              <input
                id="email"
                type="email"
                className={FIELD}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                placeholder="you@example.com"
                required
              />
            </div>

            <StickerButton type="submit" tone="red" tilt={-1} disabled={!ready}>
              Request deletion
            </StickerButton>
          </form>

          <p className="mt-6 font-hand text-lg text-ink-soft">
            You can also delete every story on the iPad from My stories, and uninstalling removes
            everything stored on the device.
          </p>
        </PaperCard>
      </Section>
    </>
  )
}
