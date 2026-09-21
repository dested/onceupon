import { useEffect, useRef } from 'react'
import { useApp } from '~/story/store'
import { lastClip, pcmToWav } from '~/speech/openai-realtime'
import { compareClip } from '~/speech/clip-lab'
import { appStore } from '~/story/store'

/** Latency numbers and the raw DSL stream. Toggle with the backtick key. */
export function DebugPanel() {
  const calls = useApp((s) => s.calls)
  const lines = useApp((s) => s.lines)
  const warnings = useApp((s) => s.warnings)
  const model = useApp((s) => `${s.settings.provider}/${s.settings.model}`)
  const spend = useApp((s) => s.spend)
  const rate = useApp((s) => s.settings.sttRatePerMin)
  const micLevel = useApp((s) => s.micLevel)
  const sttLog = useApp((s) => s.sttLog)
  const clipResults = useApp((s) => s.clipResults)
  const clipBusy = useApp((s) => s.clipBusy)
  const openaiKey = useApp((s) => s.settings.keys.openai)
  const sttModel = useApp((s) => s.settings.sttModel)
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
        </span>
        <span>
          ${spend.usd.toFixed(4)} · {spend.input + spend.cached} in ({spend.cached} cached) / {spend.output} out · first token{' '}
          {Math.round(avgFirst)}ms / done {Math.round(avgDone)}ms (n={done.length})
        </span>
        <span>
          ears {(spend.audioMs / 60000).toFixed(2)} min sent · ~${((spend.audioMs / 60000) * rate).toFixed(4)} at ${rate}/min (estimate)
        </span>
      </div>
      <div className="border-b border-paper/20 pb-2" data-testid="voice-lab">
        <div className="flex items-center gap-2">
          <span className="text-paper-deep">ears {sttModel}</span>
          <span className="inline-block h-2 w-24 overflow-hidden rounded bg-paper/20" title="mic level">
            <span className="block h-full bg-crayon-green" style={{ width: `${Math.round(micLevel * 100)}%` }} />
          </span>
          <button
            className="rounded bg-paper/20 px-1 hover:bg-paper/40 disabled:opacity-40"
            disabled={!lastClip}
            onClick={() => {
              const pcm = lastClip?.()
              if (!pcm || pcm.length === 0) {
                appStore.set((s) => ({ warnings: [...s.warnings, 'no mic clip yet: listen first'] }))
                return
              }
              const url = URL.createObjectURL(pcmToWav(pcm))
              const a = document.createElement('a')
              a.href = url
              a.download = `mic-${Date.now()}.wav`
              a.click()
              URL.revokeObjectURL(url)
            }}>
            save clip (last 30s)
          </button>
          <button
            className="rounded bg-paper/20 px-1 hover:bg-paper/40 disabled:opacity-40"
            disabled={!lastClip || clipBusy || !openaiKey}
            title="Run the last 30s of mic audio through gpt-live-transcribe, gpt-4o-transcribe and whisper-1"
            onClick={() => {
              const pcm = lastClip?.()
              if (!pcm || pcm.length === 0) return
              appStore.set({ clipBusy: true, clipResults: [] })
              void compareClip(pcm, openaiKey).then((clipResults) => appStore.set({ clipBusy: false, clipResults }))
            }}>
            {clipBusy ? 'comparing...' : 'compare models on clip'}
          </button>
        </div>
        {clipResults.length > 0 && (
          <div className="mt-1 grid grid-cols-[9rem_3.5rem_1fr] gap-x-2">
            {clipResults.map((r) => (
              <div key={r.model} className="contents">
                <span className="text-paper-deep">{r.model}</span>
                <span>{r.ms}ms</span>
                <span className={r.error ? 'text-crayon-red' : ''}>{r.error ?? r.text}</span>
              </div>
            ))}
          </div>
        )}
        {sttLog.length > 0 && (
          <div className="mt-1 max-h-24 overflow-y-auto text-paper-deep">
            {sttLog.slice(-40).map((e) => (
              <div key={e.id}>
                <span className="inline-block w-12 text-right">{(e.t / 1000).toFixed(1)}s</span> <span className="inline-block w-12">{e.kind}</span>
                <span className={e.kind === 'final' ? 'text-paper' : e.kind === 'error' ? 'text-crayon-red' : ''}>{e.text}</span>
              </div>
            ))}
          </div>
        )}
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
