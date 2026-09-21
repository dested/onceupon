import { useEffect } from 'react'
import { appStore, useApp } from './story/store'
import { StoryScreen } from './ui/StoryScreen'
import { Bookshelf } from './ui/Bookshelf'
import { ReplayScreen } from './ui/ReplayScreen'

export function App() {
  const screen = useApp((s) => s.screen)
  const nonce = useApp((s) => s.storyNonce)
  const replayId = useApp((s) => s.replayId)

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === '`' && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLTextAreaElement)) {
        appStore.set((s) => ({ debug: !s.debug }))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  if (screen === 'shelf') return <Bookshelf />
  if (screen === 'replay' && replayId) return <ReplayScreen key={replayId} storyId={replayId} />
  return <StoryScreen key={nonce} />
}
