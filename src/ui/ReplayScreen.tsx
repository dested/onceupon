import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, Mic, Pause, Play, RotateCcw, Share2, Trash2 } from 'lucide-react'
import { ReplaySession } from '~/story/session'
import { appStore, useApp } from '~/story/store'
import { deleteStory, getStory, listStories } from '~/story/storage'
import { IconButton, StickerButton } from './bits'
import { Subtitles } from './Subtitles'
import { Filmstrip } from './Filmstrip'
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
  const story = useMemo(() => {
    const r = getStory(storyId)
    return {
      title: r?.title ?? '',
      hasVoice: r?.voice !== undefined && r.voice.clips.length > 0,
      // Index of the end event: once it has played, the finale owns the page.
      endAt: r ? r.events.findIndex((ev) => ev.k === 'end') : -1,
    }
  }, [storyId])
  const { title, hasVoice } = story

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
  // The finale writes its own "The End" across the page: nothing sits on top of it.
  const inFinale = (story.endAt >= 0 && pos > story.endAt) || /^\W*the end\W*$/i.test(caption)
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
    <div className="story-studio replay-studio" data-testid="replay">
      <header className="studio-header replay-header">
        <div>
          <button
            type="button"
            className="studio-button shelf-button"
            aria-label="Back to my stories"
            onClick={() => appStore.set({ screen: 'shelf', replayId: null })}
            data-testid="replay-back">
            <ArrowLeft size={22} strokeWidth={2.5} />
            <span>My stories</span>
          </button>
        </div>
        <h1 className="replay-title font-scrawl" data-testid="replay-title">
          {title}
        </h1>
        <div className="replay-actions">
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
        </div>
      </header>

      <main className="storybook" aria-label="Your storybook">
        <div className="book-binding" aria-hidden="true">
          <span />
          <span />
          <span />
          <span />
          <span />
        </div>
        <div className="story-paper">
          <canvas ref={canvasRef} className="story-canvas" data-testid="stage" aria-label={title} />
          <div className="replay-filmstrip">
            <Filmstrip embedded />
          </div>
          {hasVoice && caption && !inFinale && (
            <span className="replay-voice" data-testid="voice-indicator">
              <Mic size={14} strokeWidth={2.5} /> in their own voice
            </span>
          )}
          {/* Each line shows once, in the subtitles at the bottom, as it does while telling. */}
          <Subtitles className="story-subtitles" />
        </div>
      </main>

      <footer className="replay-controls" data-testid="scrubber">
        {ended ? (
          <StickerButton tone="yellow" tilt={0} onClick={again} className="shrink-0" data-testid="replay-again">
            <RotateCcw size={22} strokeWidth={3} /> Play again
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
          className="replay-range accent-crayon-red"
        />
      </footer>
    </div>
  )
}
