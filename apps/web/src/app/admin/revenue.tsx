import { useQuery } from '@tanstack/react-query'
import type { inferRouterOutputs } from '@trpc/server'
import { useTRPC } from '~/lib/trpc'
import type { AppRouter } from '../../../server/router'
import { PageHeader } from './layout'
import { AsyncBlock, DataTable, Pill, RangePicker, Section, StatTile, useDays, type Column } from './parts'
import { BarChart, SERIES_COLORS } from './charts'
import { count, dateTime, dayLabel, minutes, money, moneyShort } from './format'

type Purchase = inferRouterOutputs<AppRouter>['admin']['revenue']['purchases'][number]

export function RevenuePage() {
  const trpc = useTRPC()
  const [days, setDays] = useDays()
  const query = useQuery(trpc.admin.revenue.queryOptions({ days }))

  const cols: Column<Purchase>[] = [
    { header: 'When', cell: (r) => dateTime(r.createdAt), className: 'whitespace-nowrap' },
    { header: 'Pack', cell: (r) => r.packId },
    { header: 'Channel', cell: (r) => <span className="capitalize">{r.channel}</span> },
    { header: 'Gross', align: 'right', cell: (r) => money(r.grossCents) },
    { header: 'Fee', align: 'right', cell: (r) => money(r.feeCents) },
    { header: 'Net', align: 'right', cell: (r) => money(r.netCents) },
    { header: 'Device', cell: (r) => <span className="font-scrawl">{r.deviceCode}</span> },
    { header: 'Refunded', cell: (r) => (r.refundedAt ? <Pill tone="red">refunded</Pill> : '') },
  ]

  return (
    <>
      <PageHeader title="Revenue" right={<RangePicker days={days} onChange={setDays} />} />
      <AsyncBlock query={query}>
        {(d) => {
          const iap = d.daily.reduce((a, x) => a + x.iapCents, 0)
          const web = d.daily.reduce((a, x) => a + x.webCents, 0)
          return (
            <>
              <Section title="Gift codes">
                <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                  <StatTile label="Sold this period" value={count(d.giftCodes.sold)} />
                  <StatTile label="Redeemed" value={count(d.giftCodes.redeemed)} />
                  <StatTile label="Outstanding" value={count(d.giftCodes.outstanding)} />
                  <StatTile
                    label="Liability"
                    value={minutes(d.giftCodes.liabilitySeconds)}
                    tone={d.giftCodes.outstanding > 0 ? 'warn' : 'plain'}
                  />
                </div>
              </Section>

              <Section title="Apple vs web">
                <div className="grid grid-cols-3 gap-3">
                  <StatTile label="Apple (IAP)" value={moneyShort(iap)} sparkColor={SERIES_COLORS[0]} />
                  <StatTile label="Web (Stripe)" value={moneyShort(web)} sparkColor={SERIES_COLORS[1]} />
                  <StatTile label="Refunds" value={count(d.refunds)} tone={d.refunds > 0 ? 'warn' : 'plain'} />
                </div>
              </Section>

              <Section title="Gross revenue per day">
                <div className="rounded-2xl border-[3px] border-ink bg-paper p-4 shadow-[3px_4px_0_0_rgba(59,47,47,0.22)]">
                  <BarChart
                    ariaLabel="Gross revenue per day"
                    data={d.daily.map((x) => ({ label: dayLabel(x.day), value: x.grossCents }))}
                    color={SERIES_COLORS[0]}
                    format={(v) => moneyShort(v)}
                  />
                </div>
              </Section>

              <Section title="Purchases">
                <DataTable columns={cols} rows={d.purchases} getKey={(r) => r.id} empty="No purchases yet" />
              </Section>

              <p className="font-hand text-sm text-ink-soft">
                Apple Small Business Program: verify enrollment before the first sale (15% rate assumed in fees).
              </p>
            </>
          )
        }}
      </AsyncBlock>
    </>
  )
}
