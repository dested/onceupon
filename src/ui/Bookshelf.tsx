import { useEffect, useState } from 'react'
import { ArrowLeft, Play, Trash2 } from 'lucide-react'
import { appStore, useApp } from '~/story/store'
import { deleteStory, listStories } from '~/story/storage'
import { IconButton, StickerButton } from './bits'

export function Bookshelf() {
  const stories = useApp((s) => s.stories)
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [confirmEmpty, setConfirmEmpty] = useState(false)
  const empty = stories.filter((s) => s.words === 0)

  useEffect(() => {
    appStore.set({ stories: listStories() })
  }, [])

  const open = (id: string): void => appStore.set({ screen: 'replay', replayId: id })
  const back = (): void => appStore.set({ screen: 'story' })
  const remove = (id: string): void => {
    if (confirmId !== id) {
      setConfirmId(id)
      return
    }
    deleteStory(id)
    setConfirmId(null)
    appStore.set({ stories: listStories() })
  }
  const clearEmpty = (): void => {
    if (!confirmEmpty) {
      setConfirmEmpty(true)
      return
    }
    for (const s of empty) deleteStory(s.id)
    setConfirmEmpty(false)
    appStore.set({ stories: listStories() })
  }

  return (
    <div className="h-full w-full overflow-y-auto p-6" data-testid="shelf">
      <div className="mb-6 flex items-center gap-4">
        <IconButton label="Back to drawing" onClick={back}>
          <ArrowLeft size={24} strokeWidth={3} />
        </IconButton>
        <h1 className="font-scrawl text-4xl">Our stories</h1>
        {empty.length > 0 && (
          <StickerButton
            tilt={0}
            tone={confirmEmpty ? 'red' : 'paper'}
            className="ml-auto !text-base"
            onClick={clearEmpty}
            onBlur={() => setConfirmEmpty(false)}
            data-testid="clear-empty">
            <Trash2 size={18} strokeWidth={2.5} /> {confirmEmpty ? `delete ${empty.length} empty ${empty.length === 1 ? 'story' : 'stories'}?` : `clear ${empty.length} empty`}
          </StickerButton>
        )}
      </div>
      {stories.length === 0 && (
        <p className="font-hand text-2xl text-ink-soft">No stories yet. Go back and tell one!</p>
      )}
      <div className="grid grid-cols-[repeat(auto-fill,minmax(16rem,1fr))] gap-6">
        {stories.map((s, i) => (
          <div
            key={s.id}
            style={{ transform: `rotate(${((i % 3) - 1) * 1.2}deg)` }}
            className="flex flex-col overflow-hidden rounded-2xl border-[3px] border-ink bg-white shadow-[4px_6px_0_0_rgba(59,47,47,0.3)]">
            <button onClick={() => open(s.id)} className="block aspect-[16/10] w-full bg-paper-deep" aria-label={`Play ${s.title}`}>
              {s.cover ? <img src={s.cover} alt="" className="h-full w-full object-cover" /> : null}
            </button>
            <div className="flex items-center gap-2 p-3">
              <div className="min-w-0 flex-1">
                <div className="truncate font-hand text-xl leading-tight">{s.title}</div>
                <div className="font-hand text-sm text-ink-soft">
                  {new Date(s.createdAt).toLocaleDateString()} · {s.words} words
                </div>
              </div>
              <StickerButton tilt={0} tone="green" className="!px-3 !py-2" onClick={() => open(s.id)} aria-label="Play">
                <Play size={18} strokeWidth={3} />
              </StickerButton>
              <StickerButton
                tilt={0}
                tone={confirmId === s.id ? 'red' : 'paper'}
                className="!px-3 !py-2 !text-base"
                onClick={() => remove(s.id)}
                aria-label={confirmId === s.id ? 'Really delete' : 'Delete'}>
                {confirmId === s.id ? 'sure?' : <Trash2 size={18} strokeWidth={2.5} />}
              </StickerButton>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
