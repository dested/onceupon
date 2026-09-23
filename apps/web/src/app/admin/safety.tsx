import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { inferRouterOutputs } from '@trpc/server'
import { useTRPC } from '~/lib/trpc'
import type { AppRouter } from '../../../server/router'
import { PageHeader } from './layout'
import { AsyncBlock, ConfirmButton, DataTable, RangePicker, Section, type Column, useDays } from './parts'
import { BarChart, SERIES_COLORS } from './charts'
import { FIELD, StickerButton } from '~/components/paper'
import { dateTime, dayLabel } from './format'

type Skip = inferRouterOutputs<AppRouter>['admin']['safety']['recentSkips'][number]

export function SafetyPage() {
  const trpc = useTRPC()
  const qc = useQueryClient()
  const [days, setDays] = useDays()
  const [word, setWord] = useState('')
  const query = useQuery(trpc.admin.safety.queryOptions({ days }))

  const invalidate = () => qc.invalidateQueries({ queryKey: trpc.admin.safety.queryKey({ days }) })
  const add = useMutation(trpc.admin.mask.add.mutationOptions({ onSuccess: () => { setWord(''); invalidate() } }))
  const remove = useMutation(trpc.admin.mask.remove.mutationOptions({ onSuccess: invalidate }))

  const skipCols: Column<Skip>[] = [
    { header: 'When', cell: (r) => dateTime(r.createdAt), className: 'whitespace-nowrap' },
    { header: 'Device', cell: (r) => <span className="font-scrawl">{r.deviceCode}</span> },
    { header: 'Words (masked)', cell: (r) => r.skipWords ?? '' },
  ]

  return (
    <>
      <PageHeader title="Kid-safety" right={<RangePicker days={days} onChange={setDays} />} />
      <AsyncBlock query={query}>
        {(d) => (
          <>
            <Section title="Skips per day">
              <div className="rounded-2xl border-[3px] border-ink bg-paper p-4 shadow-[3px_4px_0_0_rgba(59,47,47,0.22)]">
                <BarChart
                  ariaLabel="Skips per day"
                  data={d.skips.map((s) => ({ label: dayLabel(s.day), value: s.count }))}
                  color={SERIES_COLORS[1]}
                />
              </div>
            </Section>

            <Section title="Mask words">
              <form
                onSubmit={(e) => {
                  e.preventDefault()
                  if (word.trim()) add.mutate({ word: word.trim() })
                }}
                className="mb-3 flex flex-wrap gap-2">
                <input
                  className={`${FIELD} max-w-xs`}
                  placeholder="add a word to mask"
                  value={word}
                  onChange={(e) => setWord(e.target.value)}
                />
                <StickerButton type="submit" tone="green" tilt={-1} disabled={add.isPending || word.trim().length === 0}>
                  Add
                </StickerButton>
              </form>
              {d.maskWords.length === 0 ? (
                <p className="font-hand text-lg text-ink-soft">No extra words added</p>
              ) : (
                <ul className="flex flex-wrap gap-2">
                  {d.maskWords.map((w) => (
                    <li key={w}>
                      <ConfirmButton
                        tone="paper"
                        confirmLabel={`remove ${w}?`}
                        disabled={remove.isPending}
                        onConfirm={() => remove.mutate({ word: w })}>
                        {w} ✕
                      </ConfirmButton>
                    </li>
                  ))}
                </ul>
              )}
            </Section>

            <Section title="Recent skips">
              <DataTable columns={skipCols} rows={d.recentSkips} getKey={(r, i) => `${r.createdAt}-${i}`} empty="No skips" />
            </Section>
          </>
        )}
      </AsyncBlock>
    </>
  )
}
