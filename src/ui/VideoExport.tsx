import { useEffect, useRef, useState } from 'react'
import { Download } from 'lucide-react'
import { exportStoryVideo, ExportUnsupportedError, videoFileName } from '~/export/mp4'
import { NATIVE } from '~/backend/config'
import { saveVideo, shareVideo } from '~/backend/share'
import type { StoryRecord } from '~/story/storage'
import { appStore } from '~/story/store'
import { IconButton, PaperCard, StickerButton } from './bits'

type ExportState =
  | { k: 'idle' }
  | { k: 'running'; fraction: number; phase: 'frames' | 'audio' | 'mux' }
  | { k: 'done'; mb: number; how: 'downloaded' }
  /** Native: the camera-roll result, with Share as the second step or the fallback. */
  | { k: 'kept'; mb: number; how: 'saved' | 'denied' | 'unsaved'; sharing: boolean }
  | { k: 'error'; message: string }

const PHASE_WORDS = {
  frames: 'drawing every page',
  audio: 'adding the crayon sounds',
  mux: 'wrapping it up',
} as const

/**
 * "Download video": renders the saved story to an .mp4 in the browser, then saves it to Photos on the
 * iPad app (with a Share button for AirDrop/Messages, also the fallback when Photos is off) or hands
 * it to the browser's downloads on the web. `icon` sits in the replay toolbar; `studio` is the closing
 * card's button; `player` is the share page's sticker.
 */
export function VideoExportButton({
  getRecord,
  variant,
  onExported,
}: {
  /** Called on click; the caller saves the live story first if needed. Null = nothing to export. */
  getRecord: () => StoryRecord | null
  variant: 'icon' | 'studio' | 'player'
  /** After the video is shared or downloaded (share page counts a download). */
  onExported?: () => void
}) {
  const [state, setState] = useState<ExportState>({ k: 'idle' })
  const abortRef = useRef<AbortController | null>(null)
  const videoRef = useRef<{ blob: Blob; filename: string } | null>(null)
  const actionLabel = NATIVE ? 'Save video' : 'Download video'

  useEffect(() => () => abortRef.current?.abort(), [])
  useEffect(() => {
    if (state.k !== 'done') return
    const t = window.setTimeout(() => setState({ k: 'idle' }), 3000)
    return () => window.clearTimeout(t)
  }, [state.k])

  const start = async (): Promise<void> => {
    if (state.k === 'running') return
    const record = getRecord()
    if (!record || record.events.length === 0) {
      setState({ k: 'error', message: 'There is no story to make a video of yet' })
      return
    }
    const abort = new AbortController()
    abortRef.current = abort
    setState({ k: 'running', fraction: 0, phase: 'frames' })
    try {
      const res = await exportStoryVideo(record, {
        signal: abort.signal,
        moderation: appStore.get().settings.moderation,
        onProgress: (p) => setState({ k: 'running', fraction: p.fraction, phase: p.phase }),
      })
      const filename = videoFileName(record.title)
      const mb = res.blob.size / 1e6
      if (NATIVE) {
        videoRef.current = { blob: res.blob, filename }
        let how: 'saved' | 'denied' | 'unsaved'
        try {
          const saved = await saveVideo(res.blob, filename)
          how = saved === 'denied' ? 'denied' : 'saved'
        } catch (e) {
          console.error('save to Photos failed', e)
          how = 'unsaved'
        }
        setState({ k: 'kept', mb, how, sharing: false })
      } else {
        await saveVideo(res.blob, filename)
        setState({ k: 'done', mb, how: 'downloaded' })
      }
      onExported?.()
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') setState({ k: 'idle' })
      else if (e instanceof ExportUnsupportedError) setState({ k: 'error', message: e.message })
      else {
        console.error('video export failed', e)
        setState({ k: 'error', message: 'The video got stuck. Try again?' })
      }
    } finally {
      if (abortRef.current === abort) abortRef.current = null
    }
  }

  const share = async (): Promise<void> => {
    const video = videoRef.current
    if (!video || state.k !== 'kept' || state.sharing) return
    setState({ ...state, sharing: true })
    try {
      await shareVideo(video.blob, video.filename)
    } catch (e) {
      console.error('share video failed', e)
    } finally {
      setState((s) => (s.k === 'kept' ? { ...s, sharing: false } : s))
    }
  }

  const closeCard = (): void => {
    videoRef.current = null
    setState({ k: 'idle' })
  }

  const running = state.k === 'running'
  return (
    <>
      {variant === 'icon' ? (
        <IconButton
          label={actionLabel}
          onClick={() => void start()}
          disabled={running}
          data-testid="download-video">
          <Download size={22} strokeWidth={2.5} />
        </IconButton>
      ) : variant === 'player' ? (
        <StickerButton
          tone="yellow"
          tilt={-2}
          onClick={() => void start()}
          disabled={running}
          data-testid="download-video">
          <Download size={21} strokeWidth={2.5} /> Download video
        </StickerButton>
      ) : (
        <button
          className="studio-button"
          onClick={() => void start()}
          disabled={running}
          data-testid="download-video">
          <Download size={21} />
          {actionLabel}
        </button>
      )}
      {state.k !== 'idle' && (
        <div
          className="pointer-events-auto fixed bottom-[calc(6rem+var(--sab))] left-1/2 z-50 w-[min(26rem,calc(100vw-2rem-var(--sal)-var(--sar)))] -translate-x-1/2"
          data-testid="export-card"
          role="status">
          <PaperCard className="font-hand text-ink flex flex-col gap-3 !p-5">
            {state.k === 'running' && (
              <>
                <div className="font-scrawl text-2xl leading-none">Making your video</div>
                <div
                  className="border-ink bg-paper-deep h-5 overflow-hidden rounded-full border-[3px]"
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(state.fraction * 100)}
                  data-testid="export-progress">
                  <div
                    className="bg-crayon-yellow border-ink h-full border-r-[3px] transition-[width] duration-150"
                    style={{ width: `${Math.max(4, Math.round(state.fraction * 100))}%` }}
                  />
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-ink-soft text-lg">
                    {PHASE_WORDS[state.phase]}… {Math.round(state.fraction * 100)}%
                  </span>
                  <StickerButton
                    tone="paper"
                    tilt={2}
                    className="!text-lg"
                    onClick={() => abortRef.current?.abort()}
                    data-testid="export-cancel">
                    cancel
                  </StickerButton>
                </div>
              </>
            )}
            {state.k === 'done' && (
              <div className="flex items-center justify-between gap-3">
                <span className="font-scrawl text-xl leading-tight">Your video is in your downloads</span>
                <span className="text-ink-soft text-lg">{state.mb.toFixed(1)} MB</span>
              </div>
            )}
            {state.k === 'kept' && (
              <>
                <div className="flex items-center justify-between gap-3">
                  <span className="font-scrawl text-xl leading-tight" data-testid="export-kept">
                    {state.how === 'saved' ? 'Saved to your Photos' : 'Not saved to Photos yet'}
                  </span>
                  <span className="text-ink-soft text-lg">{state.mb.toFixed(1)} MB</span>
                </div>
                {state.how === 'denied' && (
                  <p className="text-ink-soft text-lg leading-snug">
                    Grown-up: turn on Photos for Squiggletale in Settings, or share the video instead
                  </p>
                )}
                {state.how === 'unsaved' && (
                  <p className="text-ink-soft text-lg leading-snug">Photos said no this time. You can still share it</p>
                )}
                <div className="flex items-center justify-end gap-3">
                  <StickerButton
                    tone={state.how === 'saved' ? 'paper' : 'yellow'}
                    tilt={-2}
                    className="!text-lg"
                    disabled={state.sharing}
                    onClick={() => void share()}
                    data-testid="export-share">
                    {state.sharing ? 'One moment…' : 'Share'}
                  </StickerButton>
                  <StickerButton tone="paper" tilt={2} className="!text-lg" onClick={closeCard}>
                    ok
                  </StickerButton>
                </div>
              </>
            )}
            {state.k === 'error' && (
              <div className="flex items-center justify-between gap-3">
                <span className="text-xl leading-tight">{state.message}</span>
                <StickerButton
                  tone="yellow"
                  tilt={2}
                  className="!text-lg"
                  onClick={() => setState({ k: 'idle' })}>
                  ok
                </StickerButton>
              </div>
            )}
          </PaperCard>
        </div>
      )}
    </>
  )
}
