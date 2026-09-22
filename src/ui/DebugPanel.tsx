import { useEffect, useRef, useState } from 'react'
import { effectiveSttRate, useApp } from '~/story/store'
import { lastClip, pcmToWav } from '~/speech/pcm-mic'
import { compareClip } from '~/speech/clip-lab'
import { appStore } from '~/story/store'
import { buildDebugReport } from '~/story/debug-report'
import { getDebugHandle } from '~/debug-handle'

/** Copy the full report; if the clipboard is unavailable (no focus, http), download it instead. */
async function copyReport(): Promise<'copied' | 'downloaded'> {
  const text = buildDebugReport(appStore.get(), getDebugHandle())
  try {
    await navigator.clipboard.writeText(text)
    return 'copied'
  } catch {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `onceupon-debug-${Date.now()}.txt`
    a.click()
    URL.revokeObjectURL(url)
    return 'downloaded'
  }
}

/** Latency numbers and the raw DSL stream. Toggle with the backtick key. */
export function DebugPanel() {
  const calls = useApp((s) => s.calls)
  const lines = useApp((s) => s.lines)
  const warnings = useApp((s) => s.warnings)
  const model = useApp((s) => `${s.settings.provider}/${s.settings.model}`)
  const spend = useApp((s) => s.spend)
  const rate = useApp((s) => effectiveSttRate(s.settings))
  const micLevel = useApp((s) => s.micLevel)
  const sttLog = useApp((s) => s.sttLog)
  const clipResults = useApp((s) => s.clipResults)
  const clipBusy = useApp((s) => s.clipBusy)
  const openaiKey = useApp((s) => s.settings.keys.openai)
  const sttModel = useApp((s) => s.settings.sttModel)
  const endRef = useRef<HTMLDivElement>(null)
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'downloaded'>('idle')

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' })
  }, [lines.length])

  useEffect(() => {
    if (copyState === 'idle') return
    const t = window.setTimeout(() => setCopyState('idle'), 2000)
    return () => clearTimeout(t)
  }, [copyState])

  const recent = calls.slice(-6).reverse()
  const done = calls.filter((c) => c.doneMs !== null && c.error === null)
  const avgFirst = done.length
    ? done.reduce((n, c) => n + (c.firstTokenMs ?? 0), 0) / done.length
    : 0
  const avgDone = done.length ? done.reduce((n, c) => n + (c.doneMs ?? 0), 0) / done.length : 0

  return (
    <div
      className="bg-ink/85 text-paper absolute bottom-4 left-4 flex h-[46vh] w-[30rem] max-w-[90vw] flex-col gap-2 rounded-xl p-3 font-mono text-[11px]"
      data-testid="debug">
      <div className="text-paper-deep flex justify-between">
        <span>
          {model}{' '}
          <button
            className="bg-paper/20 hover:bg-paper/40 text-paper ml-1 rounded px-1"
            title="Copy a full text report (settings, every call with timings and tokens, the DSL lines, the ears trace, the story timeline) to paste into a chat"
            data-testid="copy-report"
            onClick={() => {
              void copyReport().then(setCopyState)
            }}>
            {copyState === 'idle' ? 'copy report' : copyState}
          </button>
        </span>
        <span>
          ${spend.usd.toFixed(4)} · {spend.input + spend.cached} in ({spend.cached} cached) /{' '}
          {spend.output} out · first token {Math.round(avgFirst)}ms / done {Math.round(avgDone)}ms
          (n={done.length})
        </span>
        <span>
          ears {(spend.audioMs / 60000).toFixed(2)} min sent · ~$
          {((spend.audioMs / 60000) * rate).toFixed(4)} at ${rate}/min (estimate)
        </span>
      </div>
      <div className="border-paper/20 border-b pb-2" data-testid="voice-lab">
        <div className="flex items-center gap-2">
          <span className="text-paper-deep">ears {sttModel}</span>
          <span
            className="bg-paper/20 inline-block h-2 w-24 overflow-hidden rounded"
            title="mic level">
            <span
              className="bg-crayon-green block h-full"
              style={{ width: `${Math.round(micLevel * 100)}%` }}
            />
          </span>
          <button
            className="bg-paper/20 hover:bg-paper/40 rounded px-1 disabled:opacity-40"
            disabled={!lastClip}
            onClick={() => {
              const pcm = lastClip?.()
              if (!pcm || pcm.length === 0) {
                appStore.set((s) => ({
                  warnings: [...s.warnings, 'no mic clip yet: listen first'],
                }))
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
            className="bg-paper/20 hover:bg-paper/40 rounded px-1 disabled:opacity-40"
            disabled={!lastClip || clipBusy || !openaiKey}
            title="Run the last 30s of mic audio through gpt-live-transcribe, gpt-4o-transcribe and whisper-1"
            onClick={() => {
              const pcm = lastClip?.()
              if (!pcm || pcm.length === 0) return
              appStore.set({ clipBusy: true, clipResults: [] })
              void compareClip(pcm, openaiKey).then((clipResults) =>
                appStore.set({ clipBusy: false, clipResults })
              )
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
          <div className="text-paper-deep mt-1 max-h-24 overflow-y-auto">
            {sttLog.slice(-40).map((e) => (
              <div key={e.id}>
                <span className="inline-block w-12 text-right">{(e.t / 1000).toFixed(1)}s</span>{' '}
                <span className="inline-block w-12">{e.kind}</span>
                <span
                  className={
                    e.kind === 'final' ? 'text-paper' : e.kind === 'error' ? 'text-crayon-red' : ''
                  }>
                  {e.text}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="border-paper/20 grid grid-cols-[2.5rem_4.5rem_4.5rem_3rem_7rem_1fr] gap-x-2 border-b pb-2">
        {recent.map((c) => (
          <div key={c.id} className="contents">
            <span>#{c.id}</span>
            <span>{c.firstTokenMs === null ? '...' : `${Math.round(c.firstTokenMs)}ms`}</span>
            <span>{c.doneMs === null ? '...' : `${Math.round(c.doneMs)}ms`}</span>
            <span>{c.lines}L</span>
            <span
              title={
                c.usage
                  ? `${c.usage.input}+${c.usage.cacheWrite}w+${c.usage.cacheRead}r in / ${c.usage.output} out`
                  : 'no usage reported'
              }>
              {c.usage
                ? `${c.usage.input + c.usage.cacheWrite + c.usage.cacheRead}/${c.usage.output}t`
                : '-'}{' '}
              {c.costUsd === null ? '' : `$${c.costUsd.toFixed(4)}`}
            </span>
            <span className={`truncate ${c.error ? 'text-crayon-red' : 'text-paper-deep'}`}>
              {c.error ?? c.words}
            </span>
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
      {warnings.length > 0 && (
        <div className="text-crayon-yellow">{warnings[warnings.length - 1]}</div>
      )}
    </div>
  )
}
