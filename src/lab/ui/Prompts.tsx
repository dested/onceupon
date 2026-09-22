import { useEffect, useMemo, useState } from 'react'
import { StickerButton } from '~/ui/bits'
import { promote } from '../api'
import type { Campaign } from '../campaign'
import { loadPromoted, loadPromptMetas, loadPromptText, loadRounds, savePrompt } from '../store'
import type { PromptMeta, RoundSummary } from '../types'
import { countPromptTokens, diffLines, validatePrompt } from '../prompt-tools'
import { Chip, InlineConfirm, errText, useLoader } from './common'
import { useToast } from './toast'

export function Prompts({
  campaign,
  onSetBest,
}: {
  campaign: Campaign
  onSetBest: (version: number) => Promise<void>
}) {
  const toast = useToast()
  const metas = useLoader<PromptMeta[]>(
    () => loadPromptMetas(),
    [],
    (e) => toast.push(e)
  )
  const promoted = useLoader(
    () => loadPromoted(),
    [],
    (e) => toast.push(e)
  )
  const rounds = useLoader<RoundSummary[]>(
    () => loadRounds(),
    [],
    (e) => toast.push(e)
  )

  const [selected, setSelected] = useState<number | null>(null)
  const [buffer, setBuffer] = useState('')
  const [note, setNote] = useState('')
  const [errors, setErrors] = useState<string[]>([])
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (selected !== null || !metas.data || metas.data.length === 0) return
    setSelected(metas.data[metas.data.length - 1]?.version ?? 0)
  }, [metas.data, selected])

  const selectedMeta = metas.data?.find((m) => m.version === selected) ?? null

  const text = useLoader<string>(
    () => (selected === null ? Promise.resolve('') : loadPromptText(selected)),
    [selected],
    (e) => toast.push(e)
  )
  const parentText = useLoader<string>(
    () =>
      selectedMeta && selectedMeta.parent !== null
        ? loadPromptText(selectedMeta.parent)
        : Promise.resolve(''),
    [selectedMeta?.parent ?? -1],
    (e) => toast.push(e)
  )
  const seedText = useLoader<string>(
    () => loadPromptText(0),
    [],
    (e) => toast.push(e)
  )

  useEffect(() => {
    if (text.data !== null) {
      setBuffer(text.data)
      setErrors([])
    }
  }, [text.data])

  const diff = useMemo(() => {
    if (!selectedMeta || selectedMeta.parent === null) return null
    return diffLines(parentText.data ?? '', buffer)
  }, [selectedMeta, parentText.data, buffer])

  const keptByVersion = useMemo(() => {
    const m = new Map<number, boolean | null>()
    for (const r of rounds.data ?? [])
      if (r.kept !== null || !m.has(r.promptVersion)) m.set(r.promptVersion, r.kept)
    return m
  }, [rounds.data])

  const idle =
    campaign.state.status === 'idle' ||
    campaign.state.status === 'stopped' ||
    campaign.state.status === 'done'

  async function saveNew() {
    if (selected === null) return
    const seed = seedText.data
    if (seed === null) {
      toast.push('seed prompt not loaded yet')
      return
    }
    const check = validatePrompt(buffer, seed)
    if (!check.ok) {
      setErrors(check.errors)
      return
    }
    setErrors([])
    setBusy(true)
    try {
      const model = campaign.state.config.drawModel
      const tokens = await countPromptTokens(buffer, model)
      const meta = await savePrompt(buffer, {
        parent: selected,
        note: note.trim() || 'manual edit',
        rationale: 'edited by hand in the lab',
        tokens,
        source: 'manual',
      })
      setNote('')
      metas.refresh()
      setSelected(meta.version)
      toast.push(`saved v${meta.version} (${tokens} tokens)`, 'ok')
    } catch (e) {
      toast.push(errText(e))
    } finally {
      setBusy(false)
    }
  }

  async function doPromote() {
    if (selected === null) return
    setBusy(true)
    try {
      await promote(selected)
      promoted.refresh()
      toast.push(`promoted v${selected} into src/llm/ops-prompt.ts`, 'ok')
    } catch (e) {
      toast.push(errText(e))
    } finally {
      setBusy(false)
    }
  }

  async function setBest() {
    if (selected === null) return
    setBusy(true)
    try {
      await onSetBest(selected)
      toast.push(`campaign best set to v${selected}`, 'ok')
    } catch (e) {
      toast.push(errText(e))
    } finally {
      setBusy(false)
    }
  }

  const dirty = text.data !== null && buffer !== text.data

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[20rem_minmax(0,1fr)]">
      <div className="border-ink bg-paper flex max-h-[80vh] flex-col gap-1 overflow-y-auto rounded-2xl border-[3px] p-3 shadow-[3px_4px_0_0_rgba(59,47,47,0.25)]">
        <h2 className="font-scrawl mb-1 text-xl">versions</h2>
        {(metas.data ?? []).map((m) => {
          const kept = keptByVersion.get(m.version)
          return (
            <button
              key={m.version}
              onClick={() => setSelected(m.version)}
              className={`border-ink rounded-xl border-2 px-2 py-1 text-left text-sm ${
                m.version === selected ? 'bg-crayon-yellow' : 'bg-paper'
              }`}>
              <div className="flex items-center justify-between gap-1">
                <span>v{String(m.version).padStart(3, '0')}</span>
                <span className="flex gap-1">
                  {m.version === campaign.state.bestVersion ? <Chip tone="green">best</Chip> : null}
                  {m.version === promoted.data?.version ? <Chip tone="ink">promoted</Chip> : null}
                  {kept === true ? (
                    <Chip tone="green">kept</Chip>
                  ) : kept === false ? (
                    <Chip tone="red">reverted</Chip>
                  ) : null}
                </span>
              </div>
              <div className="text-ink-soft truncate">{m.note || '—'}</div>
              <div className="text-ink-soft text-xs">
                {m.source} · {m.tokens ?? '?'} tok · parent {m.parent ?? '—'}
              </div>
            </button>
          )
        })}
      </div>

      <div className="flex flex-col gap-3">
        {selectedMeta ? (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-scrawl text-xl">
                v{String(selectedMeta.version).padStart(3, '0')}
              </h2>
              <Chip>{selectedMeta.source}</Chip>
              <Chip>{selectedMeta.tokens ?? '?'} tokens</Chip>
              {selectedMeta.rationale ? (
                <span className="text-ink-soft text-sm italic">{selectedMeta.rationale}</span>
              ) : null}
            </div>

            <textarea
              value={buffer}
              onChange={(e) => setBuffer(e.target.value)}
              spellCheck={false}
              className="border-ink bg-paper h-[26rem] w-full rounded-xl border-[3px] p-3 font-mono text-xs leading-relaxed"
            />

            {errors.length > 0 ? (
              <ul className="text-crayon-red list-disc pl-5 text-sm">
                {errors.map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
              </ul>
            ) : null}

            <div className="flex flex-wrap items-center gap-2">
              <input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="note for the new version"
                className="border-ink bg-paper w-64 rounded-xl border-2 px-3 py-1.5 text-sm"
              />
              <StickerButton tone="green" onClick={() => void saveNew()} disabled={busy || !dirty}>
                save as new version
              </StickerButton>
              <InlineConfirm
                label="promote to app"
                confirmLabel="rewrites ops-prompt.ts — sure?"
                onConfirm={() => void doPromote()}
                tone="yellow"
                disabled={busy}
              />
              <button
                onClick={() => void setBest()}
                disabled={busy || !idle || selectedMeta.version === campaign.state.bestVersion}
                className="border-ink bg-paper rounded-xl border-2 px-3 py-1.5 text-base disabled:opacity-40"
                title={idle ? '' : 'campaign must be idle'}>
                set as campaign best
              </button>
            </div>

            {diff ? (
              <div className="border-ink bg-paper overflow-x-auto rounded-2xl border-[3px] p-3 shadow-[3px_4px_0_0_rgba(59,47,47,0.25)]">
                <div className="font-scrawl mb-1 text-lg">
                  diff vs parent v{selectedMeta.parent}
                </div>
                <pre className="font-mono text-xs leading-relaxed">
                  {diff.map((d, i) => (
                    <div
                      key={i}
                      className={
                        d.k === 'add'
                          ? 'bg-crayon-green/20 text-ink'
                          : d.k === 'del'
                            ? 'bg-crayon-red/20 text-ink line-through'
                            : 'text-ink-soft'
                      }>
                      {d.k === 'add' ? '+ ' : d.k === 'del' ? '- ' : '  '}
                      {d.line || ' '}
                    </div>
                  ))}
                </pre>
              </div>
            ) : (
              <p className="text-ink-soft text-sm">seed version, no parent to diff against</p>
            )}
          </>
        ) : (
          <p className="text-ink-soft">no prompt versions yet</p>
        )}
      </div>
    </div>
  )
}
