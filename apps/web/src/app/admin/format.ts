// Formatting helpers for the admin portal. Money is always integer US cents on the wire;
// durations are seconds; dates arrive as ISO strings (see server/admin-queries.ts).

/** Integer cents -> "$1,234.56". */
export function money(cents: number): string {
  const sign = cents < 0 ? '-' : ''
  const abs = Math.abs(cents)
  const dollars = Math.floor(abs / 100)
  const rem = abs % 100
  return `${sign}$${dollars.toLocaleString('en-US')}.${rem.toString().padStart(2, '0')}`
}

/** Integer cents -> "$1.2k" / "$3.4M" for dense stat tiles. */
export function moneyShort(cents: number): string {
  const sign = cents < 0 ? '-' : ''
  const dollars = Math.abs(cents) / 100
  if (dollars >= 1_000_000) return `${sign}$${trim(dollars / 1_000_000)}M`
  if (dollars >= 1_000) return `${sign}$${trim(dollars / 1_000)}k`
  return `${sign}$${dollars.toFixed(dollars < 10 ? 2 : 0)}`
}

function trim(n: number): string {
  return n.toFixed(1).replace(/\.0$/, '')
}

/** Whole count -> "1,234" (and "12.3k" past ten thousand for tiles). */
export function count(n: number): string {
  return n.toLocaleString('en-US')
}

export function countShort(n: number): string {
  if (Math.abs(n) >= 1_000_000) return `${trim(n / 1_000_000)}M`
  if (Math.abs(n) >= 10_000) return `${trim(n / 1_000)}k`
  return n.toLocaleString('en-US')
}

/** Seconds -> "mm:ss" (or "h:mm:ss" past an hour). */
export function clock(totalSeconds: number): string {
  const sign = totalSeconds < 0 ? '-' : ''
  const s = Math.round(Math.abs(totalSeconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  const mm = h > 0 ? m.toString().padStart(2, '0') : m.toString()
  const ss = sec.toString().padStart(2, '0')
  return h > 0 ? `${sign}${h}:${mm}:${ss}` : `${sign}${mm}:${ss}`
}

/** Seconds -> "12.3 min" for minutes-served headlines. */
export function minutes(totalSeconds: number): string {
  return `${(totalSeconds / 60).toLocaleString('en-US', { maximumFractionDigits: 1 })} min`
}

/** Milliseconds -> "820ms" / "1.4s". */
export function ms(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—'
  if (value < 1000) return `${Math.round(value)}ms`
  return `${(value / 1000).toFixed(1)}s`
}

/** Fraction 0..1 -> "42%". Pass alreadyPercent for 0..100 inputs. */
export function percent(fraction: number, alreadyPercent = false): string {
  const p = alreadyPercent ? fraction : fraction * 100
  return `${p.toLocaleString('en-US', { maximumFractionDigits: p < 10 ? 1 : 0 })}%`
}

/** Micro-dollars (USD * 1e6, the CallLog unit) -> integer cents. */
export function microsToCents(micros: number): number {
  return Math.round(micros / 10000)
}

const DATE_FMT = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' })
const DATETIME_FMT = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
})

/** ISO string -> "Sep 22". */
export function shortDate(iso: string): string {
  return DATE_FMT.format(new Date(iso))
}

/** ISO string -> "Sep 22, 3:04 PM". */
export function dateTime(iso: string): string {
  return DATETIME_FMT.format(new Date(iso))
}

/** "2026-09-22" (a day-series key) -> "Sep 22" without timezone drift. */
export function dayLabel(day: string): string {
  const [y, m, d] = day.split('-').map(Number)
  if (!y || !m || !d) return day
  return DATE_FMT.format(new Date(Date.UTC(y, m - 1, d)))
}

/** ISO string -> "3 days ago" / "just now". */
export function relative(iso: string): string {
  const then = new Date(iso).getTime()
  const diff = Date.now() - then
  const sec = Math.round(diff / 1000)
  if (sec < 45) return 'just now'
  const min = Math.round(sec / 60)
  if (min < 60) return `${min}m ago`
  const hr = Math.round(min / 60)
  if (hr < 24) return `${hr}h ago`
  const day = Math.round(hr / 24)
  if (day < 30) return `${day}d ago`
  return shortDate(iso)
}
