import { useEffect, useRef, useState } from 'react'
import {
  ArrowRight,
  BookOpen,
  Bug,
  Check,
  ChevronDown,
  Keyboard,
  Mic,
  MoreHorizontal,
  Pause,
  Play,
  Plus,
  Settings,
  Sparkles,
  Star,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react'
import { LiveSession } from '~/story/session'
import { appStore, persistSettings, useApp } from '~/story/store'
import { listStories } from '~/story/storage'
import { Subtitles } from './Subtitles'
import { Filmstrip } from './Filmstrip'
import { SettingsPanel } from './SettingsPanel'
import { KeyGate } from './KeyGate'
import { DebugPanel } from './DebugPanel'
import { SpendChip } from './SpendChip'
import { StoryWelcome } from './StoryWelcome'
import { VideoExportButton } from './VideoExport'

export function StoryScreen() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const sessionRef = useRef<LiveSession | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const confirmRef = useRef<HTMLDialogElement>(null)
  const listening = useApp((s) => s.listening)
  const micStarting = useApp((s) => s.micStarting)
  const status = useApp((s) => s.status)
  const ending = useApp((s) => s.ending)
  const ended = useApp((s) => s.ended)
  const micSupported = useApp((s) => s.micSupported)
  const sound = useApp((s) => s.settings.sound)
  const settingsOpen = useApp((s) => s.settingsOpen)
  const debug = useApp((s) => s.debug)
  const warnings = useApp((s) => s.warnings)
  const note = useApp((s) => s.note)
  const micLevel = useApp((s) => s.micLevel)
  const words = useApp((s) => s.transcriptFinal)
  const interim = useApp((s) => s.transcriptInterim)
  const pages = useApp((s) => s.pages)
  const [typed, setTyped] = useState('')
  const [typing, setTyping] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [pagesOpen, setPagesOpen] = useState(false)
  const hasStory = Boolean(words || interim)
  const finished = ending || ended

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const session = new LiveSession(canvas)
    sessionRef.current = session
    const ro = new ResizeObserver(() => session.resize())
    ro.observe(canvas)
    const onHidden = () => {
      if (document.hidden) {
        session.stopListening()
        session.save()
      }
    }
    document.addEventListener('visibilitychange', onHidden)
    return () => {
      document.removeEventListener('visibilitychange', onHidden)
      ro.disconnect()
      session.destroy()
      sessionRef.current = null
    }
  }, [])
  useEffect(() => {
    sessionRef.current?.setSound(sound)
  }, [sound])
  useEffect(() => {
    if (typing) inputRef.current?.focus()
  }, [typing])
  useEffect(() => {
    if (!menuOpen) return
    const dismiss = (e: PointerEvent) => {
      if (e.target instanceof Node && !menuRef.current?.contains(e.target)) setMenuOpen(false)
    }
    const escape = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('pointerdown', dismiss)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('pointerdown', dismiss)
      document.removeEventListener('keydown', escape)
    }
  }, [menuOpen])

  const toggleMic = () => {
    const session = sessionRef.current
    if (!session) return
    if (listening || micStarting) session.stopListening()
    else {
      setTyping(false)
      void session.startListening()
    }
  }
  const newStory = () => {
    confirmRef.current?.close()
    appStore.set((s) => ({
      storyNonce: s.storyNonce + 1,
      ending: false,
      ended: false,
      transcriptFinal: '',
      transcriptInterim: '',
      drawingWords: '',
      queuedWords: '',
      note: '',
      pages: [],
      lines: [],
      calls: [],
    }))
  }
  const requestNewStory = () => {
    if (hasStory && !ended) confirmRef.current?.showModal()
    else newStory()
  }
  const playAgain = () => {
    const session = sessionRef.current
    if (!session) return
    session.save()
    appStore.set({ screen: 'replay', replayId: session.storyId })
  }
  const openShelf = () => {
    sessionRef.current?.save()
    appStore.set({ screen: 'shelf', stories: listStories() })
  }
  const toggleSound = () => {
    appStore.set((s) => {
      const settings = { ...s.settings, sound: !s.settings.sound }
      persistSettings(settings)
      return { settings }
    })
  }
  const micTitle = micStarting
    ? 'Getting ready…'
    : listening
      ? 'Your story, out loud'
      : hasStory
        ? 'And then what happened?'
        : 'Tap to tell your story'
  const micHint = !micSupported
    ? 'Use the keyboard to tell your story'
    : micStarting
      ? 'Just a little moment'
      : listening
        ? 'I’m listening · tap to pause'
        : hasStory
          ? 'Tap the mic to keep going'
          : 'A little voice. A whole lot of magic.'
  const pageStatus = ended
    ? 'A story only you could tell'
    : ending
      ? 'One last sprinkle of magic…'
      : status === 'thinking'
        ? 'Dreaming up your words…'
        : status === 'drawing'
          ? 'Your words are coming to life'
          : listening
            ? 'Listening to your imagination'
            : hasStory
              ? 'There’s more to your story…'
              : 'A blank page. Endless possibilities.'

  return (
    <div
      className={`story-studio ${hasStory ? 'has-story' : ''} ${listening ? 'is-listening' : ''}`}
      data-testid="story-studio">
      <header className="studio-header">
        <button className="studio-button shelf-button" onClick={openShelf} aria-label="Bookshelf">
          <BookOpen size={23} />
          <span>My stories</span>
        </button>
        <div className="studio-wordmark" aria-label="Once Upon">
          <Star size={17} />
          <span>
            once upon<span className="wordmark-dot">✦</span>
          </span>
        </div>
        <div className="header-actions">
          <button
            className="studio-button new-story-button"
            onClick={requestNewStory}
            aria-label="New story">
            <Plus size={22} />
            <span>New story</span>
          </button>
          <div className="studio-menu-wrap" ref={menuRef}>
            <button
              className="studio-icon"
              onClick={() => setMenuOpen(!menuOpen)}
              aria-label="Story options"
              aria-expanded={menuOpen}
              aria-controls="story-options">
              <MoreHorizontal size={26} />
            </button>
            {menuOpen && (
              <div className="studio-menu" id="story-options">
                <button onClick={toggleSound}>
                  {sound ? <Volume2 size={21} /> : <VolumeX size={21} />}
                  {sound ? 'Sound on' : 'Sound off'}
                  <span className="menu-check">{sound && <Check size={17} />}</span>
                </button>
                <button
                  onClick={() => {
                    sessionRef.current?.stopListening()
                    appStore.set({ settingsOpen: true })
                    setMenuOpen(false)
                  }}>
                  <Settings size={21} />
                  Grown-up settings
                </button>
                {import.meta.env.DEV && (
                  <button
                    onClick={() => {
                      appStore.set((s) => ({ debug: !s.debug }))
                      setMenuOpen(false)
                    }}>
                    <Bug size={21} />
                    Drawing lab
                    {warnings.length > 0 && (
                      <span className="warning-dot" data-testid="warning-dot" />
                    )}
                  </button>
                )}
              </div>
            )}
          </div>
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
          <canvas
            ref={canvasRef}
            className="story-canvas"
            data-testid="stage"
            aria-label="Your words become a crayon drawing"
          />
          <div className="paper-topline">
            <button
              className="page-tab"
              onClick={() => setPagesOpen(!pagesOpen)}
              disabled={pages.length === 0}
              aria-expanded={pagesOpen}
              aria-label={`Page ${pages.length + 1}${pages.length ? ', view earlier pages' : ''}`}>
              <BookOpen size={16} />
              Page {pages.length + 1}
              {pages.length > 0 && <ChevronDown size={15} />}
            </button>
            <span className={`paper-state ${listening || status !== 'idle' ? 'is-active' : ''}`}>
              <span />
              {pageStatus}
            </span>
            <span className="made-by-you">
              <Sparkles size={16} />
              Made by you
            </span>
          </div>
          {pagesOpen && pages.length > 0 && (
            <div className="story-pages">
              <div className="story-pages-heading">
                Your story so far
                <button
                  className="studio-icon"
                  onClick={() => setPagesOpen(false)}
                  aria-label="Close earlier pages">
                  <X size={19} />
                </button>
              </div>
              <Filmstrip embedded />
            </div>
          )}
          {!hasStory && !finished && <StoryWelcome listening={listening || micStarting} />}
          {!hasStory && (
            <>
              <span className="paper-doodle doodle-flower" aria-hidden="true">
                ✳
              </span>
              <span className="paper-doodle doodle-star" aria-hidden="true">
                ✧
              </span>
              <span className="paper-doodle doodle-spark" aria-hidden="true">
                ✦
              </span>
            </>
          )}
          <Subtitles className="story-subtitles" />
          <div className="paper-bottomline" aria-hidden="true">
            <span>every story is a little adventure</span>
            <span>{String(pages.length + 1).padStart(2, '0')}</span>
          </div>
          {note && (
            <div className="story-note" role="status" data-testid="note">
              {note}
            </div>
          )}
        </div>
      </main>

      <footer className="story-controls">
        {finished ? (
          <div className="story-finished" data-testid={ended ? 'the-end-card' : 'story-ending'}>
            <div className="finished-message">
              <Star size={28} />
              <div>
                <strong>{ended ? 'Look what you imagined!' : 'A lovely ending…'}</strong>
                <span>
                  {ended
                    ? 'Your story is tucked away in My stories'
                    : 'The crayon is finishing your story'}
                </span>
              </div>
            </div>
            {ended && (
              <div className="finished-actions">
                <button className="studio-button replay-button" onClick={playAgain}>
                  <Play size={21} fill="currentColor" />
                  Play it again
                </button>
                <VideoExportButton
                  variant="studio"
                  getStoryId={() => {
                    const session = sessionRef.current
                    if (!session) return null
                    session.save()
                    return session.storyId
                  }}
                />
                <button className="studio-button" onClick={newStory}>
                  <Plus size={21} />
                  New story
                </button>
              </div>
            )}
          </div>
        ) : (
          <>
            <div className="end-reminder">
              <Star size={19} />
              <span>
                All done? Just say
                <br />
                <strong>“The End”</strong>
              </span>
            </div>
            <div className="mic-dock">
              <button
                onClick={toggleMic}
                disabled={!micSupported}
                aria-label={
                  listening
                    ? 'Stop listening'
                    : micStarting
                      ? 'Cancel microphone'
                      : 'Start listening'
                }
                aria-pressed={listening}
                data-testid="mic"
                className={`story-mic ${micStarting ? 'mic-starting' : ''}`}>
                <span className="mic-ring" aria-hidden="true" />
                {listening ? (
                  <Pause size={34} strokeWidth={2.6} fill="currentColor" />
                ) : (
                  <Mic size={37} strokeWidth={2.3} />
                )}
              </button>
              <div className="mic-copy">
                <strong data-testid="status">{micTitle}</strong>
                <span>{micHint}</span>
                {listening && (
                  <div className="voice-wave" aria-label="Microphone level" data-testid="mic-level">
                    {[0.4, 0.7, 1, 0.6, 0.85, 0.5, 0.9, 0.65, 0.35].map((height, i) => (
                      <i key={i} style={{ height: `${4 + height * micLevel * 19}px` }} />
                    ))}
                  </div>
                )}
              </div>
            </div>
            <button
              className={`studio-button keyboard-button ${typing ? 'is-selected' : ''}`}
              onClick={() => setTyping(!typing)}
              aria-expanded={typing}
              aria-controls="story-type-form"
              aria-label={typing ? 'Close keyboard' : 'Type a story'}>
              <Keyboard size={24} />
              <span>Or type</span>
            </button>
            {typing && (
              <form
                id="story-type-form"
                className="story-type-form"
                onSubmit={(e) => {
                  e.preventDefault()
                  if (typed.trim()) {
                    sessionRef.current?.typeWords(typed.trim())
                    setTyped('')
                  }
                }}>
                <label htmlFor="story-words">What happens in your story?</label>
                <div>
                  <input
                    id="story-words"
                    ref={inputRef}
                    value={typed}
                    onChange={(e) => setTyped(e.target.value)}
                    placeholder="Once upon a time…"
                    data-testid="typed"
                    autoComplete="off"
                    onKeyDown={(e) => {
                      if (e.key === 'Escape') setTyping(false)
                    }}
                  />
                  <button type="submit" aria-label="Draw these words" disabled={!typed.trim()}>
                    <ArrowRight size={23} />
                  </button>
                  <button
                    type="button"
                    className="type-close"
                    onClick={() => setTyping(false)}
                    aria-label="Close keyboard">
                    <X size={21} />
                  </button>
                </div>
              </form>
            )}
          </>
        )}
      </footer>

      <dialog ref={confirmRef} className="new-story-dialog" aria-labelledby="new-story-heading">
        <BookOpen size={38} />
        <h2 id="new-story-heading">A whole new adventure?</h2>
        <p>
          This story will stay safe in My stories.
          <br />
          You can watch it again anytime.
        </p>
        <div>
          <button className="studio-button" autoFocus onClick={() => confirmRef.current?.close()}>
            Keep telling this one
          </button>
          <button className="studio-button replay-button" onClick={newStory}>
            <Plus size={20} />
            New story
          </button>
        </div>
      </dialog>
      {settingsOpen && <SettingsPanel />}
      <KeyGate />
      {import.meta.env.DEV && debug && (
        <>
          <DebugPanel />
          <SpendChip />
        </>
      )}
    </div>
  )
}
