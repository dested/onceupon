import { useEffect, useReducer, useState, type ReactNode } from 'react'
import type { Campaign } from '../campaign'
import { SUBSCORE_KEYS, type Critique, type DrawLine, type DrawResult, type Issue } from '../types'

/** Force a re-render whenever the campaign notifies; render reads campaign.state / campaign.progress live. */
export function useCampaignTick(campaign: Campaign): void {
  const [, force] = useReducer((n: number) => n + 1, 0)
  useEffect(() => campaign.subscribe(() => force()), [campaign])
}

/** A tiny async loader with a manual refresh, for the store reads. */
export function useLoader<T>(
  load: () => Promise<T>,
  deps: unknown[],
  onError: (e: string) => void
): {
  data: T | null
  loading: boolean
  refresh: () => void
} {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [tick, setTick] = useState(0)
  useEffect(() => {
    let live = true
    setLoading(true)
    load()
      .then((d) => {
        if (live) setData(d)
      })
      .catch((e: unknown) => {
        if (live) onError(errText(e))
      })
      .finally(() => {
        if (live) setLoading(false)
      })
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick, ...deps])
  return { data, loading, refresh: () => setTick((n) => n + 1) }
}

export function errText(e: unknown): string {
  if (e instanceof Error) return e.message
  if (typeof e === 'string') return e
  return 'unknown error'
}

export function overallTone(n: number): 'green' | 'yellow' | 'red' {
  if (n >= 75) return 'green'
  if (n >= 50) return 'yellow'
  return 'red'
}

const TONE_BG: Record<'green' | 'yellow' | 'red' | 'ink' | 'soft', string> = {
  green: 'bg-crayon-green text-white',
  yellow: 'bg-crayon-yellow text-ink',
  red: 'bg-crayon-red text-white',
  ink: 'bg-ink text-paper',
  soft: 'bg-paper-deep text-ink',
}

export function Chip({
  children,
  tone = 'soft',
  className = '',
}: {
  children: ReactNode
  tone?: 'green' | 'yellow' | 'red' | 'ink' | 'soft'
  className?: string
}) {
  return (
    <span
      className={`border-ink inline-flex items-center gap-1 rounded-full border-2 px-2 py-0.5 text-sm leading-none ${TONE_BG[tone]} ${className}`}>
      {children}
    </span>
  )
}

/** A round overall as a coloured pill. */
export function OverallChip({ overall }: { overall: number | null }) {
  if (overall === null) return <Chip tone="soft">—</Chip>
  return <Chip tone={overallTone(overall)}>{overall}</Chip>
}

export function Stars({ n }: { n: number }) {
  return (
    <span className="text-crayon-yellow text-lg leading-none" title={`recognizable ${n}/5`}>
      {'★'.repeat(n)}
      <span className="text-ink-soft">{'★'.repeat(Math.max(0, 5 - n))}</span>
    </span>
  )
}

export function SubscoreBars({ subs }: { subs: Critique['subscores'] }) {
  return (
    <div className="grid grid-cols-[7rem_1fr_1.5rem] items-center gap-x-2 gap-y-1">
      {SUBSCORE_KEYS.map((k) => {
        const v = subs[k]
        return (
          <div key={k} className="contents">
            <span className="text-ink-soft text-sm">{k}</span>
            <span className="bg-paper-deep border-ink relative h-3 overflow-hidden rounded-full border-2">
              <span
                className="bg-crayon-blue block h-full"
                style={{ width: `${(v / 5) * 100}%` }}
              />
            </span>
            <span className="text-right text-sm">{v}</span>
          </div>
        )
      })}
    </div>
  )
}

export function IssueRows({ issues }: { issues: Issue[] }) {
  if (issues.length === 0) return <p className="text-ink-soft text-sm">no issues flagged</p>
  return (
    <div className="flex flex-col gap-2">
      {issues.map((iss, i) => (
        <div key={i} className="border-ink/25 rounded-xl border-2 border-dashed p-2">
          <div className="mb-1 flex flex-wrap items-center gap-1">
            <Chip tone={iss.severity === 'major' ? 'red' : 'yellow'}>{iss.severity}</Chip>
            <Chip tone="ink">{iss.kind}</Chip>
            <span className="text-base">{iss.what}</span>
          </div>
          <p className="text-ink-soft font-mono text-xs whitespace-pre-wrap">{iss.evidence}</p>
          <p className="mt-1 text-sm italic">{iss.rule}</p>
        </div>
      ))}
    </div>
  )
}

export function PraiseList({ praise }: { praise: string[] }) {
  if (praise.length === 0) return null
  return (
    <ul className="list-disc pl-5 text-sm">
      {praise.map((p, i) => (
        <li key={i}>{p}</li>
      ))}
    </ul>
  )
}

/** The one dark mono surface: raw ops, parse errors in crayon-red. */
export function OpsView({
  lines,
  ops,
  className = '',
}: {
  lines?: DrawLine[]
  ops?: string
  className?: string
}) {
  const rows: DrawLine[] =
    lines ?? (ops ?? '').split('\n').map((line) => ({ line, ok: true, error: null }))
  return (
    <div
      className={`bg-ink/90 text-paper overflow-auto rounded-xl p-3 font-mono text-[11px] leading-relaxed ${className}`}>
      {rows.length === 0 ? (
        <span className="text-paper-deep">no ops</span>
      ) : (
        rows.map((l, i) => (
          <div key={i} className={l.ok ? '' : 'text-crayon-red'} title={l.error ?? undefined}>
            {l.line || ' '}
            {l.error ? `   <- ${l.error}` : ''}
          </div>
        ))
      )}
    </div>
  )
}

/** Draw-call stats as small pills. */
export function DrawStats({ draw }: { draw: DrawResult }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      <Chip>first {fmtMs(draw.firstTokenMs)}</Chip>
      <Chip>done {fmtMs(draw.doneMs)}</Chip>
      <Chip>{draw.usage ? `${draw.usage.output} out tok` : 'no usage'}</Chip>
      <Chip>{fmtUsd(draw.costUsd)}</Chip>
      {draw.parseErrors > 0 ? <Chip tone="red">{draw.parseErrors} parse err</Chip> : null}
      {draw.error ? <Chip tone="red">draw error</Chip> : null}
    </div>
  )
}

export function fmtMs(ms: number | null): string {
  if (ms === null) return '—'
  return `${Math.round(ms)}ms`
}

export function fmtUsd(usd: number | null): string {
  if (usd === null) return '$—'
  return `$${usd.toFixed(4)}`
}

export function fmtPct(x: number | null): string {
  if (x === null) return '—'
  return `${Math.round(x * 100)}%`
}

export function fmtNum(x: number | null, digits = 1): string {
  if (x === null) return '—'
  return x.toFixed(digits)
}

/** A destructive button that flips to "sure?" inline, never window.confirm. */
export function InlineConfirm({
  label,
  confirmLabel = 'sure?',
  onConfirm,
  tone = 'red',
  disabled = false,
  className = '',
}: {
  label: ReactNode
  confirmLabel?: string
  onConfirm: () => void
  tone?: 'red' | 'yellow'
  disabled?: boolean
  className?: string
}) {
  const [armed, setArmed] = useState(false)
  useEffect(() => {
    if (!armed) return
    const t = window.setTimeout(() => setArmed(false), 4000)
    return () => window.clearTimeout(t)
  }, [armed])
  return (
    <button
      disabled={disabled}
      onClick={() => {
        if (armed) {
          setArmed(false)
          onConfirm()
        } else {
          setArmed(true)
        }
      }}
      className={`border-ink rounded-xl border-2 px-3 py-1 text-base leading-none transition disabled:opacity-40 ${
        armed
          ? tone === 'red'
            ? 'bg-crayon-red text-white'
            : 'bg-crayon-yellow text-ink'
          : 'bg-paper'
      } ${className}`}>
      {armed ? confirmLabel : label}
    </button>
  )
}
