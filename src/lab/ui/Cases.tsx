import { useEffect, useState } from 'react'
import { StickerButton } from '~/ui/bits'
import { DEFAULT_CASES } from '../cases'
import { loadCases, saveCases } from '../store'
import { TIERS, type LabCase } from '../types'
import { Chip, InlineConfirm, errText, useLoader } from './common'
import { useToast } from './toast'

export function Cases() {
  const toast = useToast()
  const loaded = useLoader<LabCase[]>(
    () => loadCases(),
    [],
    (e) => toast.push(e)
  )
  const [rows, setRows] = useState<LabCase[]>([])
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (loaded.data) setRows(loaded.data)
  }, [loaded.data])

  const dirty = JSON.stringify(rows) !== JSON.stringify(loaded.data ?? [])

  function edit(i: number, patch: Partial<LabCase>) {
    setRows((list) => list.map((c, idx) => (idx === i ? { ...c, ...patch } : c)))
  }
  function remove(i: number) {
    setRows((list) => list.filter((_, idx) => idx !== i))
  }
  function add() {
    setRows((list) => [...list, { id: '', phrase: '', tier: 'subject', category: '', expect: [] }])
  }

  async function save() {
    setBusy(true)
    try {
      await saveCases(rows)
      loaded.refresh()
      toast.push('cases saved', 'ok')
    } catch (e) {
      toast.push(errText(e))
    } finally {
      setBusy(false)
    }
  }

  async function reset() {
    setBusy(true)
    try {
      await saveCases(DEFAULT_CASES)
      loaded.refresh()
      setRows(DEFAULT_CASES)
      toast.push('cases reset to defaults', 'ok')
    } catch (e) {
      toast.push(errText(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <StickerButton tone="green" onClick={() => void save()} disabled={busy || !dirty}>
          save cases
        </StickerButton>
        <StickerButton onClick={add} disabled={busy}>
          add row
        </StickerButton>
        <InlineConfirm
          label="reset to defaults"
          confirmLabel="reset all — sure?"
          onConfirm={() => void reset()}
          disabled={busy}
        />
        <Chip tone="soft">{rows.length} cases</Chip>
        {dirty ? <Chip tone="yellow">unsaved</Chip> : null}
      </div>

      <div className="border-ink bg-paper overflow-x-auto rounded-2xl border-[3px] p-3 shadow-[3px_4px_0_0_rgba(59,47,47,0.25)]">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="text-ink-soft border-ink border-b-2 text-left">
              <th className="px-2 py-1 font-normal">id</th>
              <th className="px-2 py-1 font-normal">phrase</th>
              <th className="px-2 py-1 font-normal">tier</th>
              <th className="px-2 py-1 font-normal">category</th>
              <th className="px-2 py-1 font-normal">expect (one per line)</th>
              <th className="px-2 py-1 font-normal"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c, i) => (
              <tr key={i} className="border-ink/15 border-b align-top">
                <td className="px-2 py-1">
                  <input
                    value={c.id}
                    onChange={(e) => edit(i, { id: e.target.value })}
                    className="border-ink bg-paper w-28 rounded border px-1 py-0.5 font-mono text-xs"
                  />
                </td>
                <td className="px-2 py-1">
                  <input
                    value={c.phrase}
                    onChange={(e) => edit(i, { phrase: e.target.value })}
                    className="border-ink bg-paper w-48 rounded border px-1 py-0.5"
                  />
                </td>
                <td className="px-2 py-1">
                  <select
                    value={c.tier}
                    onChange={(e) => {
                      const t = TIERS.find((x) => x === e.target.value)
                      if (t) edit(i, { tier: t })
                    }}
                    className="border-ink bg-paper rounded border px-1 py-0.5">
                    {TIERS.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="px-2 py-1">
                  <input
                    value={c.category}
                    onChange={(e) => edit(i, { category: e.target.value })}
                    className="border-ink bg-paper w-32 rounded border px-1 py-0.5"
                  />
                </td>
                <td className="px-2 py-1">
                  <textarea
                    value={c.expect.join('\n')}
                    onChange={(e) =>
                      edit(i, {
                        expect: e.target.value.split('\n').filter((l) => l.trim().length > 0),
                      })
                    }
                    rows={Math.max(2, c.expect.length)}
                    className="border-ink bg-paper w-96 rounded border px-1 py-0.5 text-xs"
                  />
                </td>
                <td className="px-2 py-1">
                  <InlineConfirm label="del" confirmLabel="sure?" onConfirm={() => remove(i)} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
