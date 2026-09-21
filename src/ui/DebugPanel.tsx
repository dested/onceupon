import { useEffect, useRef } from 'react'
import { useApp } from '~/story/store'
import { lastClip, pcmToWav } from '~/speech/openai-realtime'

/** Latency numbers and the raw DSL stream. Toggle with the backtick key. */
export function DebugPanel() {
  const calls = useApp((s) => s.calls)
  const lines = useApp((s) => s.lines)
  const warnings = useApp((s) => s.warnings)
  const model = useApp((s) => `${s.settings.provider}/${s.settings.model}`)
  const spend = useApp((s) => s.spend)
  const rate = useApp((s) => s.settings.sttRatePerMin)
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' })
  }, [lines.length])

  const recent = calls.slice(-6).reverse()
  const done = calls.filter((c) => c.doneMs !== null && c.error === null)
  const avgFirst = done.length ? done.reduce((n, c) => n + (c.firstTokenMs ?? 0), 0) / done.length : 0
  const avgDone = done.length ? done.reduce((n, c) => n + (c.doneMs ?? 0), 0) / done.length : 0

  return (
    <div
      className="absolute bottom-4 left-4 flex h-[46vh] w-[30rem] max-w-[90vw] flex-col gap-2 rounded-xl bg-ink/85 p-3 font-mono text-[11px] text-paper"
      data-testid="debug">
      <div className="flex justify-between text-paper-deep">
        <span>
          {model}{' '}
          <button
            className="ml-2 rounded bg-paper/20 px-1 hover:bg-paper/40"
            onClick={() => {
              const pcm = lastClip?.()
              if (!pcm || pcm.length === 0) return
              const url = URL.createObjectURL(pcmToWav(pcm))
              const a = document.createElement('a')
              a.href = url
              a.download = `mic-${Date.now()}.wav`
              a.click()
              URL.revokeObjectURL(url)
            }}>
            save mic clip
          </button>
        </span>
        <span>
          ${spend.usd.toFixed(4)} · {spend.input + spend.cached} in ({spend.cached} cached) / {spend.output} out · first token{' '}
          {Math.round(avgFirst)}ms / done {Math.round(avgDone)}ms (n={done.length})
        </span>
        <span>
          ears {(spend.audioMs / 60000).toFixed(2)} min sent · ~${((spend.audioMs / 60000) * rate).toFixed(4)} at ${rate}/min (estimate)
        </span>
      </div>
      <div className="grid grid-cols-[2.5rem_4.5rem_4.5rem_3rem_7rem_1fr] gap-x-2 border-b border-paper/20 pb-2">
        {recent.map((c) => (
          <div key={c.id} className="contents">
            <span>#{c.id}</span>
            <span>{c.firstTokenMs === null ? '...' : `${Math.round(c.firstTokenMs)}ms`}</span>
            <span>{c.doneMs === null ? '...' : `${Math.round(c.doneMs)}ms`}</span>
            <span>{c.lines}L</span>
            <span title={c.usage ? `${c.usage.input}+${c.usage.cacheWrite}w+${c.usage.cacheRead}r in / ${c.usage.output} out` : 'no usage reported'}>
              {c.usage ? `${c.usage.input + c.usage.cacheWrite + c.usage.cacheRead}/${c.usage.output}t` : '-'}{' '}
              {c.costUsd === null ? '' : `$${c.costUsd.toFixed(4)}`}
            </span>
            <span className={`truncate ${c.error ? 'text-crayon-red' : 'text-paper-deep'}`}>{c.error ?? c.words}</span>
          </div>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {lines.map((l) => (
          <div key={l.id} className={l.ok ? '' : 'text-crayon-red'} title={l.error ?? undefined}>
            {l.line}
            {l.error ? `   <- ${l.error}` : ''}
          </div>
        ))}
        <div ref={endRef} />
      </div>
      {warnings.length > 0 && <div className="text-crayon-yellow">{warnings[warnings.length - 1]}</div>}
    </div>
  )
}
