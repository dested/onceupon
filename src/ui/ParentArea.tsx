import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { appStore, persistSettings, useApp } from '~/story/store'
import { openExternal, redeemGift, restorePurchases } from '~/backend/purchases'
import { APP_SHELL } from '~/backend/config'
import { listShares, unpublishShare } from '~/backend/share'
import { refreshDevice, setShareVoice } from '~/backend/device'
import { ApiError } from '~/backend/api'
import { formatMinutes, takeParentFocus } from './hosted'
import { PaperCard, StickerButton } from './bits'
import type { ShareSummary } from '../../packages/shared/src/api'

/**
 * The grown-up area (always reached through the parental gate): minutes and buying, gift codes, the
 * family code (a web-shop pointer on the web only), share-with-voice consent and the list of shared stories, replaying the
 * tutorial, sound, and the privacy links. Hosted mode only.
 */

function formatNextWeekly(iso: string | null): string {
  if (!iso) return 'soon'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return 'soon'
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })
}

function formatGiftInput(raw: string): string {
  const clean = raw
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 12)
  const groups = clean.match(/.{1,4}/g)
  return groups ? groups.join('-') : ''
}

export function ParentArea() {
  const open = useApp((s) => s.parentOpen)
  const hosted = useApp((s) => s.hosted)
  const balanceSec = useApp((s) => s.balanceSec)
  const paying = useApp((s) => s.paying)
  const shareVoice = useApp((s) => s.shareVoice)
  const deviceCode = useApp((s) => s.deviceCode)
  const sound = useApp((s) => s.settings.sound)
  const config = useApp((s) => s.config)

  const [nextWeekly, setNextWeekly] = useState<string | null>(null)
  const [restoreBusy, setRestoreBusy] = useState(false)
  const [restoreMsg, setRestoreMsg] = useState('')
  const [gift, setGift] = useState('')
  const [giftBusy, setGiftBusy] = useState(false)
  const [giftMsg, setGiftMsg] = useState('')
  const [giftError, setGiftError] = useState('')
  const [copied, setCopied] = useState(false)
  const [consentOpen, setConsentOpen] = useState(false)
  const [voiceBusy, setVoiceBusy] = useState(false)
  const [voiceError, setVoiceError] = useState('')
  const [shares, setShares] = useState<ShareSummary[] | null>(null)
  const [unpublishId, setUnpublishId] = useState<string | null>(null)
  const [unpublishBusy, setUnpublishBusy] = useState('')
  const giftRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    setRestoreMsg('')
    setGift('')
    setGiftMsg('')
    setGiftError('')
    setCopied(false)
    setConsentOpen(false)
    setVoiceError('')
    setUnpublishId(null)
    void refreshDevice().then((state) => setNextWeekly(state?.nextWeeklyAt ?? null))
    void listShares()
      .then(setShares)
      .catch(() => setShares([]))
    const focus = takeParentFocus()
    if (focus === 'redeem') window.setTimeout(() => giftRef.current?.scrollIntoView({ behavior: 'smooth' }), 120)
  }, [open])

  if (!hosted || !open) return null

  const close = (): void => appStore.set({ parentOpen: false })

  const restore = (): void => {
    setRestoreMsg('')
    setRestoreBusy(true)
    void restorePurchases()
      .then((res) =>
        setRestoreMsg(
          res.credited > 0
            ? `${res.credited} ${res.credited === 1 ? 'purchase' : 'purchases'} restored`
            : 'Nothing to restore'
        )
      )
      .catch(() => setRestoreMsg('Could not reach the store'))
      .finally(() => setRestoreBusy(false))
  }

  const addGift = (): void => {
    const code = gift.trim()
    if (!code) return
    setGiftMsg('')
    setGiftError('')
    setGiftBusy(true)
    void redeemGift(code)
      .then((res) => {
        setGiftMsg(`${Math.round(res.seconds / 60)} minutes added`)
        setGift('')
      })
      .catch((e: unknown) => {
        if (e instanceof ApiError && e.code === 'invalid_code') setGiftError("That code doesn't look right")
        else if (e instanceof ApiError && e.code === 'already_used') setGiftError('That code was already used')
        else setGiftError("That didn't work; try again")
      })
      .finally(() => setGiftBusy(false))
  }

  const copyCode = (): void => {
    void navigator.clipboard.writeText(deviceCode).then(() => {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1800)
    })
  }

  const toggleVoice = (on: boolean): void => {
    setVoiceError('')
    if (on) {
      setConsentOpen(true)
      return
    }
    setVoiceBusy(true)
    void setShareVoice(false)
      .catch(() => setVoiceError('Could not save that; try again'))
      .finally(() => setVoiceBusy(false))
  }

  const agreeConsent = (): void => {
    setVoiceBusy(true)
    void setShareVoice(true)
      .then(() => setConsentOpen(false))
      .catch(() => setVoiceError('Could not save that; try again'))
      .finally(() => setVoiceBusy(false))
  }

  const doUnpublish = (id: string): void => {
    if (unpublishId !== id) {
      setUnpublishId(id)
      return
    }
    setUnpublishBusy(id)
    void unpublishShare(id)
      .then(() => setShares((prev) => (prev ?? []).filter((s) => s.id !== id)))
      .catch(() => undefined)
      .finally(() => {
        setUnpublishBusy('')
        setUnpublishId(null)
      })
  }

  const toggleSound = (): void => {
    appStore.set((s) => {
      const settings = { ...s.settings, sound: !s.settings.sound }
      persistSettings(settings)
      return { settings }
    })
  }

  const privacyLinks = config
    ? [
        { label: 'Privacy', url: config.privacyUrl },
        { label: 'Terms', url: config.termsUrl },
        { label: 'Support', url: config.supportUrl },
        { label: 'Delete my data', url: config.deleteDataUrl },
      ].filter((l) => l.url.length > 0)
    : []

  const heading = 'font-hand text-xl text-ink'
  const sectionDivide = 'mt-6 border-t-2 border-ink/10 pt-5'
  const errorLine = 'mt-1 font-hand text-base text-crayon-red'
  const okLine = 'mt-1 font-hand text-base text-ink-soft'
  const linkBtn = 'font-hand text-lg text-crayon-blue underline'

  return (
    <div className="modal-overlay bg-ink/30 z-30" onClick={close} data-testid="parent-area">
      <PaperCard className="modal-card w-[38rem]">
        <div onClick={(e) => e.stopPropagation()}>
          <button onClick={close} aria-label="Close" className="text-ink absolute top-4 right-4" data-testid="parent-close">
            <X size={26} strokeWidth={3} />
          </button>
          <h2 className="font-scrawl mb-4 text-3xl">Grown-ups</h2>

          {/* Minutes */}
          <h3 className={heading}>Minutes</h3>
          <div className="font-scrawl text-5xl leading-none text-ink" data-testid="parent-balance">
            {formatMinutes(balanceSec)}
          </div>
          <p className="mt-1 font-hand text-base text-ink-soft">next free minute top-up: {formatNextWeekly(nextWeekly)}</p>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <StickerButton tone="yellow" tilt={-1} onClick={() => appStore.set({ paywallOpen: true })} data-testid="parent-buy">
              Buy minutes
            </StickerButton>
            <button type="button" className={linkBtn} onClick={restore} disabled={restoreBusy}>
              {restoreBusy ? 'Restoring…' : 'Restore purchases'}
            </button>
          </div>
          {restoreMsg && <p className={okLine}>{restoreMsg}</p>}

          {/* Gift code */}
          <div className={sectionDivide} ref={giftRef}>
            <h3 className={heading}>Gift code</h3>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <input
                value={gift}
                placeholder="XXXX-XXXX-XXXX"
                autoComplete="off"
                className="w-56 rounded-xl border-[3px] border-ink bg-white px-3 py-2 text-center font-hand text-lg tracking-[0.15em] text-ink outline-none"
                onChange={(e) => setGift(formatGiftInput(e.target.value))}
                data-testid="gift-input"
              />
              <StickerButton
                tone="green"
                tilt={-1}
                onClick={addGift}
                disabled={giftBusy || gift.trim().length === 0}
                data-testid="gift-add">
                {giftBusy ? 'Adding…' : 'Add minutes'}
              </StickerButton>
            </div>
            {giftMsg && <p className={okLine}>{giftMsg}</p>}
            {giftError && <p className={errorLine}>{giftError}</p>}
          </div>

          {/* Family code */}
          <div className={sectionDivide}>
            <h3 className={heading}>Family code</h3>
            <div className="mt-2 flex flex-wrap items-center gap-4">
              <span className="font-scrawl text-[28px] tracking-[0.3em] text-ink" data-testid="family-code">
                {deviceCode || '········'}
              </span>
              <button type="button" className={linkBtn} onClick={copyCode}>
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
            {/* In the app purchases are StoreKit only: no pointer to the web shop (App Store rules). */}
            {!APP_SHELL && (
              <p className="mt-2 font-hand text-base text-ink-soft">
                Use it to buy minutes on the web{config?.shopUrl ? ` at ${config.shopUrl}` : ''}
              </p>
            )}
          </div>

          {/* Sharing */}
          <div className={sectionDivide}>
            <h3 className={heading}>Sharing</h3>
            <label className="mt-2 flex items-center gap-3 font-hand text-lg text-ink">
              <input
                type="checkbox"
                className="h-5 w-5 accent-crayon-green"
                checked={shareVoice}
                disabled={!paying || voiceBusy}
                onChange={(e) => toggleVoice(e.target.checked)}
                data-testid="share-voice-consent"
              />
              Share stories with your child's voice
            </label>
            {!paying && <p className={okLine}>Buy any pack to unlock sharing with voice</p>}
            {voiceError && <p className={errorLine}>{voiceError}</p>}

            {consentOpen && (
              <PaperCard className="mt-3 bg-paper-deep !p-4">
                <p className="font-hand text-base text-ink">
                  Turning this on uploads the story's words and drawing, plus the recording of your child telling it.
                  Anyone with the link can hear it. Links expire after 90 days, and you can unpublish any story below at
                  any time. We never use it for anything else.
                </p>
                <div className="mt-3 flex flex-wrap gap-3">
                  <StickerButton tone="green" tilt={-1} onClick={agreeConsent} disabled={voiceBusy} data-testid="consent-agree">
                    {voiceBusy ? 'Saving…' : 'I agree'}
                  </StickerButton>
                  <StickerButton tone="paper" tilt={1} onClick={() => setConsentOpen(false)}>
                    Not now
                  </StickerButton>
                </div>
              </PaperCard>
            )}

            <h4 className="mt-4 font-hand text-lg text-ink-soft">Shared stories</h4>
            {shares === null ? (
              <p className={okLine}>Loading…</p>
            ) : shares.length === 0 ? (
              <p className={okLine}>Nothing shared yet</p>
            ) : (
              <ul className="mt-2 flex flex-col gap-2" data-testid="shares-list">
                {shares.map((s) => (
                  <li
                    key={s.id}
                    className="flex flex-wrap items-center gap-2 rounded-xl border-2 border-ink/15 px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-hand text-lg text-ink">{s.storyId}</div>
                      <div className="font-hand text-sm text-ink-soft">
                        {new Date(s.createdAt).toLocaleDateString()} · {s.views} {s.views === 1 ? 'view' : 'views'}
                      </div>
                    </div>
                    <button type="button" className={linkBtn} onClick={() => void openExternal(s.url)}>
                      open
                    </button>
                    <StickerButton
                      tilt={0}
                      tone={unpublishId === s.id ? 'red' : 'paper'}
                      className="!px-3 !py-1 !text-base"
                      disabled={unpublishBusy === s.id}
                      onClick={() => doUnpublish(s.id)}>
                      {unpublishBusy === s.id ? '…' : unpublishId === s.id ? 'sure?' : 'unpublish'}
                    </StickerButton>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Tutorial */}
          <div className={sectionDivide}>
            <h3 className={heading}>Tutorial</h3>
            <StickerButton
              tone="paper"
              tilt={-1}
              className="mt-2"
              onClick={() => appStore.set({ parentOpen: false, tutorialOpen: true })}
              data-testid="replay-tutorial">
              Watch the intro again
            </StickerButton>
          </div>

          {/* Sound & microphone */}
          <div className={sectionDivide}>
            <h3 className={heading}>Sound &amp; microphone</h3>
            <label className="mt-2 flex items-center gap-3 font-hand text-lg text-ink">
              <input
                type="checkbox"
                className="h-5 w-5 accent-crayon-green"
                checked={sound}
                onChange={toggleSound}
                data-testid="parent-sound"
              />
              Crayon sounds
            </label>
            <StickerButton
              tone="paper"
              tilt={-1}
              className="mt-3"
              onClick={() => appStore.set({ settingsOpen: true })}
              data-testid="open-settings">
              Microphone &amp; sound
            </StickerButton>
          </div>

          {/* Privacy */}
          <div className={sectionDivide}>
            <h3 className={heading}>Privacy</h3>
            <div className="mt-2 flex flex-wrap gap-x-5 gap-y-2">
              {privacyLinks.map((link) => (
                <button key={link.label} type="button" className={linkBtn} onClick={() => void openExternal(link.url)}>
                  {link.label}
                </button>
              ))}
            </div>
            <p className="mt-2 font-hand text-base text-ink-soft">
              Deleting the app removes every story stored on this iPad
            </p>
          </div>
        </div>
      </PaperCard>
    </div>
  )
}
