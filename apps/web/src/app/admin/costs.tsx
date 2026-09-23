import { useQuery } from '@tanstack/react-query'
import type { inferRouterOutputs } from '@trpc/server'
import { useTRPC } from '~/lib/trpc'
import type { AppRouter } from '../../../server/router'
import { PageHeader } from './layout'
import { AsyncBlock, DataTable, Pill, RangePicker, Section, StatTile, type Column, useDays } from './parts'
import { BarChart, SERIES_COLORS } from './charts'
import { count, dateTime, dayLabel, money, moneyShort, ms } from './format'

type Call = inferRouterOutputs<AppRouter>['admin']['costs']['calls'][number]
type TopDevice = inferRouterOutputs<AppRouter>['admin']['costs']['topDevices'][number]

export function CostsPage() {
  const trpc = useTRPC()
  const [days, setDays] = useDays()
  const query = useQuery(trpc.admin.costs.queryOptions({ days }))

  const callCols: Column<Call>[] = [
    { header: 'When', cell: (r) => dateTime(r.createdAt), className: 'whitespace-nowrap' },
    { header: 'Device', cell: (r) => <span className="font-scrawl">{r.deviceCode}</span> },
    { header: 'Model', cell: (r) => r.model },
    { header: 'Dialect', cell: (r) => r.dialect },
    { header: 'In', align: 'right', cell: (r) => count(r.inputTokens) },
    { header: 'Cached', align: 'right', cell: (r) => count(r.cachedTokens) },
    { header: 'Out', align: 'right', cell: (r) => count(r.outputTokens) },
    { header: 'Cost', align: 'right', cell: (r) => money(Math.round(r.costCents)) },
    { header: '1st', align: 'right', cell: (r) => ms(r.firstTokenMs) },
    { header: 'Total', align: 'right', cell: (r) => ms(r.totalMs) },
    {
      header: 'Flags',
      cell: (r) => (
        <span className="flex gap-1">
          {r.restart && <Pill tone="yellow">restart</Pill>}
          {r.skip && <Pill tone="red">skip</Pill>}
          {r.error && <Pill tone="red">error</Pill>}
        </span>
      ),
    },
  ]

  const topCols: Column<TopDevice>[] = [
    { header: 'Device', cell: (r) => <span className="font-scrawl">{r.code}</span> },
    { header: 'State', cell: (r) => (r.paying ? <Pill tone="green">paying</Pill> : <span className="text-ink-soft">free</span>) },
    { header: 'Calls', align: 'right', cell: (r) => count(r.calls) },
    { header: 'Cost', align: 'right', cell: (r) => money(r.costCents) },
  ]

  return (
    <>
      <PageHeader title="Costs" right={<RangePicker days={days} onChange={setDays} />} />
      <AsyncBlock query={query}>
        {(d) => (
          <>
            <Section title="Cost per user">
              <div className="grid grid-cols-2 gap-3">
                <StatTile label="Per paying user" value={money(d.costPerPayingUser)} />
                <StatTile label="Per free user" value={money(d.costPerFreeUser)} />
              </div>
            </Section>

            <Section title="Cost per day (model + ears)">
              <div className="grid gap-6 lg:grid-cols-2">
                <div className="rounded-2xl border-[3px] border-ink bg-paper p-4 shadow-[3px_4px_0_0_rgba(59,47,47,0.22)]">
                  <div className="mb-1 font-hand text-base text-ink-soft">Model (LLM)</div>
                  <BarChart
                    ariaLabel="LLM cost per day"
                    data={d.daily.map((x) => ({ label: dayLabel(x.day), value: x.llmCents }))}
                    color={SERIES_COLORS[0]}
                    format={(v) => moneyShort(v)}
                  />
                </div>
                <div className="rounded-2xl border-[3px] border-ink bg-paper p-4 shadow-[3px_4px_0_0_rgba(59,47,47,0.22)]">
                  <div className="mb-1 font-hand text-base text-ink-soft">Ears (STT)</div>
                  <BarChart
                    ariaLabel="Ears cost per day"
                    data={d.daily.map((x) => ({ label: dayLabel(x.day), value: x.earsCents }))}
                    color={SERIES_COLORS[1]}
                    format={(v) => moneyShort(v)}
                  />
                </div>
              </div>
            </Section>

            <Section title="Top 20 devices by cost">
              <DataTable columns={topCols} rows={d.topDevices} getKey={(r, i) => `${r.code}-${i}`} empty="No spend yet" />
            </Section>

            <Section title="Call log">
              <DataTable columns={callCols} rows={d.calls} getKey={(r) => r.id} empty="No calls yet" />
            </Section>
          </>
        )}
      </AsyncBlock>
    </>
  )
}
