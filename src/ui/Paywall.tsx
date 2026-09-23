import { useEffect, useState } from 'react'
import { Check, X } from 'lucide-react'
import { useApp, appStore } from '~/story/store'
import { buyPack, loadPrices, restorePurchases, type PriceInfo } from '~/backend/purchases'
import { centsPerMinute, packById, PACKS, type PackId } from '../../packages/shared/src/packs'
import { IconButton, PaperCard, StickerButton } from './bits'
import { gate, openParentArea, startFreshStory } from './hosted'

const FEATURED = PACKS.find((p) => p.featured) ?? PACKS[0]

type Notice = { kind: 'info' | 'error'; text: string } | null

/**
 * The sleepy-crayon paywall / rebuy screen. Every pack is a one-time minute purchase (no subscription).
 * Opened from the minutes chip, the parent area, or when the crayon runs out mid-story. Buying goes
 * through the grown-up gate; on the web the buy button hands off to the website shop. In the app it is
 * StoreKit only, with no link to the web shop (App Store rules). Hosted only.
 */
export function Paywall() {
  const open = useApp((s) => s.paywallOpen)
  const hosted = useApp((s) => s.hosted)
  const lastPack = useApp((s) => s.lastPack)
  const sleepy = useApp((s) => s.sleepy)
  const ended = useApp((s) => s.ended)
  const endReason = useApp((s) => s.endReason)
  const config = useApp((s) => s.config)

  const [prices, setPrices] = useState<PriceInfo[] | null>(null)
  const [selected, setSelected] = useState<PackId>(lastPack ?? FEATURED?.id ?? 'pack_120')
  const [busyPack, setBusyPack] = useState<PackId | null>(null)
  const [restoreBusy, setRestoreBusy] = useState(false)
  const [notice, setNotice] = useState<Notice>(null)
  const [success, setSuccess] = useState<{ minutes: number } | null>(null)

  useEffect(() => {
    void loadPrices().then(setPrices)
  }, [])
  useEffect(() => {
    if (!open) return
    setSelected(appStore.get().lastPack ?? FEATURED?.id ?? 'pack_120')
    setBusyPack(null)
    setRestoreBusy(false)
    setNotice(null)
    setSuccess(null)
  }, [open])

  if (!hosted || !open) return null

  const paused = config?.purchasesPaused ?? false
  const sleepyContext = sleepy || endReason === 'sleepy'
  const rebuy = ended && endReason === 'sleepy'
  const priceFor = (id: PackId): string | null => prices?.find((p) => p.packId === id)?.localizedPrice ?? null

  const close = (): void => appStore.set({ paywallOpen: false })

  const buy = (id: PackId): void => {
    setNotice(null)
    void gate().then(async (ok) => {
      if (!ok) return
      setBusyPack(id)
      try {
        const res = await buyPack(id)
        if (res.ok) {
          setSuccess({ minutes: packById(id).minutes })
        } else if (res.reason === 'paused') {
          setNotice({ kind: 'info', text: 'The shop is taking a short nap; try again soon' })
        } else if (res.reason === 'failed') {
          setNotice({ kind: 'error', text: 'Something went wrong with the purchase; nothing was charged' })
        }
        // 'cancelled' and 'web' show nothing (web navigates away).
      } finally {
        setBusyPack(null)
      }
    })
  }

  const keepTelling = (): void => {
    close()
    if (rebuy) startFreshStory()
  }

  const restore = (): void => {
    setNotice(null)
    void gate().then(async (ok) => {
      if (!ok) return
      setRestoreBusy(true)
      try {
        const res = await restorePurchases()
        setNotice({
          kind: 'info',
          text:
            res.credited > 0
              ? `${res.credited} ${res.credited === 1 ? 'purchase' : 'purchases'} restored`
              : 'Nothing to restore',
        })
      } catch {
        setNotice({ kind: 'error', text: 'Could not reach the store; try again soon' })
      } finally {
        setRestoreBusy(false)
      }
    })
  }

  const openRedeem = (): void => {
    void gate().then((ok) => {
      if (ok) openParentArea('redeem')
    })
  }

  return (
    <div className="paywall-overlay" data-testid="paywall">
      <PaperCard className="modal-card paywall-card">
        <IconButton label="Close" className="paywall-close" onClick={close} data-testid="paywall-close">
          <X size={22} strokeWidth={3} />
        </IconButton>

        {success ? (
          <div className="paywall-success" data-testid="paywall-success">
            <span className="paywall-success-badge" aria-hidden="true">
              <Check size={30} strokeWidth={3} />
            </span>
            <h2 className="font-scrawl">{success.minutes} minutes added!</h2>
            <StickerButton tone="green" tilt={-2} onClick={keepTelling} data-testid="paywall-keep">
              Keep telling
            </StickerButton>
          </div>
        ) : (
          <>
            <h2 className="font-scrawl paywall-heading">
              {sleepyContext ? 'The crayon needs more minutes' : 'More story minutes'}
            </h2>
            <p className="paywall-sub">Every minute you buy is yours forever, no subscription</p>

            <div className="paywall-tiles" role="radiogroup" aria-label="Minute packs">
              {PACKS.map((pack) => {
                const price = priceFor(pack.id)
                const isSelected = pack.id === selected
                return (
                  <button
                    key={pack.id}
                    type="button"
                    role="radio"
                    aria-checked={isSelected}
                    className={`paywall-tile ${isSelected ? 'is-selected' : ''}`}
                    onClick={() => setSelected(pack.id)}
                    data-testid={`pack-${pack.id}`}>
                    {pack.featured && <span className="paywall-popular">Most popular</span>}
                    <span className="paywall-tile-name font-scrawl">{pack.name}</span>
                    <span className="paywall-tile-minutes">{pack.minutes} minutes</span>
                    <span className="paywall-tile-price">
                      {price ?? <span className="paywall-price-skeleton" aria-hidden="true" />}
                    </span>
                    <span className="paywall-tile-rate">{centsPerMinute(pack)}¢ a minute</span>
                  </button>
                )
              })}
            </div>

            <StickerButton
              tone="yellow"
              tilt={-1}
              className="paywall-buy"
              disabled={paused || busyPack !== null}
              onClick={() => buy(selected)}
              data-testid="paywall-buy">
              {busyPack !== null
                ? 'One moment…'
                : paused
                  ? 'The shop is taking a nap'
                  : `Buy ${packById(selected).name}`}
            </StickerButton>

            {notice && (
              <p className={`paywall-notice ${notice.kind === 'error' ? 'is-error' : ''}`} role="status">
                {notice.text}
              </p>
            )}

            <div className="paywall-links">
              <button type="button" className="paywall-link" onClick={restore} disabled={restoreBusy}>
                {restoreBusy ? 'Restoring…' : 'Restore purchases'}
              </button>
              <button type="button" className="paywall-link" onClick={openRedeem}>
                Redeem a gift code
              </button>
            </div>
          </>
        )}
      </PaperCard>
    </div>
  )
}
