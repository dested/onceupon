import { useQuery } from '@tanstack/react-query'
import { useTRPC } from '~/lib/trpc'
import { PageHeader } from './layout'
import { AsyncBlock, RangePicker, Section, StatTile, useDays } from './parts'
import { LineChart, SERIES_COLORS } from './charts'
import { count, dayLabel, minutes, money, moneyShort } from './format'
import { isPackId, packById } from '../../../../../packages/shared/src/packs'

export function OverviewPage() {
  const trpc = useTRPC()
  const [days, setDays] = useDays()
  const query = useQuery(trpc.admin.overview.queryOptions({ days }))

  return (
    <>
      <PageHeader title="Overview" right={<RangePicker days={days} onChange={setDays} />} />
      <AsyncBlock query={query}>
        {(d) => {
          const revSpark = d.series.map((s) => s.revenueCents)
          const cogsSpark = d.series.map((s) => s.cogsCents)
          const installSpark = d.series.map((s) => s.installs)
          const minSpark = d.series.map((s) => s.minutes)
          return (
            <>
              <Section title="This period">
                <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
                  <StatTile label="Installs" value={count(d.installs)} spark={installSpark} sparkColor={SERIES_COLORS[0]} />
                  <StatTile label="First stories" value={count(d.firstStories)} />
                  <StatTile label="Finished (The End)" value={count(d.finishedStories)} />
                  <StatTile
                    label="Minutes served"
                    value={minutes(d.minutesServedSec)}
                    spark={minSpark}
                    sparkColor={SERIES_COLORS[2]}
                  />
                  <StatTile
                    label="Revenue (gross)"
                    value={moneyShort(d.revenueGross)}
                    hint={`${money(d.revenueNet)} net`}
                    spark={revSpark}
                    sparkColor={SERIES_COLORS[0]}
                  />
                  <StatTile
                    label="Cost to serve"
                    value={moneyShort(d.cogsCents)}
                    spark={cogsSpark}
                    sparkColor={SERIES_COLORS[1]}
                  />
                  <StatTile
                    label="Gross margin"
                    value={moneyShort(d.grossMarginCents)}
                    tone={d.grossMarginCents >= 0 ? 'good' : 'warn'}
                  />
                  <StatTile label="Free minutes given" value={minutes(d.freeSecGiven)} />
                  <StatTile label="Shares created" value={count(d.sharesCreated)} />
                  <StatTile label="Installs from shares" value={count(d.shareInstalls)} />
                  <StatTile label="Refunds" value={count(d.refunds)} tone={d.refunds > 0 ? 'warn' : 'plain'} />
                </div>
              </Section>

              <Section title="Revenue vs cost to serve">
                <div className="rounded-2xl border-[3px] border-ink bg-paper p-4 shadow-[3px_4px_0_0_rgba(59,47,47,0.22)]">
                  <LineChart
                    ariaLabel="Daily revenue versus cost to serve"
                    height={240}
                    points={d.series.map((s) => ({
                      label: dayLabel(s.day),
                      values: { revenue: s.revenueCents, cost: s.cogsCents },
                    }))}
                    series={[
                      { key: 'revenue', label: 'Revenue', color: SERIES_COLORS[0] },
                      { key: 'cost', label: 'Cost', color: SERIES_COLORS[1] },
                    ]}
                    format={(v) => moneyShort(v)}
                  />
                </div>
              </Section>

              <div className="grid gap-6 lg:grid-cols-2">
                <Section title="Purchases by pack">
                  {d.purchasesByPack.length === 0 ? (
                    <p className="font-hand text-lg text-ink-soft">No purchases yet</p>
                  ) : (
                    <div className="grid grid-cols-3 gap-3">
                      {d.purchasesByPack.map((p) => (
                        <StatTile
                          key={p.packId}
                          label={isPackId(p.packId) ? packById(p.packId).name : p.packId}
                          value={count(p.count)}
                        />
                      ))}
                    </div>
                  )}
                </Section>

                <Section title="Purchases by channel">
                  {d.purchasesByChannel.length === 0 ? (
                    <p className="font-hand text-lg text-ink-soft">No purchases yet</p>
                  ) : (
                    <div className="overflow-x-auto rounded-2xl border-[3px] border-ink bg-paper">
                      <table className="w-full text-left">
                        <thead>
                          <tr className="bg-paper-deep font-hand text-ink">
                            <th className="border-b-[3px] border-ink px-3 py-2">Channel</th>
                            <th className="border-b-[3px] border-ink px-3 py-2 text-right">Count</th>
                            <th className="border-b-[3px] border-ink px-3 py-2 text-right">Gross</th>
                            <th className="border-b-[3px] border-ink px-3 py-2 text-right">Net</th>
                          </tr>
                        </thead>
                        <tbody className="font-hand text-ink">
                          {d.purchasesByChannel.map((c) => (
                            <tr key={c.channel} className="odd:bg-paper even:bg-paper-deep/40">
                              <td className="border-b border-ink/15 px-3 py-2 capitalize">{c.channel}</td>
                              <td className="border-b border-ink/15 px-3 py-2 text-right tabular-nums">{count(c.count)}</td>
                              <td className="border-b border-ink/15 px-3 py-2 text-right tabular-nums">{money(c.grossCents)}</td>
                              <td className="border-b border-ink/15 px-3 py-2 text-right tabular-nums">{money(c.netCents)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </Section>
              </div>
            </>
          )
        }}
      </AsyncBlock>
    </>
  )
}
