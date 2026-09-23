import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, Mic, Pause, Play, RotateCcw, Share2, Trash2 } from 'lucide-react'
import { ReplaySession } from '~/story/session'
import { appStore, useApp } from '~/story/store'
import { deleteStory, getStory, listStories } from '~/story/storage'
import { IconButton, StickerButton } from './bits'
import { Subtitles } from './Subtitles'
import { Filmstrip } from './Filmstrip'
import { VideoExportButton } from './VideoExport'
import { gate } from './hosted'
import { openShareCard } from './ShareCard'

export function ReplayScreen({ storyId }: { storyId: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const sessionRef = useRef<ReplaySession | null>(null)
  const hosted = useApp((s) => s.hosted)
  const playing = useApp((s) => s.replayPlaying)
  const caption = useApp((s) => s.replayCaption)
  const pos = useApp((s) => s.replayPos)
  const len = useApp((s) => s.replayLen)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const hasVoice = useMemo(() => {
    const r = getStory(storyId)
    return r?.voice !== undefined && r.voice.clips.length > 0
  }, [storyId])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const session = new ReplaySession(canvas, storyId)
    sessionRef.current = session
    const ro = new ResizeObserver(() => session.resize())
    ro.observe(canvas)
    session.play()
    return () => {
      ro.disconnect()
      session.destroy()
      sessionRef.current = null
    }
  }, [storyId])

  const again = (): void => {
    const s = sessionRef.current
    if (!s) return
    appStore.set({ replayPlaying: true })
    s.seek(0)
  }
  const ended = len > 0 && pos >= len
  const remove = (): void => {
    if (!confirmDelete) {
      setConfirmDelete(true)
      return
    }
    sessionRef.current?.pause()
    deleteStory(storyId)
    appStore.set({ screen: 'shelf', replayId: null, stories: listStories() })
  }

  return (
    <div className="relative h-full w-full select-none" data-testid="replay">
      <canvas ref={canvasRef} className="block h-full w-full" />
      <Filmstrip />
      <div className="absolute top-[calc(1rem+var(--sat))] right-[calc(1rem+var(--sar))] flex items-center gap-3">
        {confirmDelete ? (
          <StickerButton tilt={0} tone="red" className="!text-base" onClick={remove} onBlur={() => setConfirmDelete(false)} data-testid="delete-story">
            <Trash2 size={18} strokeWidth={2.5} /> delete this story?
          </StickerButton>
        ) : (
          <IconButton label="Delete this story" onClick={remove} data-testid="delete-story">
            <Trash2 size={22} strokeWidth={2.5} />
          </IconButton>
        )}
        {hosted && (
          <IconButton
            label="Share this story"
            data-testid="share-story"
            onClick={() => void gate().then((ok) => ok && openShareCard(storyId))}>
            <Share2 size={22} strokeWidth={2.5} />
          </IconButton>
        )}
        <VideoExportButton variant="icon" getRecord={() => getStory(storyId)} />
        <IconButton label="Back to bookshelf" onClick={() => appStore.set({ screen: 'shelf', replayId: null })}>
          <ArrowLeft size={24} strokeWidth={3} />
        </IconButton>
      </div>
      {caption && (
        <div className="pointer-events-none absolute top-[calc(8.5rem+var(--sat))] right-[var(--sar)] left-[var(--sal)] flex flex-col items-center gap-2 px-10" data-testid="narration">
          <p
            key={caption}
            className="max-w-3xl rounded-2xl bg-paper/90 px-6 py-2 text-center font-scrawl text-2xl leading-snug text-ink shadow-[3px_4px_0_0_rgba(59,47,47,0.25)]">
            {caption}
          </p>
          {hasVoice && (
            <span
              className="inline-flex items-center gap-1 rounded-full bg-paper/90 px-3 py-1 font-hand text-[16px] text-ink-soft shadow-[2px_3px_0_0_rgba(59,47,47,0.2)]"
              data-testid="voice-indicator">
              <Mic size={14} strokeWidth={2.5} /> in their own voice
            </span>
          )}
        </div>
      )}
      <Subtitles className="bottom-[calc(6rem+var(--sab))] left-[calc(1.5rem+var(--sal))] right-[calc(1.5rem+var(--sar))] h-11" />
      <div className="absolute right-[calc(1.5rem+var(--sar))] bottom-[calc(1.5rem+var(--sab))] left-[calc(1.5rem+var(--sal))] flex items-center gap-4" data-testid="scrubber">
        {ended ? (
          <StickerButton tone="yellow" tilt={0} onClick={again} className="shrink-0">
            <RotateCcw size={22} strokeWidth={3} /> again
          </StickerButton>
        ) : (
          <IconButton
            label={playing ? 'Pause' : 'Play'}
            active={playing}
            className="shrink-0"
            onClick={() => (playing ? sessionRef.current?.pause() : sessionRef.current?.resume())}>
            {playing ? <Pause size={22} strokeWidth={3} /> : <Play size={22} strokeWidth={3} />}
          </IconButton>
        )}
        <input
          type="range"
          aria-label="Story position"
          min={0}
          max={Math.max(1, len)}
          step={1}
          value={Math.min(pos, len)}
          onChange={(e) => sessionRef.current?.seek(Number(e.target.value))}
          className="h-3 w-full cursor-pointer accent-crayon-red"
        />
        <span className="w-16 shrink-0 text-right font-hand text-base text-ink-soft">
          {Math.min(pos, len)}/{len}
        </span>
      </div>
    </div>
  )
}
