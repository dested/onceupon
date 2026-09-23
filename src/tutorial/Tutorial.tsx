import { useEffect, useRef, useState } from 'react'
import { Volume2, X } from 'lucide-react'
import { Scene } from '~/engine/scene'
import { Stage } from '~/engine/stage'
import { Director } from '~/llm/director'
import { makeDialect } from '~/llm/dialect'
import { Replayer } from '~/story/replay'
import { parseStoryRecord, setKv, type StoryRecord } from '~/story/storage'
import { IconButton, PaperCard, StickerButton } from '~/ui/bits'
import { COACH_LINES, playCoachLine } from './coach'
import { CUES } from './cues'
import tutorialRecord from './tutorial-record.json'

type CoachLine = 1 | 2 | 3 | 4

interface Run {
  stage: Stage
  replayer: Replayer | null
  timers: number[]
  disposed: boolean
  cmdSeen: boolean
  wordsSeen: number
}

function holdFor(kind: 'start' | 'wordsIndex' | 'end'): number {
  return CUES.find((c) => c.at.kind === kind)?.holdMs ?? 0
}

/**
 * First-launch tutorial: the bundled dragon story replayed inside the studio book while a warm coach
 * voice narrates four lines cued to the drawing. A fake, non-interactive mic dock shows the child what
 * the real screen looks like. The whole thing is a demo; the child then taps "Tell my story".
 */
export function Tutorial({ onDone }: { onDone: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const runRef = useRef<Run | null>(null)
  const [phase, setPhase] = useState<'intro' | 'playing' | 'done'>('intro')
  const [coachLine, setCoachLine] = useState<CoachLine | null>(null)
  const [caption, setCaption] = useState('')
  const [pulse, setPulse] = useState(false)

  useEffect(
    () => () => {
      const run = runRef.current
      if (!run) return
      run.disposed = true
      for (const t of run.timers) window.clearTimeout(t)
      run.replayer?.stop()
      run.stage.stop()
    },
    []
  )

  const finishTutorial = (): void => {
    void setKv('tutorialDone', '1')
    onDone()
  }

  const onProgress = (i: number, record: StoryRecord): void => {
    const run = runRef.current
    if (!run || run.disposed) return
    const ev = record.events[i - 1]
    if (!ev) return
    if (ev.k === 'cmd' && !run.cmdSeen) {
      run.cmdSeen = true
      setCoachLine(2)
      void playCoachLine(2)
    } else if (ev.k === 'words') {
      run.wordsSeen++
      if (run.wordsSeen === 2) {
        run.replayer?.stop()
        setCoachLine(3)
        void playCoachLine(3)
        const t = window.setTimeout(() => {
          if (!run.disposed) run.replayer?.play()
        }, holdFor('wordsIndex'))
        run.timers.push(t)
      }
    } else if (ev.k === 'end') {
      setCoachLine(4)
      void playCoachLine(4)
    }
  }

  const begin = (): void => {
    const canvas = canvasRef.current
    if (!canvas || runRef.current) return
    const record = parseStoryRecord(tutorialRecord)
    if (!record) {
      finishTutorial()
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
    const run: Run = { stage, replayer: null, timers: [], disposed: false, cmdSeen: false, wordsSeen: 0 }
    runRef.current = run
    const replayer = new Replayer(record, director, {
      onWords: (_final, chunk) => {
        if (!run.disposed) setCaption(chunk)
      },
      onProgress: (idx) => onProgress(idx, record),
      onEnd: (seed) => void stage.finale(seed),
      onDone: () => {
        if (!run.disposed) setPhase('done')
      },
    })
    run.replayer = replayer

    setPhase('playing')
    setPulse(true)
    setCoachLine(1)
    void playCoachLine(1)
    const t = window.setTimeout(() => {
      if (run.disposed) return
      setPulse(false)
      replayer.play()
    }, holdFor('start'))
    run.timers.push(t)
  }

  return (
    <div className={`story-studio ${pulse ? 'is-listening' : ''} fixed inset-0 z-50`} data-testid="tutorial">
      <header className="studio-header">
        <div className="studio-wordmark" aria-label="Squiggletale">
          <span>
            squiggletale<span className="wordmark-dot">✦</span>
          </span>
        </div>
        <div className="header-actions">
          <IconButton label="Skip the tutorial" onClick={finishTutorial} data-testid="tutorial-skip">
            <X size={22} strokeWidth={3} />
          </IconButton>
        </div>
      </header>

      <main className="storybook" aria-label="Tutorial storybook">
        <div className="book-binding" aria-hidden="true">
          <span />
          <span />
          <span />
          <span />
          <span />
        </div>
        <div className="story-paper">
          <canvas ref={canvasRef} className="story-canvas" data-testid="tutorial-stage" />

          {phase === 'playing' && caption && (
            <div className="pointer-events-none absolute top-6 right-0 left-0 flex justify-center px-8">
              <p
                key={caption}
                className="max-w-2xl rounded-2xl bg-paper/90 px-5 py-2 text-center font-scrawl text-2xl leading-snug text-ink shadow-[3px_4px_0_0_rgba(59,47,47,0.25)]">
                {caption}
              </p>
            </div>
          )}

          {phase === 'intro' && (
            <div className="pointer-events-none absolute inset-0 grid place-items-center px-8">
              <PaperCard className="pointer-events-auto flex flex-col items-center gap-4 text-center">
                <span className="font-scrawl text-3xl text-ink">Let's tell a story</span>
                <StickerButton tone="yellow" tilt={-2} onClick={begin} data-testid="tutorial-start">
                  Let's go
                </StickerButton>
              </PaperCard>
            </div>
          )}

          {phase === 'done' && (
            <div className="pointer-events-none absolute inset-0 grid place-items-center px-8">
              <PaperCard className="pointer-events-auto flex flex-col items-center gap-4 text-center">
                <span className="font-scrawl text-3xl text-ink">Your turn!</span>
                <StickerButton
                  tone="green"
                  tilt={-2}
                  onClick={finishTutorial}
                  data-testid="tutorial-done">
                  Tell my story
                </StickerButton>
              </PaperCard>
            </div>
          )}

          {phase === 'playing' && coachLine && (
            <div className="pointer-events-none absolute right-0 bottom-6 left-0 flex justify-center px-8">
              <PaperCard className="!py-3 flex max-w-xl items-center gap-3 !px-5">
                <Volume2 size={22} strokeWidth={2.5} style={{ color: '#d9937e' }} aria-hidden="true" />
                <span className="font-scrawl text-ink" style={{ fontSize: 26, lineHeight: 1.2 }}>
                  {COACH_LINES[coachLine - 1]}
                </span>
              </PaperCard>
            </div>
          )}
        </div>
      </main>

      <footer className="story-controls">
        <div className="mic-dock">
          <div className="story-mic" aria-hidden="true" style={{ pointerEvents: 'none' }}>
            <span className="mic-ring" aria-hidden="true" />
            <svg width="37" height="37" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
              <path d="M19 10v1a7 7 0 0 1-14 0v-1M12 18v4" />
            </svg>
          </div>
          <div className="mic-copy">
            <strong>Watch how it works</strong>
            <span>Your voice becomes a drawing</span>
          </div>
        </div>
      </footer>
    </div>
  )
}
