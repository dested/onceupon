import { useEffect, useMemo, useRef, useState } from 'react'
import { Pause, Play, RotateCcw } from 'lucide-react'
import { z } from 'zod'
import { API_ORIGIN } from '~/backend/config'
import { Scene } from '~/engine/scene'
import { Stage } from '~/engine/stage'
import { Director } from '~/llm/director'
import { isDialectId, makeDialect } from '~/llm/dialect'
import { Replayer } from '~/story/replay'
import { parseStoryRecord, type StoryRecord } from '~/story/storage'
import tutorialRecord from '~/tutorial/tutorial-record.json'
import { VoicePlayer } from '~/story/voice'
import { BRAND } from '../../packages/shared/src/brand'
import { IconButton, PaperCard, StickerButton } from './bits'
import { VideoExportButton } from './VideoExport'

const publicShareSchema = z.object({
  id: z.string(),
  title: z.string(),
  childName: z.string().nullable(),
  record: z.unknown(),
  hasVoice: z.boolean(),
  voiceUrl: z.string().nullable(),
  voiceMime: z.string().nullable(),
  coverUrl: z.string().nullable(),
  createdAt: z.string(),
  expiresAt: z.string(),
})

interface Ready {
  childName: string | null
  record: StoryRecord
  hasVoice: boolean
  voiceUrl: string | null
  voiceMime: string | null
  totalMs: number
}

type LoadState = { k: 'loading' } | { k: 'gone' } | { k: 'ready'; data: Ready }

function voiceTotalMs(record: StoryRecord): number {
  return record.voice ? record.voice.clips.reduce((m, c) => Math.max(m, c.t + c.ms), 0) : 0
}

/** Owns the stage/director/replayer for one record; replays it with the child's voice in step. */
function useRecordPlayer(record: StoryRecord | null, voice: VoicePlayer | null) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const engineRef = useRef<{ stage: Stage; director: Director } | null>(null)
  const replayerRef = useRef<Replayer | null>(null)
  const [playing, setPlaying] = useState(false)
  const [caption, setCaption] = useState('')
  const [pos, setPos] = useState(0)
  const len = record?.events.length ?? 0

  const dialectId =
    record?.dialect && isDialectId(record.dialect) ? record.dialect : ('lines' as const)

  const newDirector = (stage: Stage): Director => {
    const scene = new Scene()
    stage.onPageSnapshot = () => undefined
    return new Director({
      scene,
      stage,
      dialect: makeDialect(dialectId, scene, { moderation: true }),
      getProvider: () => null,
      onEvent: () => undefined,
    })
  }

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !record) return
    const stage = new Stage(canvas, { seed: record.seed, audio: null })
    const director = newDirector(stage)
    stage.start()
    engineRef.current = { stage, director }
    const ro = new ResizeObserver(() => stage.resize())
    ro.observe(canvas)
    return () => {
      ro.disconnect()
      replayerRef.current?.stop()
      replayerRef.current = null
      stage.stop()
      voice?.dispose()
      engineRef.current = null
    }
    // A new record or voice rebuilds the whole player; newDirector is stable enough for that.
  }, [record, voice])

  const makeReplayer = (eng: { stage: Stage; director: Director }): Replayer => {
    if (!record) throw new Error('no record')
    return new Replayer(
      record,
      eng.director,
      {
        onWords: (_final, chunk) => setCaption(chunk),
        onProgress: (i) => setPos(i),
        onEnd: (seed) => void eng.stage.finale(seed),
        onDone: () => setPlaying(false),
      },
      { voice }
    )
  }

  const play = (): void => {
    const eng = engineRef.current
    if (!eng || !record) return
    replayerRef.current?.stop()
    const r = makeReplayer(eng)
    replayerRef.current = r
    setPlaying(true)
    r.play()
  }

  const resume = (): void => {
    const eng = engineRef.current
    if (!eng || !record) return
    const r = replayerRef.current
    if (!r || r.position >= r.length) {
      again()
      return
    }
    setPlaying(true)
    r.play()
  }

  const pause = (): void => {
    replayerRef.current?.stop()
    setPlaying(false)
  }

  /** Wipe the page and replay from the very beginning (a fresh scene, like the shelf's "again"). */
  const again = (): void => {
    const eng = engineRef.current
    if (!eng || !record) return
    replayerRef.current?.stop()
    eng.director.stop()
    eng.stage.clear()
    const director = newDirector(eng.stage)
    engineRef.current = { stage: eng.stage, director }
    setCaption('')
    setPos(0)
    const r = makeReplayer({ stage: eng.stage, director })
    replayerRef.current = r
    setPlaying(true)
    r.play()
  }

  return { canvasRef, playing, caption, pos, len, play, resume, pause, again }
}

/** `index.html?player=<id>`: the public story player behind every share link (phone-first). */
export function SharePlayer({ shareId }: { shareId: string }) {
  const [state, setState] = useState<LoadState>({ k: 'loading' })
  const [attempt, setAttempt] = useState(0)
  const [started, setStarted] = useState(false)

  useEffect(() => {
    let cancelled = false
    setState({ k: 'loading' })
    // The website's landing hero embeds the bundled tutorial story: no server round trip.
    if (shareId === 'tutorial') {
      const record = parseStoryRecord(tutorialRecord)
      setState(
        record
          ? {
              k: 'ready',
              data: { childName: null, record, hasVoice: false, voiceUrl: null, voiceMime: null, totalMs: 0 },
            }
          : { k: 'gone' }
      )
      return
    }
    fetch(`${API_ORIGIN}/api/share/${shareId}`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`share ${res.status}`)
        return publicShareSchema.parse(await res.json())
      })
      .then((share) => {
        if (cancelled) return
        const record = parseStoryRecord(share.record)
        if (!record) {
          setState({ k: 'gone' })
          return
        }
        setState({
          k: 'ready',
          data: {
            childName: share.childName,
            record,
            hasVoice: share.hasVoice,
            voiceUrl: share.voiceUrl,
            voiceMime: share.voiceMime,
            totalMs: voiceTotalMs(record),
          },
        })
      })
      .catch(() => {
        if (!cancelled) setState({ k: 'gone' })
      })
    return () => {
      cancelled = true
    }
  }, [shareId, attempt])

  const ready = state.k === 'ready' ? state.data : null
  const record = ready?.record ?? null

  const voice = useMemo(() => {
    if (!ready || !ready.hasVoice || !ready.voiceUrl || !ready.voiceMime) return null
    return VoicePlayer.fromUrl(API_ORIGIN + ready.voiceUrl, ready.voiceMime, ready.totalMs)
  }, [ready])

  const player = useRecordPlayer(record, voice)
  const atEnd = player.len > 0 && player.pos >= player.len

  const onFirstPlay = (): void => {
    setStarted(true)
    player.play()
  }

  const onInstall = (e: React.MouseEvent<HTMLAnchorElement>): void => {
    e.preventDefault()
    if (shareId !== 'tutorial') void fetch(`${API_ORIGIN}/api/share/${shareId}/install`, { method: 'POST', keepalive: true })
    window.location.href = BRAND.appStoreUrl || BRAND.origin
  }

  const onDownloaded = (): void => {
    if (shareId !== 'tutorial') void fetch(`${API_ORIGIN}/api/share/${shareId}/download`, { method: 'POST', keepalive: true })
  }

  if (state.k === 'loading')
    return (
      <div className="story-studio grid !grid-rows-1 place-items-center">
        <p className="animate-pulse font-scrawl text-2xl text-ink-soft">Opening the storybook…</p>
      </div>
    )

  if (state.k === 'gone')
    return (
      <div className="story-studio grid !grid-rows-1 place-items-center px-6">
        <PaperCard className="flex flex-col items-center gap-4 text-center">
          <span className="font-scrawl text-2xl text-ink">
            This story has gone back on the shelf
          </span>
          <div className="flex items-center gap-3">
            <StickerButton tone="paper" tilt={2} onClick={() => setAttempt((a) => a + 1)}>
              <RotateCcw size={18} strokeWidth={2.5} /> try again
            </StickerButton>
            <a
              href={BRAND.origin}
              className="inline-flex items-center rounded-2xl border-[3px] border-ink bg-crayon-yellow px-4 py-2 font-hand text-xl leading-none shadow-[3px_4px_0_0_rgba(59,47,47,0.35)]">
              {BRAND.name}
            </a>
          </div>
        </PaperCard>
      </div>
    )

  const title = ready?.childName ? `${ready.childName} made this story` : 'A story by a young storyteller'
  // The website draws its own storybook around the iframe: embed mode is just the paper and the controls.
  const embed = new URLSearchParams(window.location.search).get('embed') === '1'

  const paper = (
    <div className="story-paper">
      <canvas ref={player.canvasRef} className="story-canvas" data-testid="share-stage" />

      {started && player.caption && (
        <div className="pointer-events-none absolute top-6 right-0 left-0 flex flex-col items-center gap-2 px-6">
          <p
            key={player.caption}
            className="max-w-2xl rounded-2xl bg-paper/90 px-5 py-2 text-center font-scrawl text-2xl leading-snug text-ink shadow-[3px_4px_0_0_rgba(59,47,47,0.25)]">
            {player.caption}
          </p>
        </div>
      )}

      {!started && (
        <div className="absolute inset-0 grid place-items-center">
          <StickerButton
            tone="yellow"
            tilt={-2}
            className="!px-7 !py-4 !text-2xl"
            onClick={onFirstPlay}
            data-testid="share-play">
            <Play size={28} strokeWidth={3} fill="currentColor" /> Play
          </StickerButton>
        </div>
      )}

      {embed && started && (
        <div className="absolute right-4 bottom-4">
          {atEnd ? (
            <StickerButton tone="yellow" tilt={0} className="!text-lg" onClick={player.again}>
              <RotateCcw size={18} strokeWidth={3} /> again
            </StickerButton>
          ) : (
            <IconButton
              label={player.playing ? 'Pause' : 'Play'}
              active={player.playing}
              onClick={() => (player.playing ? player.pause() : player.resume())}>
              {player.playing ? <Pause size={22} strokeWidth={3} /> : <Play size={22} strokeWidth={3} />}
            </IconButton>
          )}
        </div>
      )}
    </div>
  )

  if (embed)
    return (
      <div className="flex h-full w-full bg-paper" data-testid="share-player-embed">
        {paper}
      </div>
    )

  return (
    <div className="story-studio" data-testid="share-player">
      <header className="studio-header !justify-center">
        <div className="share-player-title rounded-2xl bg-paper/90 px-5 py-2 text-center font-scrawl text-ink shadow-[3px_4px_0_0_rgba(59,47,47,0.25)]">
          {title}
        </div>
      </header>

      <main className="storybook" aria-label="Shared storybook">
        <div className="book-binding" aria-hidden="true">
          <span />
          <span />
          <span />
          <span />
          <span />
        </div>
        {paper}
      </main>

      <footer className="story-controls">
        <div className="flex w-full flex-wrap items-center justify-center gap-4">
          {atEnd ? (
            <StickerButton tone="yellow" tilt={0} onClick={player.again} data-testid="share-again">
              <RotateCcw size={22} strokeWidth={3} /> again
            </StickerButton>
          ) : (
            started && (
              <IconButton
                label={player.playing ? 'Pause' : 'Play'}
                active={player.playing}
                onClick={() => (player.playing ? player.pause() : player.resume())}>
                {player.playing ? (
                  <Pause size={22} strokeWidth={3} />
                ) : (
                  <Play size={22} strokeWidth={3} />
                )}
              </IconButton>
            )
          )}
          {record && (
            <VideoExportButton variant="player" getRecord={() => record} onExported={onDownloaded} />
          )}
          <a
            href={BRAND.appStoreUrl || BRAND.origin}
            onClick={onInstall}
            className="ml-auto font-hand text-lg text-ink-soft underline decoration-2 underline-offset-4"
            data-testid="share-install">
            {BRAND.madeWith}
          </a>
        </div>
      </footer>
    </div>
  )
}
