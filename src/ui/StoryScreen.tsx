import { useEffect, useRef, useState } from 'react'
import { BookOpen, Bug, Mic, MicOff, Plus, Settings, Volume2, VolumeX } from 'lucide-react'
import { LiveSession } from '~/story/session'
import { appStore, persistSettings, useApp } from '~/story/store'
import { listStories } from '~/story/storage'
import { IconButton } from './bits'
import { Subtitles } from './Subtitles'
import { Filmstrip } from './Filmstrip'
import { SettingsPanel } from './SettingsPanel'
import { DebugPanel } from './DebugPanel'
import { SpendChip } from './SpendChip'

export function StoryScreen() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const sessionRef = useRef<LiveSession | null>(null)
  const listening = useApp((s) => s.listening)
  const micStarting = useApp((s) => s.micStarting)
  const status = useApp((s) => s.status)
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
    appStore.set((s) => ({ storyNonce: s.storyNonce + 1, transcriptFinal: '', transcriptInterim: '', pages: [], lines: [], calls: [] }))
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
          {sound ? <Volume2 size={22} strokeWidth={2.5} /> : <VolumeX size={22} strokeWidth={2.5} />}
        </IconButton>
        <IconButton label="Settings" onClick={() => appStore.set({ settingsOpen: true })}>
          <Settings size={22} strokeWidth={2.5} />
        </IconButton>
        <IconButton label="Debug" onClick={() => appStore.set((s) => ({ debug: !s.debug }))} active={debug}>
          <Bug size={22} strokeWidth={2.5} />
        </IconButton>
      </div>

      <SpendChip />

      <Subtitles className="bottom-7 left-36 right-76 h-11" />

      <div className="absolute bottom-4 left-6 flex flex-col items-center gap-2">
        <button
          onClick={toggleMic}
          disabled={!micSupported}
          aria-label={listening ? 'Stop listening' : 'Start listening'}
          data-testid="mic"
          className={`relative grid h-24 w-24 place-items-center rounded-full border-[4px] border-ink shadow-[4px_6px_0_0_rgba(59,47,47,0.35)] transition active:translate-y-[3px] disabled:opacity-40 ${listening ? 'bg-crayon-red text-white' : micStarting ? 'bg-paper-deep text-ink-soft' : 'bg-crayon-yellow text-ink'}`}>
          {listening && <span className="absolute inset-[-10px] animate-ping rounded-full border-[3px] border-crayon-red opacity-60" />}
          {listening || micStarting ? <Mic size={44} strokeWidth={2.5} /> : <MicOff size={44} strokeWidth={2.5} />}
        </button>
        <div className="font-hand text-base text-ink-soft" data-testid="status">
          {!micSupported
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
          <div className="h-1.5 w-24 overflow-hidden rounded-full bg-ink/15" data-testid="mic-level">
            <div className="h-full rounded-full bg-crayon-green transition-[width] duration-75" style={{ width: `${Math.round(micLevel * 100)}%` }} />
          </div>
        )}
      </div>

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
          className="w-64 rounded-xl border-[3px] border-ink bg-paper px-3 py-2 font-hand text-lg text-ink outline-none placeholder:text-ink-soft focus:bg-white"
        />
      </form>

      {note && (
        <div className="pointer-events-none absolute bottom-8 left-1/2 -translate-x-1/2 rounded-xl bg-paper/90 px-4 py-1 font-hand text-lg text-ink-soft" data-testid="note">
          {note}
        </div>
      )}

      {lastWarning && (
        <div className="absolute right-4 bottom-20 max-w-xs rounded-xl border-[3px] border-crayon-red bg-paper px-3 py-2 font-hand text-base text-crayon-red" data-testid="warning">
          {lastWarning}
        </div>
      )}

      {settingsOpen && <SettingsPanel />}
      {debug && <DebugPanel />}
    </div>
  )
}
