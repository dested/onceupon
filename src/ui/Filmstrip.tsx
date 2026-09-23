import { useApp } from '~/story/store'

/** Earlier pages of the story, pinned top-left like photos. */
export function Filmstrip({ embedded = false }: { embedded?: boolean }) {
  const pages = useApp((s) => s.pages)
  if (pages.length === 0) return null
  return (
    <div
      className={embedded ? 'embedded-filmstrip' : 'absolute top-[calc(0.5rem+var(--sat))] left-[calc(0.5rem+var(--sal))] flex max-w-[calc(100%-1rem-var(--sal)-var(--sar)-16rem)] gap-3 overflow-x-auto p-2'}
      data-testid="filmstrip">
      {pages.map((p, i) => (
        <div
          key={p.index}
          style={{ transform: `rotate(${((i % 3) - 1) * 2.5}deg)` }}
          className="border-ink w-28 shrink-0 overflow-hidden rounded-lg border-[3px] bg-white shadow-[2px_3px_0_0_rgba(59,47,47,0.35)]">
          <img
            src={p.thumb}
            alt={p.title || `page ${p.index}`}
            className="block aspect-[16/10] w-full object-cover"
          />
          <div className="font-hand text-ink truncate px-1 text-center text-xs">
            {p.title || `page ${p.index}`}
          </div>
        </div>
      ))}
    </div>
  )
}
