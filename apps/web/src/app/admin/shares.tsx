import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { inferRouterOutputs } from '@trpc/server'
import { useTRPC } from '~/lib/trpc'
import type { AppRouter } from '../../../server/router'
import { PageHeader } from './layout'
import { AsyncBlock, ConfirmButton, DataTable, Pill, RangePicker, Section, type Column, useDays } from './parts'
import { BarChart, SERIES_COLORS } from './charts'
import { count, dayLabel, relative, shortDate } from './format'

type ShareRow = inferRouterOutputs<AppRouter>['admin']['shares']['list']['rows'][number]

export function SharesPage() {
  const trpc = useTRPC()
  const qc = useQueryClient()
  const [days, setDays] = useDays()
  const query = useQuery(trpc.admin.shares.list.queryOptions({ days }))
  const unpublish = useMutation(
    trpc.admin.shares.unpublish.mutationOptions({
      onSuccess: () => qc.invalidateQueries({ queryKey: trpc.admin.shares.list.queryKey({ days }) }),
    })
  )

  const cols: Column<ShareRow>[] = [
    { header: 'Title', cell: (r) => r.title || 'untitled' },
    { header: 'Child', cell: (r) => r.childName ?? '' },
    { header: 'Device', cell: (r) => <span className="font-scrawl">{r.deviceCode}</span> },
    { header: 'Voice', cell: (r) => (r.hasVoice ? <Pill tone="lilac">voice</Pill> : '') },
    { header: 'Views', align: 'right', cell: (r) => count(r.views) },
    { header: 'Downloads', align: 'right', cell: (r) => count(r.downloads) },
    { header: 'Installs', align: 'right', cell: (r) => count(r.installs) },
    { header: 'Created', cell: (r) => relative(r.createdAt) },
    { header: 'Expires', cell: (r) => shortDate(r.expiresAt) },
    {
      header: '',
      align: 'right',
      cell: (r) =>
        r.unpublishedAt ? (
          <Pill tone="red">unpublished</Pill>
        ) : (
          <span className="flex justify-end gap-2">
            <a
              href={`/s/${r.id}`}
              target="_blank"
              rel="noreferrer"
              className="rounded-xl border-[3px] border-ink bg-crayon-blue px-3 py-1.5 font-hand text-base leading-none text-white shadow-[2px_3px_0_0_rgba(59,47,47,0.3)]">
              Open
            </a>
            <ConfirmButton
              tone="red"
              confirmLabel="unpublish?"
              disabled={unpublish.isPending}
              onConfirm={() => unpublish.mutate({ id: r.id })}>
              Unpublish
            </ConfirmButton>
          </span>
        ),
    },
  ]

  return (
    <>
      <PageHeader title="Shares" right={<RangePicker days={days} onChange={setDays} />} />
      <AsyncBlock query={query}>
        {(d) => (
          <>
            <Section title="Shares created per day">
              <div className="rounded-2xl border-[3px] border-ink bg-paper p-4 shadow-[3px_4px_0_0_rgba(59,47,47,0.22)]">
                <BarChart
                  ariaLabel="Shares created per day"
                  data={d.daily.map((x) => ({ label: dayLabel(x.day), value: x.created }))}
                  color={SERIES_COLORS[3]}
                />
              </div>
            </Section>
            <Section title="Share pages">
              <DataTable columns={cols} rows={d.rows} getKey={(r) => r.id} empty="No shares yet" />
            </Section>
          </>
        )}
      </AsyncBlock>
    </>
  )
}
