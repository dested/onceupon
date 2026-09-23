import { useEffect, useState } from 'react'
import { Check, Share2, X } from 'lucide-react'
import { appStore, useApp } from '~/story/store'
import { createShare, shareLink } from '~/backend/share'
import { ApiError } from '~/backend/api'
import { getStory } from '~/story/storage'
import { IconButton, PaperCard, StickerButton } from './bits'
import { VideoExportButton } from './VideoExport'

/**
 * "Send this story": turns a finished, saved story into a public link (and optionally includes the
 * child's recorded voice, when a grown-up has consented). Opened through the grown-up gate from the
 * closing card and the replay toolbar via `openShareCard(storyId)`. Hosted mode only.
 */

let shareStoryId: string | null = null

/** Set the story to share, then open the card (the opener runs the gate first). */
export function openShareCard(storyId: string): void {
  shareStoryId = storyId
  appStore.set({ shareOpen: true })
}

type Phase =
  | { k: 'form' }
  | { k: 'busy' }
  | { k: 'error'; text: string }
  | { k: 'done'; url: string }

export function ShareCard() {
  const open = useApp((s) => s.shareOpen)
  const hosted = useApp((s) => s.hosted)
  const shareVoice = useApp((s) => s.shareVoice)
  const [name, setName] = useState('')
  const [includeVoice, setIncludeVoice] = useState(true)
  const [phase, setPhase] = useState<Phase>({ k: 'form' })
  const [shareLabel, setShareLabel] = useState('Share')

  useEffect(() => {
    if (!open) return
    setName('')
    setIncludeVoice(true)
    setPhase({ k: 'form' })
    setShareLabel('Share')
  }, [open])

  if (!hosted || !open) return null

  const storyId = shareStoryId
  const record = storyId ? getStory(storyId) : null
  const close = (): void => appStore.set({ shareOpen: false })

  const makeLink = (): void => {
    if (!record) return
    setPhase({ k: 'busy' })
    void createShare(record, { childName: name.trim() || null, includeVoice: includeVoice && shareVoice })
      .then((res) => setPhase({ k: 'done', url: res.url }))
      .catch((e: unknown) => {
        let text = "That didn't work; try again"
        if (e instanceof ApiError) {
          if (e.code === 'consent_required') text = 'Turn on sharing with voice under Grown-ups'
          else if (e.code === 'upstream') text = 'The crayon needs the internet for this'
        }
        setPhase({ k: 'error', text })
      })
  }

  const doShare = (url: string): void => {
    void shareLink(url, record?.title ?? 'A story').then((how) => {
      setShareLabel(how === 'copied' ? 'Link copied' : 'Shared!')
    })
  }

  return (
    <div className="paywall-overlay" data-testid="share-card">
      <PaperCard className="modal-card share-card-card">
        <IconButton label="Close" className="paywall-close" onClick={close} data-testid="share-close">
          <X size={22} strokeWidth={3} />
        </IconButton>

        {phase.k === 'done' ? (
          <div className="share-card-done" data-testid="share-done">
            <span className="paywall-success-badge" aria-hidden="true">
              <Check size={30} strokeWidth={3} />
            </span>
            <h2 className="font-scrawl">Your link is ready</h2>
            <div className="share-card-pill" data-testid="share-url">
              {phase.url}
            </div>
            <div className="share-card-actions">
              <StickerButton tone="yellow" tilt={-2} onClick={() => doShare(phase.url)} data-testid="share-send">
                <Share2 size={20} strokeWidth={2.5} /> {shareLabel}
              </StickerButton>
              <VideoExportButton variant="studio" getRecord={() => (storyId ? getStory(storyId) : null)} />
              <button type="button" className="studio-button" onClick={close}>
                Done
              </button>
            </div>
          </div>
        ) : (
          <>
            <h2 className="font-scrawl share-card-heading">Send this story</h2>
            <label className="share-card-label" htmlFor="share-name">
              Who made it? (first name, optional)
            </label>
            <input
              id="share-name"
              value={name}
              maxLength={24}
              autoComplete="off"
              className="w-full rounded-xl border-[3px] border-ink bg-white px-3 py-2 font-hand text-lg text-ink outline-none"
              onChange={(e) => setName(e.target.value)}
              data-testid="share-name"
            />
            {shareVoice && (
              <label className="share-card-check font-hand">
                <input
                  type="checkbox"
                  className="h-5 w-5 accent-crayon-green"
                  checked={includeVoice}
                  onChange={(e) => setIncludeVoice(e.target.checked)}
                  data-testid="share-voice-toggle"
                />
                Include the voice
              </label>
            )}
            <p className="share-card-note">Anyone with the link can watch it for 90 days</p>
            {phase.k === 'error' && (
              <p className="paywall-notice is-error" role="status" data-testid="share-error">
                {phase.text}
              </p>
            )}
            <StickerButton
              tone="yellow"
              tilt={-1}
              className="share-card-make"
              disabled={phase.k === 'busy' || !record}
              onClick={makeLink}
              data-testid="share-make">
              {phase.k === 'busy' ? 'Making the link…' : 'Make a link'}
            </StickerButton>
          </>
        )}
      </PaperCard>
    </div>
  )
}
