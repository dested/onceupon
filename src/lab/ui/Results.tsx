import { useEffect, useMemo, useState } from 'react'
import { imageUrl } from '../api'
import { loadCaseResults, loadCases, loadRounds } from '../store'
import type { CaseResult, LabCase, RoundSummary } from '../types'
import { Chip, OverallChip, useLoader } from './common'
import { DetailDrawer } from './DetailDrawer'
import { useToast } from './toast'

const key = (r: CaseResult): string => `${r.draw.caseId}-${r.draw.sample}`
const majors = (r: CaseResult): number =>
  r.critique?.issues.filter((i) => i.severity === 'major').length ?? 0

export function Results({ defaultRoundId }: { defaultRoundId: string | null }) {
  const toast = useToast()
  const rounds = useLoader<RoundSummary[]>(
    () => loadRounds(),
    [],
    (e) => toast.push(e)
  )
  const cases = useLoader<LabCase[]>(
    () => loadCases(),
    [],
    (e) => toast.push(e)
  )

  const [roundId, setRoundId] = useState<string | null>(null)
  const [compareId, setCompareId] = useState<string>('')
  const [cat, setCat] = useState<string>('all')
  const [tier, setTier] = useState<string>('all')
  const [onlyReg, setOnlyReg] = useState(false)
  const [detail, setDetail] = useState<CaseResult | null>(null)

  useEffect(() => {
    if (roundId !== null || !rounds.data || rounds.data.length === 0) return
    const fallback = rounds.data[rounds.data.length - 1]?.id ?? null
    setRoundId(defaultRoundId ?? fallback)
  }, [rounds.data, defaultRoundId, roundId])

  const primary = useLoader<CaseResult[]>(
    () => (roundId ? loadCaseResults(roundId) : Promise.resolve([])),
    [roundId],
    (e) => toast.push(e)
  )
  const compare = useLoader<CaseResult[]>(
    () => (compareId ? loadCaseResults(compareId) : Promise.resolve([])),
    [compareId],
    (e) => toast.push(e)
  )

  const caseMap = useMemo(() => {
    const m = new Map<string, LabCase>()
    for (const c of cases.data ?? []) m.set(c.id, c)
    return m
  }, [cases.data])

  const catOptions = useMemo(() => {
    const set = new Set<string>()
    for (const c of cases.data ?? []) set.add(c.category)
    return [...set].sort()
  }, [cases.data])

  const compareMap = useMemo(() => {
    const m = new Map<string, CaseResult>()
    for (const r of compare.data ?? []) m.set(key(r), r)
    return m
  }, [compare.data])

  const comparing = compareId !== ''

  const rows = useMemo(() => {
    const list = (primary.data ?? []).slice().sort((a, b) => {
      const ao = a.critique?.overall ?? -1
      const bo = b.critique?.overall ?? -1
      return ao - bo
    })
    return list.filter((r) => {
      const c = caseMap.get(r.draw.caseId)
      if (cat !== 'all' && c?.category !== cat) return false
      if (tier !== 'all' && c?.tier !== tier) return false
      if (comparing && onlyReg) {
        const other = compareMap.get(key(r))
        const delta = (r.critique?.overall ?? 0) - (other?.critique?.overall ?? 0)
        if (delta >= 0) return false
      }
      return true
    })
  }, [primary.data, caseMap, cat, tier, comparing, onlyReg, compareMap])

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <Select
          label="round"
          value={roundId ?? ''}
          onChange={setRoundId}
          options={rounds.data ?? []}
          defaultRoundId={defaultRoundId}
        />
        <label className="flex flex-col gap-1">
          <span className="text-ink-soft text-sm">compare with</span>
          <select
            value={compareId}
            onChange={(e) => setCompareId(e.target.value)}
            className="border-ink bg-paper rounded-xl border-[3px] px-3 py-2 text-base">
            <option value="">none</option>
            {(rounds.data ?? []).map((r) => (
              <option key={r.id} value={r.id}>
                {r.id} · v{r.promptVersion}
              </option>
            ))}
          </select>
        </label>
        <Filter label="category" value={cat} onChange={setCat} options={catOptions} />
        <Filter label="tier" value={tier} onChange={setTier} options={['subject', 'action']} />
        {comparing ? (
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={onlyReg}
              onChange={(e) => setOnlyReg(e.target.checked)}
            />
            only regressions
          </label>
        ) : null}
      </div>

      {rows.length === 0 ? (
        <p className="text-ink-soft">no results for this round yet</p>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(13rem,1fr))] gap-3">
          {rows.map((r) => {
            const other = comparing ? compareMap.get(key(r)) : undefined
            const overall = r.critique?.overall ?? null
            const otherOverall = other?.critique?.overall ?? null
            const delta = overall !== null && otherOverall !== null ? overall - otherOverall : null
            return (
              <button
                key={key(r)}
                onClick={() => setDetail(r)}
                className="border-ink bg-paper flex flex-col gap-1 rounded-2xl border-[3px] p-2 text-left shadow-[2px_3px_0_0_rgba(59,47,47,0.2)]">
                {comparing && other ? (
                  <div className="grid grid-cols-2 gap-1">
                    <img
                      src={imageUrl(other.draw.imagePath)}
                      alt="before"
                      className="border-ink aspect-[16/10] w-full rounded-lg border-2 object-cover opacity-80"
                    />
                    <img
                      src={imageUrl(r.draw.imagePath)}
                      alt={r.draw.phrase}
                      className="border-ink aspect-[16/10] w-full rounded-lg border-2 object-cover"
                    />
                  </div>
                ) : (
                  <img
                    src={imageUrl(r.draw.imagePath)}
                    alt={r.draw.phrase}
                    className="border-ink aspect-[16/10] w-full rounded-lg border-2 object-cover"
                  />
                )}
                <div className="flex items-center justify-between gap-1">
                  <span className="truncate text-base" title={r.draw.phrase}>
                    {r.draw.phrase}
                  </span>
                  <OverallChip overall={overall} />
                </div>
                <div className="text-ink-soft flex items-center gap-2 text-xs">
                  <span className="text-crayon-yellow">
                    {'★'.repeat(r.critique?.recognizable ?? 0)}
                  </span>
                  {majors(r) > 0 ? <Chip tone="red">{majors(r)} major</Chip> : <span>clean</span>}
                  {delta !== null ? (
                    <Chip tone={delta > 0 ? 'green' : delta < 0 ? 'red' : 'soft'}>
                      {delta > 0 ? '+' : ''}
                      {delta}
                    </Chip>
                  ) : null}
                </div>
              </button>
            )
          })}
        </div>
      )}

      <DetailDrawer result={detail} onClose={() => setDetail(null)} />
    </div>
  )
}

function Select({
  label,
  value,
  onChange,
  options,
  defaultRoundId,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  options: RoundSummary[]
  defaultRoundId: string | null
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-ink-soft text-sm">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="border-ink bg-paper rounded-xl border-[3px] px-3 py-2 text-base">
        {options.map((r) => (
          <option key={r.id} value={r.id}>
            {r.id} · v{r.promptVersion}
            {r.id === defaultRoundId ? ' (best)' : ''}
          </option>
        ))}
      </select>
    </label>
  )
}

function Filter({
  label,
  value,
  onChange,
  options,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  options: string[]
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-ink-soft text-sm">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="border-ink bg-paper rounded-xl border-[3px] px-3 py-2 text-base">
        <option value="all">all</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </label>
  )
}
