import { useEffect } from 'react'
import { appStore, useApp } from './story/store'
import { getKv } from './story/storage'
import { StoryScreen } from './ui/StoryScreen'
import { Bookshelf } from './ui/Bookshelf'
import { ReplayScreen } from './ui/ReplayScreen'
import { Intro } from './tutorial/IntroScreen'
import { ParentGate } from './ui/ParentGate'
import { Paywall } from './ui/Paywall'
import { ParentArea } from './ui/ParentArea'
import { ShareCard } from './ui/ShareCard'

export function App() {
  const screen = useApp((s) => s.screen)
  const nonce = useApp((s) => s.storyNonce)
  const replayId = useApp((s) => s.replayId)
  const hosted = useApp((s) => s.hosted)
  const tutorialOpen = useApp((s) => s.tutorialOpen)

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === '`' && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLTextAreaElement)) {
        appStore.set((s) => ({ debug: !s.debug }))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // First launch in hosted mode plays the intro once; dev-only `?intro=1` opens it in any mode and
  // `?demo=sleepy` shows the sleepy end card.
  useEffect(() => {
    if (import.meta.env.DEV && new URLSearchParams(location.search).get('intro') === '1') {
      appStore.set({ tutorialOpen: true })
    }
    if (!hosted) return
    void getKv('tutorialDone').then((done) => {
      if (done === null) appStore.set({ tutorialOpen: true })
    })
    if (import.meta.env.DEV && new URLSearchParams(location.search).get('demo') === 'sleepy') {
      window.setTimeout(() => appStore.set({ ended: true, ending: false, endReason: 'sleepy', sleepy: true }), 400)
    }
  }, [hosted])

  const body =
    screen === 'shelf' ? (
      <Bookshelf />
    ) : screen === 'replay' && replayId ? (
      <ReplayScreen key={replayId} storyId={replayId} />
    ) : (
      <StoryScreen key={nonce} />
    )

  return (
    <>
      {body}
      <ParentGate />
      <Paywall />
      <ParentArea />
      <ShareCard />
      {tutorialOpen && <Intro onDone={() => appStore.set({ tutorialOpen: false })} />}
    </>
  )
}
