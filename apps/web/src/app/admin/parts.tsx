import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { StickerButton, type Tone } from '~/components/paper'
import { Sparkline } from './charts'

/** The slice of a react-query result AsyncBlock needs — kept structural so the tRPC error type
 * (TRPCClientErrorLike, not Error) does not have to match a UseQueryResult error generic. */
export interface QueryLike<T> {
  isPending: boolean
  isError: boolean
  error: unknown
  data: T | undefined
  refetch: () => unknown
}

// ---------------------------------------------------------------- day range (?days=)

const RANGES = [7, 30, 90] as const

/** The 7/30/90-day range, stored in the URL so it survives reload and is shareable. */
export function useDays(): [number, (d: number) => void] {
  const [sp, setSp] = useSearchParams()
  const raw = Number(sp.get('days'))
  const days = (RANGES as readonly number[]).includes(raw) ? raw : 30
  const set = (d: number) =>
    setSp(
      (prev) => {
        const next = new URLSearchParams(prev)
        next.set('days', String(d))
        return next
      },
      { replace: true }
    )
  return [days, set]
}

export function RangePicker({ days, onChange }: { days: number; onChange: (d: number) => void }) {
  return (
    <div className="flex items-center gap-2">
      {RANGES.map((r) => (
        <button
          key={r}
          type="button"
          onClick={() => onChange(r)}
          className={`rounded-xl border-[3px] border-ink px-3 py-1.5 font-hand text-lg leading-none shadow-[2px_3px_0_0_rgba(59,47,47,0.3)] transition active:translate-y-[2px] ${
            days === r ? 'bg-crayon-yellow text-ink' : 'bg-paper text-ink-soft'
          }`}>
          {r}d
        </button>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------- section + tiles

export function Section({
  title,
  right,
  children,
  className = '',
}: {
  title?: string
  right?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section className={`mb-8 ${className}`}>
      {(title || right) && (
        <div className="mb-3 flex items-end justify-between gap-3">
          {title ? <h2 className="font-scrawl text-2xl leading-none text-ink">{title}</h2> : <span />}
          {right}
        </div>
      )}
      {children}
    </section>
  )
}

export function StatTile({
  label,
  value,
  hint,
  spark,
  sparkColor,
  tone,
}: {
  label: string
  value: ReactNode
  hint?: string
  spark?: number[]
  sparkColor?: string
  tone?: 'plain' | 'good' | 'warn'
}) {
  const ring =
    tone === 'good' ? 'border-crayon-green' : tone === 'warn' ? 'border-crayon-red' : 'border-ink'
  return (
    <div className={`rounded-2xl border-[3px] ${ring} bg-paper p-4 shadow-[3px_4px_0_0_rgba(59,47,47,0.25)]`}>
      <div className="font-hand text-base text-ink-soft">{label}</div>
      <div className="mt-1 font-scrawl text-[32px] leading-none text-ink tabular-nums">{value}</div>
      {hint && <div className="mt-1 font-hand text-sm text-ink-soft">{hint}</div>}
      {spark && spark.length > 1 && (
        <div className="mt-2">
          <Sparkline values={spark} width={140} height={28} color={sparkColor} />
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- data table

export interface Column<T> {
  header: string
  cell: (row: T) => ReactNode
  align?: 'left' | 'right'
  /** Extra classes on the cell (e.g. `whitespace-nowrap`). */
  className?: string
}

export function DataTable<T>({
  columns,
  rows,
  getKey,
  empty = 'Nothing here yet',
}: {
  columns: Column<T>[]
  rows: T[]
  getKey: (row: T, i: number) => string
  empty?: string
}) {
  if (rows.length === 0) return <Empty label={empty} />
  return (
    <div className="overflow-x-auto rounded-2xl border-[3px] border-ink bg-paper shadow-[3px_4px_0_0_rgba(59,47,47,0.22)]">
      <table className="w-full border-collapse text-left">
        <thead>
          <tr className="sticky top-0 z-10 bg-paper-deep">
            {columns.map((c, i) => (
              <th
                key={i}
                className={`border-b-[3px] border-ink px-3 py-2 font-hand text-base text-ink ${
                  c.align === 'right' ? 'text-right' : 'text-left'
                }`}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={getKey(row, ri)} className="odd:bg-paper even:bg-paper-deep/40">
              {columns.map((c, ci) => (
                <td
                  key={ci}
                  className={`border-b border-ink/15 px-3 py-2 font-hand text-[15px] text-ink ${
                    c.align === 'right' ? 'text-right tabular-nums' : ''
                  } ${c.className ?? ''}`}>
                  {c.cell(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ---------------------------------------------------------------- async states

export function AsyncBlock<T>({
  query,
  children,
  isEmpty,
}: {
  query: QueryLike<T>
  children: (data: T) => ReactNode
  isEmpty?: (data: T) => boolean
}) {
  if (query.isPending) return <Loading />
  if (query.isError) return <ErrorBlock error={query.error} onRetry={() => query.refetch()} />
  if (query.data === undefined) return <Loading />
  if (isEmpty?.(query.data)) return <Empty />
  return <>{children(query.data)}</>
}

export function Loading({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-3" aria-busy="true">
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="h-14 animate-pulse rounded-2xl border-[3px] border-ink/30 bg-paper-deep"
          style={{ animationDelay: `${i * 90}ms` }}
        />
      ))}
    </div>
  )
}

export function Empty({ label = 'Nothing here yet' }: { label?: string }) {
  return (
    <div className="rounded-2xl border-[3px] border-dashed border-ink/40 bg-paper p-8 text-center font-hand text-lg text-ink-soft">
      {label}
    </div>
  )
}

export function ErrorBlock({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const message = error instanceof Error ? error.message : 'Something went wrong'
  return (
    <div className="rounded-2xl border-[3px] border-crayon-red bg-paper p-6 shadow-[3px_4px_0_0_rgba(239,68,68,0.3)]">
      <p className="font-hand text-lg text-crayon-red">{message}</p>
      <div className="mt-3">
        <StickerButton tone="red" tilt={-1} onClick={onRetry}>
          Try again
        </StickerButton>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- inline two-tap confirm

/** First tap arms ("sure?"), second within 3s fires. Never uses window.confirm (ui.md). */
export function ConfirmButton({
  onConfirm,
  children,
  confirmLabel = 'sure?',
  tone = 'red',
  disabled,
}: {
  onConfirm: () => void
  children: ReactNode
  confirmLabel?: string
  tone?: Tone
  disabled?: boolean
}) {
  const [armed, setArmed] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current)
  }, [])
  return (
    <StickerButton
      tone={armed ? 'red' : tone}
      tilt={-1}
      disabled={disabled}
      onClick={() => {
        if (armed) {
          if (timer.current) clearTimeout(timer.current)
          setArmed(false)
          onConfirm()
        } else {
          setArmed(true)
          timer.current = setTimeout(() => setArmed(false), 3000)
        }
      }}>
      {armed ? confirmLabel : children}
    </StickerButton>
  )
}

export function Pill({ children, tone = 'paper' }: { children: ReactNode; tone?: Tone }) {
  const bg: Record<Tone, string> = {
    paper: 'bg-paper-deep text-ink',
    red: 'bg-crayon-red text-white',
    blue: 'bg-crayon-blue text-white',
    yellow: 'bg-crayon-yellow text-ink',
    green: 'bg-crayon-green text-white',
    lilac: 'bg-lilac text-ink',
    sage: 'bg-sage text-ink',
    coral: 'bg-coral text-ink',
  }
  return (
    <span className={`inline-block rounded-full border-2 border-ink px-2 py-0.5 font-hand text-sm leading-none ${bg[tone]}`}>
      {children}
    </span>
  )
}
