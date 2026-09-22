import { effectiveSttRate, useApp } from '~/story/store'

/** Running cost and latency for this session, tucked under the toolbar. */
export function SpendChip() {
  const spend = useApp((s) => s.spend)
  const rate = useApp((s) => effectiveSttRate(s.settings))
  if (spend.calls === 0 && spend.audioMs === 0) return null
  const earsUsd = (spend.audioMs / 60000) * rate
  const usd = spend.usd
  const known = spend.calls - spend.unpriced
  const avg = spend.firstTokenSamples > 0 ? spend.firstTokenTotalMs / spend.firstTokenSamples : 0
  return (
    <div
      className="bg-paper/85 font-hand text-ink-soft absolute top-[4.6rem] right-4 rounded-lg px-2 py-0.5 text-sm"
      data-testid="spend"
      title={`${spend.input.toLocaleString()} in (${spend.cached.toLocaleString()} cached) / ${spend.output.toLocaleString()} out tokens`}>
      ${usd.toFixed(3)}
      {spend.unpriced > 0 ? `+? (${known}/${spend.calls} priced)` : ''} · {spend.calls} calls ·{' '}
      {Math.round(avg)}ms to first stroke
      {spend.audioMs > 0
        ? ` · ears ~$${earsUsd.toFixed(3)} (${(spend.audioMs / 60000).toFixed(1)} min)`
        : ''}
    </div>
  )
}
