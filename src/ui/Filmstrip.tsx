import { useApp } from '~/story/store'

/** Earlier pages of the story, pinned top-left like photos. */
export function Filmstrip() {
  const pages = useApp((s) => s.pages)
  if (pages.length === 0) return null
  return (
    <div className="absolute top-4 left-4 flex gap-3" data-testid="filmstrip">
      {pages.map((p, i) => (
        <div
          key={p.index}
          style={{ transform: `rotate(${((i % 3) - 1) * 2.5}deg)` }}
          className="w-28 overflow-hidden rounded-lg border-[3px] border-ink bg-white shadow-[2px_3px_0_0_rgba(59,47,47,0.35)]">
          <img src={p.thumb} alt={p.title || `page ${p.index}`} className="block aspect-[16/10] w-full object-cover" />
          <div className="truncate px-1 text-center font-hand text-xs text-ink">{p.title || `page ${p.index}`}</div>
        </div>
      ))}
    </div>
  )
}
