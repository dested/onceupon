import { CloudOff } from 'lucide-react'
import { useApp } from '~/story/store'

/**
 * A small "you're offline" pill for the bookshelf. Hosted mode only; the studio needs the internet to
 * draw new stories, but saved stories still play, so this is a gentle notice, not a blocker.
 */
export function Offline() {
  const hosted = useApp((s) => s.hosted)
  const online = useApp((s) => s.online)
  if (!hosted || online) return null
  return (
    <div className="offline-banner" role="status" data-testid="offline-banner">
      <CloudOff size={16} strokeWidth={2.5} aria-hidden="true" />
      You're offline
    </div>
  )
}
