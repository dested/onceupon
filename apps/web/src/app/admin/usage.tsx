import { useQuery } from '@tanstack/react-query'
import { useTRPC } from '~/lib/trpc'
import { PageHeader } from './layout'
import { AsyncBlock, DataTable, RangePicker, Section, useDays, type Column } from './parts'
import { BarChart, LineChart, SERIES_COLORS } from './charts'
import { count, dayLabel, ms, percent } from './format'

type EarsRow = { vendor: string; minutes: number }
type ModelRow = { model: string; calls: number }

function ChartCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border-[3px] border-ink bg-paper p-4 shadow-[3px_4px_0_0_rgba(59,47,47,0.22)]">
      {children}
    </div>
  )
}

export function UsagePage() {
  const trpc = useTRPC()
  const [days, setDays] = useDays()
  const query = useQuery(trpc.admin.usage.queryOptions({ days }))

  const earsCols: Column<EarsRow>[] = [
    { header: 'Ears vendor', cell: (r) => <span className="capitalize">{r.vendor}</span> },
    { header: 'Minutes', align: 'right', cell: (r) => r.minutes.toFixed(1) },
  ]
  const modelCols: Column<ModelRow>[] = [
    { header: 'Model', cell: (r) => r.model },
    { header: 'Calls', align: 'right', cell: (r) => count(r.calls) },
  ]

  return (
    <>
      <PageHeader title="Usage" right={<RangePicker days={days} onChange={setDays} />} />
      <AsyncBlock query={query}>
        {(d) => {
          const label = (day: string) => dayLabel(day)
          return (
            <>
              <div className="grid gap-6 lg:grid-cols-2">
                <Section title="Mic minutes per day">
                  <ChartCard>
                    <BarChart
                      ariaLabel="Mic minutes per day"
                      data={d.series.map((s) => ({ label: label(s.day), value: s.micMinutes }))}
                      color={SERIES_COLORS[2]}
                      format={(v) => `${Math.round(v)}m`}
                    />
                  </ChartCard>
                </Section>
                <Section title="Beats per day">
                  <ChartCard>
                    <BarChart
                      ariaLabel="Beats per day"
                      data={d.series.map((s) => ({ label: label(s.day), value: s.beats }))}
                      color={SERIES_COLORS[0]}
                    />
                  </ChartCard>
                </Section>
              </div>

              <Section title="Output tokens per beat">
                <ChartCard>
                  <LineChart
                    ariaLabel="Output tokens p50 and p95"
                    points={d.series.map((s) => ({
                      label: label(s.day),
                      values: { p50: s.outputTokensP50, p95: s.outputTokensP95 },
                    }))}
                    series={[
                      { key: 'p50', label: 'p50', color: SERIES_COLORS[0] },
                      { key: 'p95', label: 'p95', color: SERIES_COLORS[1] },
                    ]}
                    format={(v) => count(Math.round(v))}
                  />
                </ChartCard>
              </Section>

              <Section title="Latency">
                <ChartCard>
                  <LineChart
                    ariaLabel="First-token and total latency"
                    points={d.series.map((s) => ({
                      label: label(s.day),
                      values: { ft50: s.firstTokenP50, ft95: s.firstTokenP95, total: s.totalMsP50 },
                    }))}
                    series={[
                      { key: 'ft50', label: '1st p50', color: SERIES_COLORS[0] },
                      { key: 'ft95', label: '1st p95', color: SERIES_COLORS[1] },
                      { key: 'total', label: 'total p50', color: SERIES_COLORS[2] },
                    ]}
                    format={(v) => ms(v)}
                  />
                </ChartCard>
              </Section>

              <Section title="Restart, skip and cache-hit rate">
                <ChartCard>
                  <LineChart
                    ariaLabel="Restart, skip and cache-hit rate"
                    points={d.series.map((s) => ({
                      label: label(s.day),
                      values: { restart: s.restartRate, skip: s.skipRate, cache: s.cacheHitRate },
                    }))}
                    series={[
                      { key: 'restart', label: 'restart', color: SERIES_COLORS[0] },
                      { key: 'skip', label: 'skip', color: SERIES_COLORS[1] },
                      { key: 'cache', label: 'cache', color: SERIES_COLORS[2] },
                    ]}
                    format={(v) => percent(v)}
                  />
                </ChartCard>
              </Section>

              <div className="grid gap-6 lg:grid-cols-2">
                <Section title="Ears vendor split">
                  <DataTable columns={earsCols} rows={d.earsSplit} getKey={(r) => r.vendor} empty="No sessions yet" />
                </Section>
                <Section title="Model split">
                  <DataTable columns={modelCols} rows={d.modelSplit} getKey={(r) => r.model} empty="No calls yet" />
                </Section>
              </div>
            </>
          )
        }}
      </AsyncBlock>
    </>
  )
}
