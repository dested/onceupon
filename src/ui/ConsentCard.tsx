import { useEffect, useRef, useState } from 'react'
import { useApp } from '~/story/store'
import { agreeConsent, declineConsent } from '~/backend/consent'
import { APP_SHELL } from '~/backend/config'
import { openExternal } from '~/backend/purchases'
import { BRAND } from '../../packages/shared/src/brand'
import '~/styles/consent.css'

/**
 * "Before the first story": the grown-up's one-time yes to sending story words to the AI service. Opened by
 * `askConsent()` (src/backend/consent.ts), always after the parental gate, so the Privacy Policy link
 * goes straight out. A native <dialog>, so it sits above the Grown-ups area when opened from there.
 */
export function ConsentCard() {
  const open = useApp((s) => s.consentOpen)
  const privacyUrl = useApp((s) => s.config?.privacyUrl) || `${BRAND.origin}/privacy`
  const ref = useRef<HTMLDialogElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (open && !d.open) {
      setError('')
      setBusy(false)
      d.showModal()
    } else if (!open && d.open) d.close()
  }, [open])

  const agree = (): void => {
    setError('')
    setBusy(true)
    agreeConsent()
      .catch(() => setError("Couldn't reach the crayon. Try again in a moment."))
      .finally(() => setBusy(false))
  }

  return (
    <dialog
      ref={ref}
      className="new-story-dialog consent-card"
      onCancel={(e) => {
        e.preventDefault()
        declineConsent()
      }}
      aria-labelledby="consent-heading"
      data-testid="ai-consent-card">
      <h2 id="consent-heading">Before the first story</h2>
      <div className="consent-copy">
        <p>
          To draw a story, Squiggletale sends the words your child says, as text, to our server, which asks a
          third-party AI service to turn them into a drawing.
        </p>
        <p>
          {APP_SHELL
            ? "Speech becomes words on this device. Recordings of your child's voice never leave it unless you share a story."
            : 'Your browser turns speech into words.'}
        </p>
        <p>That AI service doesn't use these words to train its models and deletes them within 30 days.</p>
      </div>
      {error && (
        <p className="consent-error" role="alert">
          {error}
        </p>
      )}
      <div className="consent-actions">
        <button
          type="button"
          className="studio-button"
          onClick={declineConsent}
          disabled={busy}
          data-testid="ai-consent-not-now">
          Not now
        </button>
        <button
          type="button"
          className="studio-button consent-agree"
          onClick={agree}
          disabled={busy}
          data-testid="ai-consent-agree">
          I agree
        </button>
      </div>
      <button
        type="button"
        className="consent-link"
        onClick={() => void openExternal(privacyUrl)}
        data-testid="ai-consent-privacy">
        Privacy Policy
      </button>
    </dialog>
  )
}
