import { useEffect, useRef } from 'react'
import { ArrowLeft, RotateCcw } from 'lucide-react'
import { ReplaySession } from '~/story/session'
import { appStore, useApp } from '~/story/store'
import { IconButton, StickerButton } from './bits'
import { Subtitles } from './Subtitles'
import { Filmstrip } from './Filmstrip'

export function ReplayScreen({ storyId }: { storyId: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const sessionRef = useRef<ReplaySession | null>(null)
  const playing = useApp((s) => s.replayPlaying)
  const caption = useApp((s) => s.replayCaption)

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
    appStore.set((s) => ({ replayId: null, storyNonce: s.storyNonce }))
    // Remount with the same id on the next tick so the canvas starts clean.
    window.setTimeout(() => appStore.set({ replayId: storyId }), 0)
  }

  return (
    <div className="relative h-full w-full select-none" data-testid="replay">
      <canvas ref={canvasRef} className="block h-full w-full" />
      <Filmstrip />
      <div className="absolute top-4 right-4 flex gap-3">
        <IconButton label="Back to bookshelf" onClick={() => appStore.set({ screen: 'shelf', replayId: null })}>
          <ArrowLeft size={24} strokeWidth={3} />
        </IconButton>
      </div>
      {caption && (
        <div className="pointer-events-none absolute top-24 right-0 left-0 flex justify-center px-10" data-testid="narration">
          <p
            key={caption}
            className="max-w-3xl rounded-2xl bg-paper/90 px-6 py-2 text-center font-scrawl text-2xl leading-snug text-ink shadow-[3px_4px_0_0_rgba(59,47,47,0.25)]">
            {caption}
          </p>
        </div>
      )}
      <Subtitles className="bottom-7 left-6 right-6 h-11" />
      <div className="absolute bottom-24 left-1/2 -translate-x-1/2">
        {!playing && (
          <StickerButton tone="yellow" onClick={again}>
            <RotateCcw size={22} strokeWidth={3} /> play again
          </StickerButton>
        )}
        {playing && <div className="font-hand text-xl text-ink-soft">once upon a time...</div>}
      </div>
    </div>
  )
}
