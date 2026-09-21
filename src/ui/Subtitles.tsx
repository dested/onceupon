import { useApp } from '~/story/store'

/**
 * The child's words in one line along the bottom, newest words always visible: the text floats
 * right inside a clipped box, so old words slide off the left edge instead of wrapping over the art.
 * Three states, so it is obvious what the crayon is up to: words already drawn in ink, the words
 * being drawn right now on a yellow crayon highlight, and words heard but not sent yet in grey.
 */
export function Subtitles({ className = '' }: { className?: string }) {
  const final = useApp((s) => s.transcriptFinal)
  const interim = useApp((s) => s.transcriptInterim)
  const drawing = useApp((s) => s.drawingWords)
  const queued = useApp((s) => s.queuedWords)
  if (!final && !interim) return null

  // transcriptFinal always ends with `<drawing> <queued>` (they were fed in that order).
  const live = [drawing, queued].filter(Boolean).join(' ')
  const done = live && final.endsWith(live) ? final.slice(0, final.length - live.length).trimEnd() : final
  const doneTail = done.length > 200 ? done.slice(-200) : done
  const waiting = [queued, interim].filter(Boolean).join(' ')
  return (
    <div className={`pointer-events-none absolute overflow-hidden ${className}`}>
      <p
        className="float-right rounded-xl bg-paper/80 px-4 py-1 font-hand text-2xl leading-tight whitespace-nowrap text-ink"
        data-testid="subtitles">
        {doneTail}
        {drawing && (
          <span className="ml-2 rounded-md bg-crayon-yellow/70 px-1.5 text-ink" data-testid="subtitles-drawing">
            {drawing}
          </span>
        )}
        {waiting && (
          <span className="ml-2 text-ink-soft" data-testid="subtitles-waiting">
            {waiting}
          </span>
        )}
      </p>
    </div>
  )
}
