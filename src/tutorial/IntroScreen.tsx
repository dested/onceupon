import { useCallback, useEffect, useRef, useState, type PointerEvent } from 'react'
import { ChevronLeft, Volume2, X } from 'lucide-react'
import { Scene } from '~/engine/scene'
import { Stage } from '~/engine/stage'
import { Director } from '~/llm/director'
import { makeDialect } from '~/llm/dialect'
import { Replayer } from '~/story/replay'
import { parseStoryRecord, setKv, type StoryRecord } from '~/story/storage'
import { IconButton, StickerButton } from '~/ui/bits'
import { INTRO_SLIDES, playIntroVoice, stopIntroVoice } from './intro'
import introRecords from './intro-slides.json'
import './intro.css'

interface Run {
  stage: Stage
  replayer: Replayer
  disposed: boolean
}

const RECORDS: readonly (StoryRecord | null)[] = Array.isArray(introRecords)
  ? introRecords.map((r: unknown) => parseStoryRecord(r))
  : []

// A swipe must travel this far sideways (and more sideways than down) to turn the page.
const SWIPE_PX = 60

/**
 * First-launch intro: a few picture-book pages, each drawn live by the real engine from a pre-authored
 * story (scripts/author-intro.ts) while a warm voice reads the page (src/tutorial/intro.ts). The child
 * pages through with Next / swipe and lands on the story screen. Seen once; replayable from the menu.
 */
export function Intro({ onDone }: { onDone: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const runRef = useRef<Run | null>(null)
  const swipeRef = useRef<{ x: number; y: number } | null>(null)
  const [index, setIndex] = useState(0)
  const [spoken, setSpoken] = useState('')
  const [drawn, setDrawn] = useState(false)
  const [voice, setVoice] = useState<'playing' | 'done' | 'blocked'>('playing')

  const slide = INTRO_SLIDES[index]
  const last = index === INTRO_SLIDES.length - 1

  const disposeRun = (): void => {
    const run = runRef.current
    if (!run) return
    run.disposed = true
    run.replayer.stop()
    run.stage.stop()
    runRef.current = null
  }

  const speak = useCallback((src: string): void => {
    setVoice('playing')
    void playIntroVoice(src).then((r) => {
      if (r === 'played') setVoice('done')
      else if (r === 'blocked') setVoice('blocked')
    })
  }, [])

  // Each page: a fresh stage on the same canvas, the demo story replayed onto it, the voice line read.
  useEffect(() => {
    const canvas = canvasRef.current
    const record = RECORDS[index]
    const copy = INTRO_SLIDES[index]
    if (!canvas || !copy) return
    disposeRun()
    setSpoken('')
    setDrawn(false)
    speak(copy.voiceSrc)
    if (!record) {
      setDrawn(true)
      return
    }
    const scene = new Scene()
    const stage = new Stage(canvas, { seed: record.seed, audio: null })
    stage.onPageSnapshot = () => undefined
    const director = new Director({
      scene,
      stage,
      dialect: makeDialect('ops', scene, { moderation: true }),
      getProvider: () => null,
      onEvent: () => undefined,
    })
    stage.start()
    const run: Run = {
      stage,
      disposed: false,
      replayer: new Replayer(record, director, {
        onWords: (_final, chunk) => {
          if (!run.disposed) setSpoken(chunk)
        },
        onProgress: () => undefined,
        onEnd: (seed) => void stage.finale(seed),
        onDone: () => {
          if (!run.disposed) setDrawn(true)
        },
      }),
    }
    runRef.current = run
    run.replayer.play()
    return disposeRun
  }, [index, speak])

  useEffect(() => {
    const onResize = (): void => runRef.current?.stage.resize()
    window.addEventListener('resize', onResize)
    return () => {
      window.removeEventListener('resize', onResize)
      stopIntroVoice()
      disposeRun()
    }
  }, [])

  const finish = (): void => {
    stopIntroVoice()
    void setKv('tutorialDone', '1')
    onDone()
  }

  const go = (to: number): void => {
    if (to < 0) return
    if (to >= INTRO_SLIDES.length) {
      finish()
      return
    }
    setIndex(to)
  }

  const onPointerDown = (e: PointerEvent<HTMLElement>): void => {
    swipeRef.current = { x: e.clientX, y: e.clientY }
  }
  const onPointerUp = (e: PointerEvent<HTMLElement>): void => {
    const start = swipeRef.current
    swipeRef.current = null
    if (!start) return
    const dx = e.clientX - start.x
    const dy = e.clientY - start.y
    if (Math.abs(dx) < SWIPE_PX || Math.abs(dx) < Math.abs(dy)) return
    go(dx < 0 ? index + 1 : index - 1)
  }

  if (!slide) return null
  const ready = drawn && voice !== 'playing'

  return (
    <div className="story-studio intro fixed inset-0 z-50" data-testid="intro">
      <header className="intro-header">
        <IconButton
          label="Hear it again"
          onClick={() => speak(slide.voiceSrc)}
          active={voice === 'blocked'}
          data-testid="intro-hear">
          <Volume2 size={22} strokeWidth={3} />
        </IconButton>
        <h2 className="intro-title" key={`t${index}`}>
          {slide.title}
        </h2>
        <IconButton label="Skip" onClick={finish} data-testid="intro-skip">
          <X size={22} strokeWidth={3} />
        </IconButton>
      </header>

      <main
        className="storybook"
        aria-label="How Squiggletale works"
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerCancel={() => (swipeRef.current = null)}>
        <div className="book-binding" aria-hidden="true">
          <span />
          <span />
          <span />
          <span />
          <span />
        </div>
        <div className="story-paper">
          <canvas ref={canvasRef} className="story-canvas" data-testid="intro-stage" />
          {spoken && (
            <div className="intro-spoken" key={spoken}>
              <p>“{spoken}”</p>
            </div>
          )}
        </div>
      </main>

      <footer className="story-controls intro-controls">
        <div className="intro-nav">
          <IconButton
            label="Back"
            onClick={() => go(index - 1)}
            disabled={index === 0}
            className={index === 0 ? 'invisible' : ''}
            data-testid="intro-back">
            <ChevronLeft size={24} strokeWidth={3} />
          </IconButton>
          <div className="intro-dots" aria-label={`Page ${index + 1} of ${INTRO_SLIDES.length}`}>
            {INTRO_SLIDES.map((s, i) => (
              <button
                key={s.title}
                type="button"
                aria-label={`Page ${i + 1}`}
                className={i === index ? 'is-on' : ''}
                onClick={() => go(i)}
              />
            ))}
          </div>
          <StickerButton
            tone={last ? 'green' : 'yellow'}
            tilt={last ? -3 : -2}
            className={`intro-next ${ready ? 'is-ready' : ''}`}
            onClick={() => go(index + 1)}
            data-testid={last ? 'intro-done' : 'intro-next'}>
            {last ? 'Okay, let’s go!' : 'Next'}
          </StickerButton>
        </div>
      </footer>
    </div>
  )
}
