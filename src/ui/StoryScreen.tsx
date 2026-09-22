import { useEffect, useRef, useState } from 'react'
import { BookOpen, Bug, Mic, MicOff, Plus, Settings, Volume2, VolumeX } from 'lucide-react'
import { LiveSession } from '~/story/session'
import { appStore, persistSettings, useApp } from '~/story/store'
import { listStories } from '~/story/storage'
import { IconButton, PaperCard, StickerButton } from './bits'
import { Subtitles } from './Subtitles'
import { Filmstrip } from './Filmstrip'
import { SettingsPanel } from './SettingsPanel'
import { KeyGate } from './KeyGate'
import { DebugPanel } from './DebugPanel'
import { SpendChip } from './SpendChip'

export function StoryScreen() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const sessionRef = useRef<LiveSession | null>(null)
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
  const [typed, setTyped] = useState('')

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const session = new LiveSession(canvas)
    sessionRef.current = session
    const ro = new ResizeObserver(() => session.resize())
    ro.observe(canvas)
    return () => {
      ro.disconnect()
      session.destroy()
      sessionRef.current = null
    }
  }, [])

  useEffect(() => {
    sessionRef.current?.setSound(sound)
  }, [sound])

  const toggleMic = (): void => {
    const s = sessionRef.current
    if (!s) return
    if (listening || micStarting) s.stopListening()
    else void s.startListening()
  }

  const submitTyped = (): void => {
    const t = typed.trim()
    if (!t) return
    sessionRef.current?.typeWords(t)
    setTyped('')
  }

  const newStory = (): void => {
    appStore.set((s) => ({
      storyNonce: s.storyNonce + 1,
      ending: false,
      ended: false,
      transcriptFinal: '',
      transcriptInterim: '',
      pages: [],
      lines: [],
      calls: [],
    }))
  }

  const playAgain = (): void => {
    const s = sessionRef.current
    if (!s) return
    s.save()
    appStore.set({ screen: 'replay', replayId: s.storyId })
  }

  const openShelf = (): void => {
    sessionRef.current?.save()
    appStore.set({ screen: 'shelf', stories: listStories() })
  }

  const toggleSound = (): void => {
    appStore.set((s) => {
      const settings = { ...s.settings, sound: !s.settings.sound }
      persistSettings(settings)
      return { settings }
    })
  }

  const lastWarning = warnings[warnings.length - 1]

  return (
    <div className="relative h-full w-full select-none">
      <canvas ref={canvasRef} className="block h-full w-full" data-testid="stage" />

      <Filmstrip />

      <div className="absolute top-4 right-4 flex gap-3">
        <IconButton label="New story" onClick={newStory}>
          <Plus size={24} strokeWidth={3} />
        </IconButton>
        <IconButton label="Bookshelf" onClick={openShelf}>
          <BookOpen size={24} strokeWidth={2.5} />
        </IconButton>
        <IconButton label={sound ? 'Sound on' : 'Sound off'} onClick={toggleSound} active={sound}>
          {sound ? (
            <Volume2 size={22} strokeWidth={2.5} />
          ) : (
            <VolumeX size={22} strokeWidth={2.5} />
          )}
        </IconButton>
        <IconButton label="Settings" onClick={() => appStore.set({ settingsOpen: true })}>
          <Settings size={22} strokeWidth={2.5} />
        </IconButton>
        <IconButton
          label="Debug"
          onClick={() => appStore.set((s) => ({ debug: !s.debug }))}
          active={debug}
          className="relative">
          <Bug size={22} strokeWidth={2.5} />
          {lastWarning && !debug && (
            <span
              className="border-paper bg-crayon-red absolute -top-1 -right-1 h-3 w-3 rounded-full border-2"
              title={lastWarning}
              data-testid="warning-dot"
            />
          )}
        </IconButton>
      </div>

      <SpendChip />

      <Subtitles className="right-76 bottom-7 left-36 h-11" />

      <div className="absolute bottom-4 left-6 flex flex-col items-center gap-2">
        {!(ending || ended) && (
          <button
            onClick={toggleMic}
            disabled={!micSupported}
            aria-label={listening ? 'Stop listening' : 'Start listening'}
            data-testid="mic"
            className={`border-ink relative grid h-24 w-24 place-items-center rounded-full border-[4px] shadow-[4px_6px_0_0_rgba(59,47,47,0.35)] transition active:translate-y-[3px] disabled:opacity-40 ${listening ? 'bg-crayon-red text-white' : micStarting ? 'bg-paper-deep text-ink-soft' : 'bg-crayon-yellow text-ink'}`}>
            {listening && (
              <span className="border-crayon-red absolute inset-[-10px] animate-ping rounded-full border-[3px] opacity-60" />
            )}
            {listening || micStarting ? (
              <Mic size={44} strokeWidth={2.5} />
            ) : (
              <MicOff size={44} strokeWidth={2.5} />
            )}
          </button>
        )}
        <div className="font-hand text-ink-soft text-base" data-testid="status">
          {ending || ended
            ? 'the end!'
            : !micSupported
              ? 'needs Chrome for the microphone'
              : micStarting
                ? 'one sec...'
                : listening
                  ? status === 'thinking'
                    ? 'thinking about the yellow bit...'
                    : status === 'drawing'
                      ? 'drawing the yellow bit! keep going'
                      : 'listening... keep talking'
                  : 'tap to tell a story'}
        </div>
        {listening && (
          <div
            className="bg-ink/15 h-1.5 w-24 overflow-hidden rounded-full"
            data-testid="mic-level">
            <div
              className="bg-crayon-green h-full rounded-full transition-[width] duration-75"
              style={{ width: `${Math.round(micLevel * 100)}%` }}
            />
          </div>
        )}
      </div>

      {!(ending || ended) && (
        <form
          className="absolute right-4 bottom-6 flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            submitTyped()
          }}>
          <input
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder="or type a sentence..."
            data-testid="typed"
            className="border-ink bg-paper font-hand text-ink placeholder:text-ink-soft w-64 rounded-xl border-[3px] px-3 py-2 text-lg outline-none focus:bg-white"
          />
        </form>
      )}

      {ended && (
        <div className="absolute bottom-8 left-1/2 -translate-x-1/2" data-testid="the-end-card">
          <PaperCard className="flex flex-col items-center gap-3 !p-5">
            <div className="font-scrawl text-3xl leading-none">the end</div>
            <div className="flex items-center gap-3">
              <StickerButton tone="green" tilt={-2} onClick={playAgain}>
                play it again
              </StickerButton>
              <StickerButton tone="yellow" tilt={2} onClick={newStory}>
                new story
              </StickerButton>
            </div>
          </PaperCard>
        </div>
      )}

      {note && (
        <div
          className="bg-paper/90 font-hand text-ink-soft pointer-events-none absolute bottom-8 left-1/2 -translate-x-1/2 rounded-xl px-4 py-1 text-lg"
          data-testid="note">
          {note}
        </div>
      )}

      {settingsOpen && <SettingsPanel />}
      <KeyGate />
      {debug && <DebugPanel />}
    </div>
  )
}
