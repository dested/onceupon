import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { StickerButton } from '~/ui/bits'
import { MODEL_OPTIONS } from '~/llm/models'
import type { Campaign } from '../campaign'
import { loadCases, loadRounds } from '../store'
import type { CampaignConfig, LabCase, RoundSummary } from '../types'
import { CategorySmallMultiples, OverallTrend, TokensLatencyTrend } from './charts'
import { Chip, InlineConfirm, errText, fmtMs, fmtNum, fmtPct, fmtUsd, useLoader } from './common'
import { useToast } from './toast'

export function CampaignTab({ campaign }: { campaign: Campaign }) {
  const toast = useToast()
  const state = campaign.state
  const progress = campaign.progress
  const running = state.status === 'running'
  const idleish = state.status === 'idle' || state.status === 'stopped' || state.status === 'done'

  const [draft, setDraft] = useState<CampaignConfig>(state.config)
  const [rejudging, setRejudging] = useState<string | null>(null)
  const cases = useLoader<LabCase[]>(
    () => loadCases(),
    [],
    (e) => toast.push(e)
  )
  const rounds = useLoader<RoundSummary[]>(
    () => loadRounds(),
    [],
    (e) => toast.push(e)
  )
  const logRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    rounds.refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.updatedAt, progress.done, progress.roundId])

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight })
  }, [state.log.length])

  const allCategories = useMemo(() => {
    const set = new Set<string>()
    for (const c of cases.data ?? []) set.add(c.category)
    return [...set].sort()
  }, [cases.data])

  // Which cases the current caseIds selection covers, expressed as category/tier toggles.
  const selection = useMemo(
    () => deriveSelection(cases.data ?? [], draft.caseIds),
    [cases.data, draft.caseIds]
  )

  function setSelection(cats: Set<string>, tiers: Set<'subject' | 'action'>) {
    const all = cases.data ?? []
    const chosen = all.filter((c) => cats.has(c.category) && tiers.has(c.tier))
    const isAll = chosen.length === all.length && all.length > 0
    setDraft((d) => ({ ...d, caseIds: isAll ? null : chosen.map((c) => c.id) }))
  }

  const selectedCount = draft.caseIds === null ? (cases.data?.length ?? 0) : draft.caseIds.length

  function num<K extends keyof CampaignConfig>(key: K, value: number) {
    setDraft((d) => ({ ...d, [key]: value }))
  }

  async function onStart() {
    try {
      campaign.setConfig(draft)
      await campaign.start()
    } catch (e) {
      toast.push(errText(e))
    }
  }
  async function onResume() {
    try {
      await campaign.resume()
    } catch (e) {
      toast.push(errText(e))
    }
  }

  async function onRejudge(rid: string) {
    setRejudging(rid)
    try {
      await campaign.rejudge(rid)
      rounds.refresh()
    } catch (e) {
      toast.push(errText(e))
    } finally {
      setRejudging(null)
    }
  }

  const bestRound = rounds.data?.find((r) => r.id === state.bestRoundId) ?? null

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[22rem_minmax(0,1fr)]">
        {/* config */}
        <div className="border-ink bg-paper flex flex-col gap-3 rounded-2xl border-[3px] p-4 shadow-[3px_4px_0_0_rgba(59,47,47,0.25)]">
          <h2 className="font-scrawl text-xl">campaign config</h2>
          <datalist id="lab-models">
            {MODEL_OPTIONS.map((m) => (
              <option key={m.id} value={m.id} />
            ))}
          </datalist>
          {(
            [
              ['drawModel', 'draw model'],
              ['judgeModel', 'judge model'],
              ['editorModel', 'editor model'],
              ['blindModel', 'blind model'],
            ] as const
          ).map(([key, label]) => (
            <label key={key} className="flex items-center justify-between gap-2">
              <span className="text-ink-soft text-sm">{label}</span>
              <input
                list="lab-models"
                disabled={running}
                value={draft[key]}
                onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))}
                className="border-ink bg-paper w-52 rounded-lg border-2 px-2 py-1 text-sm"
              />
            </label>
          ))}
          <div className="grid grid-cols-2 gap-2">
            <NumField
              label="samples"
              value={draft.samples}
              min={1}
              max={3}
              step={1}
              disabled={running}
              onChange={(v) => num('samples', v)}
            />
            <NumField
              label="concurrency"
              value={draft.concurrency}
              min={1}
              max={8}
              step={1}
              disabled={running}
              onChange={(v) => num('concurrency', v)}
            />
            <NumField
              label="max rounds"
              value={draft.maxRounds}
              min={1}
              step={1}
              disabled={running}
              onChange={(v) => num('maxRounds', v)}
            />
            <NumField
              label="budget $"
              value={draft.budgetUsd}
              min={1}
              step={1}
              disabled={running}
              onChange={(v) => num('budgetUsd', v)}
            />
            <NumField
              label="keep Δ"
              value={draft.keepMinDelta}
              step={0.1}
              disabled={running}
              onChange={(v) => num('keepMinDelta', v)}
            />
            <NumField
              label="prompt growth"
              value={draft.maxPromptGrowth}
              step={0.05}
              disabled={running}
              onChange={(v) => num('maxPromptGrowth', v)}
            />
            <NumField
              label="output growth"
              value={draft.maxOutputGrowth}
              step={0.05}
              disabled={running}
              onChange={(v) => num('maxOutputGrowth', v)}
            />
          </div>

          <div>
            <div className="mb-1 flex items-center justify-between">
              <span className="text-ink-soft text-sm">cases ({selectedCount})</span>
              <button
                disabled={running}
                className="text-sm underline disabled:opacity-40"
                onClick={() => setDraft((d) => ({ ...d, caseIds: null }))}>
                all
              </button>
            </div>
            <div className="mb-2 flex gap-2">
              {(['subject', 'action'] as const).map((t) => (
                <label key={t} className="flex items-center gap-1 text-sm">
                  <input
                    type="checkbox"
                    disabled={running}
                    checked={selection.tiers.has(t)}
                    onChange={(e) => {
                      const tiers = new Set(selection.tiers)
                      if (e.target.checked) tiers.add(t)
                      else tiers.delete(t)
                      setSelection(selection.cats, tiers)
                    }}
                  />
                  {t}
                </label>
              ))}
            </div>
            <div className="flex flex-wrap gap-1">
              {allCategories.map((cat) => {
                const on = selection.cats.has(cat)
                return (
                  <button
                    key={cat}
                    disabled={running}
                    onClick={() => {
                      const cats = new Set(selection.cats)
                      if (on) cats.delete(cat)
                      else cats.add(cat)
                      setSelection(cats, selection.tiers)
                    }}
                    className={`border-ink rounded-full border-2 px-2 py-0.5 text-xs disabled:opacity-40 ${
                      on ? 'bg-crayon-yellow' : 'bg-paper'
                    }`}>
                    {cat}
                  </button>
                )
              })}
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {idleish ? (
              <StickerButton tone="green" onClick={() => void onStart()}>
                start
              </StickerButton>
            ) : null}
            {running ? (
              <StickerButton tone="yellow" onClick={() => campaign.pause()}>
                pause
              </StickerButton>
            ) : null}
            {state.status === 'paused' ? (
              <StickerButton tone="green" onClick={() => void onResume()}>
                resume
              </StickerButton>
            ) : null}
            {running || state.status === 'paused' ? (
              <InlineConfirm
                label="stop"
                confirmLabel="stop, sure?"
                onConfirm={() => campaign.stop()}
              />
            ) : null}
          </div>
        </div>

        {/* status + log */}
        <div className="flex flex-col gap-3">
          <div className="border-ink bg-paper rounded-2xl border-[3px] p-4 shadow-[3px_4px_0_0_rgba(59,47,47,0.25)]">
            <div className="flex flex-wrap items-center gap-2">
              <Chip tone={running ? 'green' : state.status === 'paused' ? 'yellow' : 'soft'}>
                {state.status}
              </Chip>
              <span className="text-lg">
                {progress.roundId ?? '—'} · {progress.done}/{progress.planned} ·{' '}
                {fmtUsd(state.spentUsd)} of ${state.config.budgetUsd} · best v{state.bestVersion}
                {bestRound?.meanOverall !== null && bestRound?.meanOverall !== undefined
                  ? ` (${fmtNum(bestRound.meanOverall)})`
                  : ''}
              </span>
            </div>
            {progress.lastError ? (
              <p className="text-crayon-red mt-2 text-sm">last error: {progress.lastError}</p>
            ) : null}
            {progress.active.length > 0 ? (
              <div className="mt-2 flex flex-wrap gap-1">
                {progress.active.map((p) => (
                  <Chip key={p} tone="ink">
                    {p}
                  </Chip>
                ))}
              </div>
            ) : null}
          </div>

          <div
            ref={logRef}
            className="bg-ink/90 text-paper h-48 overflow-y-auto rounded-2xl p-3 font-mono text-[11px] leading-relaxed">
            {state.log.length === 0 ? (
              <span className="text-paper-deep">no log yet</span>
            ) : (
              state.log.map((line, i) => <div key={i}>{line}</div>)
            )}
          </div>
        </div>
      </div>

      {/* rounds table */}
      <div className="border-ink bg-paper overflow-x-auto rounded-2xl border-[3px] p-3 shadow-[3px_4px_0_0_rgba(59,47,47,0.25)]">
        <h2 className="font-scrawl mb-2 text-xl">rounds</h2>
        {rounds.data && rounds.data.length > 0 ? (
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="text-ink-soft border-ink border-b-2 text-left">
                <Th>id</Th>
                <Th>v</Th>
                <Th>n</Th>
                <Th>overall</Th>
                <Th>recog</Th>
                <Th>blind-yes</Th>
                <Th>major</Th>
                <Th>out tok</Th>
                <Th>first ms</Th>
                <Th>cost</Th>
                <Th>kept</Th>
                <Th>verdict</Th>
                <Th>judge</Th>
              </tr>
            </thead>
            <tbody>
              {rounds.data.map((r) => (
                <tr key={r.id} className="border-ink/15 border-b">
                  <Td>{r.id}</Td>
                  <Td>v{r.promptVersion}</Td>
                  <Td>
                    {r.done}/{r.planned}
                  </Td>
                  <Td>{fmtNum(r.meanOverall)}</Td>
                  <Td>{fmtNum(r.meanRecognizable, 2)}</Td>
                  <Td>{fmtPct(r.blindYesRate)}</Td>
                  <Td>{r.majorIssues}</Td>
                  <Td>{fmtNum(r.meanOutputTokens, 0)}</Td>
                  <Td>{fmtMs(r.meanFirstTokenMs)}</Td>
                  <Td>{fmtUsd(r.drawCostUsd + r.judgeCostUsd)}</Td>
                  <Td>{r.kept === null ? '—' : r.kept ? '✓' : '✗'}</Td>
                  <Td className="max-w-[18rem] truncate" title={r.verdict}>
                    {r.verdict}
                  </Td>
                  <Td>
                    {(r.judged ?? 0) < r.done ? (
                      <button
                        disabled={rejudging !== null}
                        onClick={() => void onRejudge(r.id)}
                        title={`${r.judged ?? 0}/${r.done} judged — run the judge on the rest`}
                        className="border-ink bg-paper rounded-lg border-2 px-2 py-0.5 text-xs whitespace-nowrap disabled:opacity-40">
                        {rejudging === r.id
                          ? 'judging…'
                          : `judge ${r.done - (r.judged ?? 0)} missing`}
                      </button>
                    ) : (
                      <span className="text-ink-soft text-xs">✓</span>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="text-ink-soft text-sm">no rounds yet; start a campaign</p>
        )}
      </div>

      {rounds.data && rounds.data.length > 0 ? (
        <div className="flex flex-wrap gap-4">
          <OverallTrend rounds={rounds.data} />
          <TokensLatencyTrend rounds={rounds.data} />
          <CategorySmallMultiples rounds={rounds.data} />
        </div>
      ) : null}
    </div>
  )
}

function deriveSelection(
  cases: LabCase[],
  caseIds: string[] | null
): { cats: Set<string>; tiers: Set<'subject' | 'action'> } {
  if (caseIds === null) {
    return { cats: new Set(cases.map((c) => c.category)), tiers: new Set(['subject', 'action']) }
  }
  const ids = new Set(caseIds)
  const chosen = cases.filter((c) => ids.has(c.id))
  return { cats: new Set(chosen.map((c) => c.category)), tiers: new Set(chosen.map((c) => c.tier)) }
}

function NumField({
  label,
  value,
  min,
  max,
  step,
  disabled,
  onChange,
}: {
  label: string
  value: number
  min?: number
  max?: number
  step?: number
  disabled?: boolean
  onChange: (v: number) => void
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-ink-soft text-xs">{label}</span>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        onChange={(e) => {
          const v = Number(e.target.value)
          if (!Number.isNaN(v)) onChange(v)
        }}
        className="border-ink bg-paper rounded-lg border-2 px-2 py-1 text-sm"
      />
    </label>
  )
}

function Th({ children }: { children: ReactNode }) {
  return <th className="px-2 py-1 font-normal">{children}</th>
}
function Td({
  children,
  className = '',
  title,
}: {
  children: ReactNode
  className?: string
  title?: string
}) {
  return (
    <td className={`px-2 py-1 ${className}`} title={title}>
      {children}
    </td>
  )
}
