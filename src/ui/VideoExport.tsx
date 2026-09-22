import { useEffect, useRef, useState } from 'react'
import { Download } from 'lucide-react'
import { exportStoryVideo, ExportUnsupportedError, videoFileName } from '~/export/mp4'
import { getStory } from '~/story/storage'
import { appStore } from '~/story/store'
import { IconButton, PaperCard, StickerButton } from './bits'

type ExportState =
  | { k: 'idle' }
  | { k: 'running'; fraction: number; phase: 'frames' | 'audio' | 'mux' }
  | { k: 'done'; mb: number }
  | { k: 'error'; message: string }

const PHASE_WORDS = {
  frames: 'drawing every page',
  audio: 'adding the crayon sounds',
  mux: 'wrapping it up',
} as const

function download(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.append(a)
  a.click()
  a.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

/**
 * "Download video": renders the saved story to an .mp4 in the browser and hands it to the
 * browser's downloads. `icon` sits in the replay toolbar; `studio` is the closing card's button.
 */
export function VideoExportButton({
  getStoryId,
  variant,
}: {
  /** Called on click; save first if the story is live. */
  getStoryId: () => string | null
  variant: 'icon' | 'studio'
}) {
  const [state, setState] = useState<ExportState>({ k: 'idle' })
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => () => abortRef.current?.abort(), [])
  useEffect(() => {
    if (state.k !== 'done') return
    const t = window.setTimeout(() => setState({ k: 'idle' }), 3000)
    return () => window.clearTimeout(t)
  }, [state.k])

  const start = async (): Promise<void> => {
    if (state.k === 'running') return
    const id = getStoryId()
    const record = id ? getStory(id) : null
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
      download(res.blob, videoFileName(record.title))
      setState({ k: 'done', mb: res.blob.size / 1e6 })
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

  const running = state.k === 'running'
  return (
    <>
      {variant === 'icon' ? (
        <IconButton
          label="Download video"
          onClick={() => void start()}
          disabled={running}
          data-testid="download-video">
          <Download size={22} strokeWidth={2.5} />
        </IconButton>
      ) : (
        <button
          className="studio-button"
          onClick={() => void start()}
          disabled={running}
          data-testid="download-video">
          <Download size={21} />
          Download video
        </button>
      )}
      {state.k !== 'idle' && (
        <div
          className="pointer-events-auto fixed bottom-24 left-1/2 z-50 w-[min(26rem,calc(100vw-2rem))] -translate-x-1/2"
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
                <span className="font-scrawl text-xl leading-tight">
                  Your video is in your downloads
                </span>
                <span className="text-ink-soft text-lg">{state.mb.toFixed(1)} MB</span>
              </div>
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
