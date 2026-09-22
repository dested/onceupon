import type { ReactNode } from 'react'
import type { RoundSummary } from '../types'

const INK = '#3b2f2f'
const SOFT = '#8a7a6a'
const BLUE = '#3b82f6'
const GREEN = '#22c55e'
const RED = '#ef4444'

interface Pt {
  x: number
  y: number
}

/** Map a data series onto an SVG box with a left/bottom axis gutter. */
function project(
  values: Array<number | null>,
  w: number,
  h: number,
  yMin: number,
  yMax: number
): Array<Pt | null> {
  const padL = 34
  const padB = 20
  const padT = 8
  const padR = 8
  const span = Math.max(1, values.length - 1)
  const range = yMax - yMin || 1
  return values.map((v, i) => {
    if (v === null) return null
    const x = padL + (values.length === 1 ? (w - padL - padR) / 2 : ((w - padL - padR) * i) / span)
    const y = padT + (h - padT - padB) * (1 - (v - yMin) / range)
    return { x, y }
  })
}

function Axes({
  w,
  h,
  yMin,
  yMax,
  ticks,
}: {
  w: number
  h: number
  yMin: number
  yMax: number
  ticks: number
}) {
  const padL = 34
  const padB = 20
  const padT = 8
  const rows = Array.from({ length: ticks + 1 }, (_, i) => yMin + ((yMax - yMin) * i) / ticks)
  return (
    <g>
      <line x1={padL} y1={padT} x2={padL} y2={h - padB} stroke={INK} strokeWidth={1.5} />
      <line x1={padL} y1={h - padB} x2={w - 6} y2={h - padB} stroke={INK} strokeWidth={1.5} />
      {rows.map((r, i) => {
        const y = padT + (h - padT - padB) * (1 - (r - yMin) / (yMax - yMin || 1))
        return (
          <g key={i}>
            <line
              x1={padL - 3}
              y1={y}
              x2={w - 6}
              y2={y}
              stroke={SOFT}
              strokeWidth={0.5}
              strokeDasharray="2 3"
            />
            <text
              x={padL - 5}
              y={y + 3}
              textAnchor="end"
              fontSize={9}
              fill={SOFT}
              fontFamily="'Patrick Hand', cursive">
              {Math.round(r)}
            </text>
          </g>
        )
      })}
    </g>
  )
}

function polyline(pts: Array<Pt | null>, stroke: string): string {
  return pts
    .filter((p): p is Pt => p !== null)
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
    .join(' ')
}

function ChartFrame({
  title,
  children,
  width = 460,
  height = 200,
}: {
  title: string
  children: ReactNode
  width?: number
  height?: number
}) {
  return (
    <div className="border-ink bg-paper rounded-2xl border-[3px] p-3 shadow-[3px_4px_0_0_rgba(59,47,47,0.25)]">
      <div className="font-scrawl mb-1 text-lg">{title}</div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        className="block"
        role="img"
        aria-label={title}>
        {children}
      </svg>
    </div>
  )
}

/** Mean overall per round; kept rounds solid dots, reverted hollow, baseline a square. */
export function OverallTrend({ rounds }: { rounds: RoundSummary[] }) {
  const w = 460
  const h = 200
  if (rounds.length === 0) return null
  const vals = rounds.map((r) => r.meanOverall)
  const pts = project(vals, w, h, 0, 100)
  return (
    <ChartFrame title="mean overall per round">
      <Axes w={w} h={h} yMin={0} yMax={100} ticks={4} />
      <path
        d={polyline(pts, INK)}
        fill="none"
        stroke={INK}
        strokeWidth={2}
        strokeLinejoin="round"
      />
      {pts.map((p, i) => {
        if (!p) return null
        const r = rounds[i]
        if (!r) return null
        if (r.kept === null) {
          return (
            <rect
              key={i}
              x={p.x - 4}
              y={p.y - 4}
              width={8}
              height={8}
              fill={BLUE}
              stroke={INK}
              strokeWidth={1.5}
            />
          )
        }
        if (r.kept) {
          return (
            <circle key={i} cx={p.x} cy={p.y} r={4.5} fill={GREEN} stroke={INK} strokeWidth={1.5} />
          )
        }
        return (
          <circle key={i} cx={p.x} cy={p.y} r={4.5} fill="#fbf6ea" stroke={RED} strokeWidth={2} />
        )
      })}
      {pts.map((p, i) => {
        const r = rounds[i]
        if (!p || !r) return null
        return (
          <text
            key={`l${i}`}
            x={p.x}
            y={h - 6}
            textAnchor="middle"
            fontSize={9}
            fill={SOFT}
            fontFamily="'Patrick Hand', cursive">
            {r.id}
          </text>
        )
      })}
    </ChartFrame>
  )
}

/** Mean output tokens and first-token ms per round, each on its own scale. */
export function TokensLatencyTrend({ rounds }: { rounds: RoundSummary[] }) {
  const w = 460
  const h = 200
  if (rounds.length === 0) return null
  const tok = rounds.map((r) => r.meanOutputTokens)
  const ms = rounds.map((r) => r.meanFirstTokenMs)
  const tokMax = Math.max(1, ...tok.map((v) => v ?? 0))
  const msMax = Math.max(1, ...ms.map((v) => v ?? 0))
  const tokPts = project(tok, w, h, 0, tokMax)
  const msPts = project(ms, w, h, 0, msMax)
  return (
    <ChartFrame title="output tokens and first-token latency">
      <line x1={34} y1={8} x2={34} y2={h - 20} stroke={INK} strokeWidth={1.5} />
      <line x1={34} y1={h - 20} x2={w - 6} y2={h - 20} stroke={INK} strokeWidth={1.5} />
      <path
        d={polyline(tokPts, BLUE)}
        fill="none"
        stroke={BLUE}
        strokeWidth={2}
        strokeLinejoin="round"
      />
      <path
        d={polyline(msPts, RED)}
        fill="none"
        stroke={RED}
        strokeWidth={2}
        strokeDasharray="5 3"
        strokeLinejoin="round"
      />
      {tokPts.map((p, i) =>
        p ? <circle key={`t${i}`} cx={p.x} cy={p.y} r={3.5} fill={BLUE} /> : null
      )}
      {msPts.map((p, i) =>
        p ? <circle key={`m${i}`} cx={p.x} cy={p.y} r={3.5} fill={RED} /> : null
      )}
      {rounds.map((r, i) => {
        const p = project(tok, w, h, 0, tokMax)[i]
        if (!p) return null
        return (
          <text
            key={`x${i}`}
            x={p.x}
            y={h - 6}
            textAnchor="middle"
            fontSize={9}
            fill={SOFT}
            fontFamily="'Patrick Hand', cursive">
            {r.id}
          </text>
        )
      })}
      <g fontFamily="'Patrick Hand', cursive" fontSize={10}>
        <rect x={44} y={10} width={10} height={4} fill={BLUE} />
        <text x={58} y={14} fill={INK}>
          out tok (max {Math.round(tokMax)})
        </text>
        <rect x={44} y={24} width={10} height={4} fill={RED} />
        <text x={58} y={28} fill={INK}>
          first token ms (max {Math.round(msMax)})
        </text>
      </g>
    </ChartFrame>
  )
}

/** One tiny line of mean overall over rounds, per category. */
export function CategorySmallMultiples({ rounds }: { rounds: RoundSummary[] }) {
  if (rounds.length === 0) return null
  const cats = new Set<string>()
  for (const r of rounds) for (const k of Object.keys(r.byCategory)) cats.add(k)
  const categories = [...cats].sort()
  if (categories.length === 0) return null
  const w = 150
  const h = 84
  return (
    <div className="border-ink bg-paper rounded-2xl border-[3px] p-3 shadow-[3px_4px_0_0_rgba(59,47,47,0.25)]">
      <div className="font-scrawl mb-2 text-lg">mean overall by category</div>
      <div className="flex flex-wrap gap-2">
        {categories.map((cat) => {
          const vals = rounds.map((r) => (cat in r.byCategory ? (r.byCategory[cat] ?? null) : null))
          const pts = project(vals, w, h, 0, 100)
          return (
            <div key={cat} className="border-ink/25 rounded-xl border-2 border-dashed p-1">
              <div className="text-ink-soft mb-0.5 text-xs">{cat}</div>
              <svg
                viewBox={`0 0 ${w} ${h}`}
                width="150"
                height="84"
                role="img"
                aria-label={`${cat} overall`}>
                <line x1={22} y1={6} x2={22} y2={h - 14} stroke={SOFT} strokeWidth={1} />
                <line x1={22} y1={h - 14} x2={w - 4} y2={h - 14} stroke={SOFT} strokeWidth={1} />
                <text
                  x={19}
                  y={12}
                  textAnchor="end"
                  fontSize={8}
                  fill={SOFT}
                  fontFamily="'Patrick Hand', cursive">
                  100
                </text>
                <text
                  x={19}
                  y={h - 14}
                  textAnchor="end"
                  fontSize={8}
                  fill={SOFT}
                  fontFamily="'Patrick Hand', cursive">
                  0
                </text>
                <path
                  d={polyline(pts, INK)}
                  fill="none"
                  stroke={INK}
                  strokeWidth={1.5}
                  strokeLinejoin="round"
                />
                {pts.map((p, i) =>
                  p ? <circle key={i} cx={p.x} cy={p.y} r={2.5} fill={BLUE} /> : null
                )}
              </svg>
            </div>
          )
        })}
      </div>
    </div>
  )
}
