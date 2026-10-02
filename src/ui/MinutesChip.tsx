import { Clock } from 'lucide-react'
import { useApp } from '~/story/store'
import { formatMinutes, gate, openParentArea } from './hosted'

/**
 * The minutes tag next to the wordmark: how much crayon time is left in this story (or the balance when
 * no story is running). Coral with a little "z" when the crayon is getting sleepy. Tapping it opens the
 * parent area through the grown-up gate. Hosted mode only; renders nothing otherwise.
 */
export function MinutesChip() {
  const hosted = useApp((s) => s.hosted)
  const remainingSec = useApp((s) => s.remainingSec)
  const balanceSec = useApp((s) => s.balanceSec)
  const sleepy = useApp((s) => s.sleepy)
  const comped = useApp((s) => s.comped)
  if (!hosted) return null

  const seconds = remainingSec ?? balanceSec
  const open = (): void => {
    void gate().then((ok) => {
      if (ok) openParentArea()
    })
  }

  return (
    <button
      type="button"
      className={`minutes-chip ${sleepy ? 'is-sleepy' : ''}`}
      onClick={open}
      aria-label={comped ? 'unlimited story time, open grown-up area' : `${formatMinutes(seconds)} of story time left, open grown-up area`}
      data-testid="minutes-chip">
      <Clock size={15} strokeWidth={2.6} aria-hidden="true" />
      <span>{comped ? 'unlimited' : formatMinutes(seconds)}</span>
      {sleepy && !comped && (
        <span className="minutes-chip-z" aria-hidden="true">
          z
        </span>
      )}
    </button>
  )
}
