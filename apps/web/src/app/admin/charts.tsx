// Inline-SVG charts for the admin portal. No charting library. Responsive via viewBox.
// Thin marks, a single baseline (no gridlines), direct labels at series ends, hand-font ticks.
// Categorical colours are the validated dataviz palette (max 4 series); see references/palette.md.

import { useId } from 'react'

/** Validated categorical slots (light surface): blue, orange, aqua, yellow. Max 4 series. */
export const SERIES_COLORS = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100'] as const

const BASELINE = 'rgba(59,47,47,0.28)'
const GHOST = 'rgba(59,47,47,0.14)'
const TICK = '#8a7a6a'

export interface LineSeries {
  key: string
  label: string
  color: string
}

export interface LinePoint {
  label: string
  values: Record<string, number>
}

function niceMax(raw: number): number {
  if (raw <= 0) return 1
  const pow = Math.pow(10, Math.floor(Math.log10(raw)))
  const n = raw / pow
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10
  return step * pow
}

/**
 * A many-series line chart on one scale. `format` renders the peak tick and the direct end
 * labels. `xEvery` thins the x tick labels. Values missing for a series read as 0.
 */
export function LineChart({
  points,
  series,
  height = 220,
  format = (v) => String(Math.round(v)),
  ariaLabel,
}: {
  points: LinePoint[]
  series: LineSeries[]
  height?: number
  format?: (v: number) => string
  ariaLabel?: string
}) {
  const W = 760
  const H = height
  const padL = 8
  const padR = 92 // room for direct end labels
  const padT = 14
  const padB = 26
  const left = padL
  const right = W - padR
  const top = padT
  const bottom = H - padB

  const n = points.length
  const peak = niceMax(
    Math.max(0, ...points.flatMap((p) => series.map((s) => p.values[s.key] ?? 0)))
  )
  const x = (i: number) => (n <= 1 ? left : left + (i / (n - 1)) * (right - left))
  const y = (v: number) => bottom - (v / peak) * (bottom - top)

  const xTicks = tickIndexes(n)

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      width="100%"
      role="img"
      aria-label={ariaLabel}
      preserveAspectRatio="none"
      style={{ display: 'block', overflow: 'visible' }}>
      {/* peak reference + baseline */}
      <line x1={left} y1={top} x2={right} y2={top} stroke={GHOST} strokeWidth={1} />
      <text
        x={left}
        y={top - 4}
        className="font-hand"
        fontSize={12}
        fill={TICK}
        style={{ overflow: 'visible' }}>
        {format(peak)}
      </text>
      <line x1={left} y1={bottom} x2={right} y2={bottom} stroke={BASELINE} strokeWidth={1.5} />

      {series.map((s) => {
        const d = points
          .map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(p.values[s.key] ?? 0).toFixed(1)}`)
          .join(' ')
        const lastVal = points.length ? points[points.length - 1].values[s.key] ?? 0 : 0
        return (
          <g key={s.key}>
            <path d={d} fill="none" stroke={s.color} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
            {n > 0 && (
              <>
                <circle cx={x(n - 1)} cy={y(lastVal)} r={3.5} fill={s.color} />
                <text
                  x={right + 8}
                  y={y(lastVal)}
                  dominantBaseline="middle"
                  className="font-hand"
                  fontSize={12}
                  fill={s.color}>
                  {s.label}
                </text>
              </>
            )}
          </g>
        )
      })}

      {xTicks.map((i) => (
        <text
          key={i}
          x={x(i)}
          y={bottom + 16}
          textAnchor={i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}
          className="font-hand"
          fontSize={12}
          fill={TICK}>
          {points[i]?.label ?? ''}
        </text>
      ))}
    </svg>
  )
}

/** A single-series daily bar chart with a baseline and a peak tick. */
export function BarChart({
  data,
  color = SERIES_COLORS[0],
  height = 200,
  format = (v) => String(Math.round(v)),
  ariaLabel,
}: {
  data: { label: string; value: number }[]
  color?: string
  height?: number
  format?: (v: number) => string
  ariaLabel?: string
}) {
  const W = 760
  const H = height
  const left = 8
  const right = W - 8
  const top = 14
  const bottom = H - 26
  const n = data.length
  const peak = niceMax(Math.max(0, ...data.map((d) => d.value)))
  const slot = n > 0 ? (right - left) / n : 0
  const bw = Math.max(1, Math.min(28, slot * 0.62))
  const y = (v: number) => bottom - (v / peak) * (bottom - top)
  const xTicks = tickIndexes(n)

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      width="100%"
      role="img"
      aria-label={ariaLabel}
      preserveAspectRatio="none"
      style={{ display: 'block', overflow: 'visible' }}>
      <text x={left} y={top - 4} className="font-hand" fontSize={12} fill={TICK}>
        {format(peak)}
      </text>
      {data.map((d, i) => {
        const cx = left + slot * (i + 0.5)
        const h = bottom - y(d.value)
        return (
          <rect
            key={i}
            x={cx - bw / 2}
            y={y(d.value)}
            width={bw}
            height={Math.max(0, h)}
            rx={3}
            fill={color}
          />
        )
      })}
      <line x1={left} y1={bottom} x2={right} y2={bottom} stroke={BASELINE} strokeWidth={1.5} />
      {xTicks.map((i) => (
        <text
          key={i}
          x={left + slot * (i + 0.5)}
          y={bottom + 16}
          textAnchor="middle"
          className="font-hand"
          fontSize={12}
          fill={TICK}>
          {data[i]?.label ?? ''}
        </text>
      ))}
    </svg>
  )
}

/** A tiny trend line for a stat tile. One polyline, filled sliver underneath. */
export function Sparkline({
  values,
  width = 120,
  height = 28,
  color = SERIES_COLORS[0],
}: {
  values: number[]
  width?: number
  height?: number
  color?: string
}) {
  const gradId = useId()
  const pad = 2
  const n = values.length
  const min = Math.min(0, ...values)
  const max = Math.max(1, ...values)
  const span = max - min || 1
  const x = (i: number) => (n <= 1 ? pad : pad + (i / (n - 1)) * (width - pad * 2))
  const y = (v: number) => height - pad - ((v - min) / span) * (height - pad * 2)
  if (n === 0) return <svg width={width} height={height} aria-hidden="true" />
  const line = values.map((v, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(' ')
  const area = `${line} L ${x(n - 1).toFixed(1)} ${height - pad} L ${x(0).toFixed(1)} ${height - pad} Z`
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true" style={{ display: 'block' }}>
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.22} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gradId})`} stroke="none" />
      <path d={line} fill="none" stroke={color} strokeWidth={1.75} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}

/** Evenly-spaced tick indexes (first, last, and a few between). */
function tickIndexes(n: number): number[] {
  if (n <= 1) return n === 1 ? [0] : []
  const want = Math.min(6, n)
  const step = (n - 1) / (want - 1)
  const set = new Set<number>()
  for (let k = 0; k < want; k++) set.add(Math.round(k * step))
  return [...set].sort((a, b) => a - b)
}
