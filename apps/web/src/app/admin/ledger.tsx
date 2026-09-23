import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { inferRouterOutputs } from '@trpc/server'
import { useTRPC } from '~/lib/trpc'
import type { AppRouter } from '../../../server/router'
import { PageHeader } from './layout'
import { AsyncBlock, ConfirmButton, DataTable, Pill, Section, type Column } from './parts'
import { FIELD, StickerButton } from '~/components/paper'
import { clock, count, dateTime, money, relative } from './format'

type SearchRow = {
  id: string
  code: string
  platform: string
  balanceSec: number
  paying: boolean
  blocked: boolean
  createdAt: string
  lastSeenAt: string
}

export function LedgerPage() {
  const trpc = useTRPC()
  const qc = useQueryClient()
  const [term, setTerm] = useState('')
  const [submitted, setSubmitted] = useState('')
  const [selected, setSelected] = useState<string | null>(null)

  const search = useQuery(
    trpc.admin.ledger.search.queryOptions({ q: submitted }, { enabled: submitted.length > 0 })
  )
  const device = useQuery(
    trpc.admin.ledger.device.queryOptions(
      { deviceId: selected ?? '' },
      { enabled: selected !== null }
    )
  )

  function refresh() {
    if (selected) qc.invalidateQueries({ queryKey: trpc.admin.ledger.device.queryKey({ deviceId: selected }) })
    if (submitted) qc.invalidateQueries({ queryKey: trpc.admin.ledger.search.queryKey({ q: submitted }) })
  }

  const cols: Column<SearchRow>[] = [
    { header: 'Code', cell: (r) => <span className="font-scrawl">{r.code}</span> },
    { header: 'Platform', cell: (r) => <span className="capitalize">{r.platform}</span> },
    { header: 'Balance', align: 'right', cell: (r) => clock(r.balanceSec) },
    {
      header: 'State',
      cell: (r) => (
        <span className="flex gap-1">
          {r.paying && <Pill tone="green">paying</Pill>}
          {r.blocked && <Pill tone="red">blocked</Pill>}
          {!r.paying && !r.blocked && <span className="text-ink-soft">free</span>}
        </span>
      ),
    },
    { header: 'Last seen', align: 'right', cell: (r) => relative(r.lastSeenAt) },
    {
      header: '',
      align: 'right',
      cell: (r) => (
        <StickerButton tone="blue" tilt={-1} onClick={() => setSelected(r.id)}>
          Open
        </StickerButton>
      ),
    },
  ]

  return (
    <>
      <PageHeader title="Ledger" />
      <Section>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            setSubmitted(term.trim())
            setSelected(null)
          }}
          className="flex flex-wrap gap-2">
          <input
            className={`${FIELD} max-w-md`}
            placeholder="Device code, install id, gift code, or receipt id"
            value={term}
            onChange={(e) => setTerm(e.target.value)}
          />
          <StickerButton type="submit" tone="yellow" tilt={-1}>
            Search
          </StickerButton>
        </form>
      </Section>

      {submitted.length > 0 && (
        <Section title="Matches">
          <AsyncBlock query={search} isEmpty={(rows) => rows.length === 0}>
            {(rows) => <DataTable columns={cols} rows={rows} getKey={(r) => r.id} empty="No devices found" />}
          </AsyncBlock>
        </Section>
      )}

      {selected !== null && (
        <AsyncBlock query={device} isEmpty={(d) => d === null}>
          {(d) => (d === null ? <p className="font-hand text-ink-soft">Device not found</p> : (
            <DeviceDetail data={d} onDone={refresh} />
          ))}
        </AsyncBlock>
      )}
    </>
  )
}

type DeviceData = NonNullable<inferRouterOutputs<AppRouter>['admin']['ledger']['device']>

function DeviceDetail({ data, onDone }: { data: DeviceData; onDone: () => void }) {
  const trpc = useTRPC()
  const dev = data.device
  const [minutesField, setMinutesField] = useState('')
  const [adjustReason, setAdjustReason] = useState('')
  const [blockReason, setBlockReason] = useState('')

  const adjust = useMutation(
    trpc.admin.ledger.adjust.mutationOptions({
      onSuccess: () => {
        setMinutesField('')
        setAdjustReason('')
        onDone()
      },
    })
  )
  const block = useMutation(trpc.admin.ledger.block.mutationOptions({ onSuccess: onDone }))
  const reset = useMutation(trpc.admin.ledger.resetFreeStory.mutationOptions({ onSuccess: onDone }))

  const entryCols: Column<DeviceData['entries'][number]>[] = [
    { header: 'When', cell: (r) => dateTime(r.createdAt) },
    { header: 'Kind', cell: (r) => <Pill>{r.kind}</Pill> },
    {
      header: 'Change',
      align: 'right',
      cell: (r) => <span className={r.seconds < 0 ? 'text-crayon-red' : 'text-crayon-green'}>{clock(r.seconds)}</span>,
    },
    { header: 'Balance', align: 'right', cell: (r) => clock(r.balanceAfter) },
    { header: 'Note', cell: (r) => r.note ?? r.ref ?? '' },
    { header: 'By', cell: (r) => r.actor ?? '' },
  ]
  const sessCols: Column<DeviceData['sessions'][number]>[] = [
    { header: 'Started', cell: (r) => dateTime(r.startedAt) },
    { header: 'Ears', cell: (r) => <span className="capitalize">{r.earsVendor}</span> },
    { header: 'Status', cell: (r) => r.status },
    { header: 'End', cell: (r) => r.endReason ?? '' },
    { header: 'Charged', align: 'right', cell: (r) => clock(r.chargedSec) },
    { header: 'Heard', align: 'right', cell: (r) => `${(r.listenedMs / 1000).toFixed(0)}s` },
    { header: 'Typed', align: 'right', cell: (r) => `${r.typedSec}s` },
  ]
  const buyCols: Column<DeviceData['purchases'][number]>[] = [
    { header: 'When', cell: (r) => dateTime(r.createdAt) },
    { header: 'Channel', cell: (r) => <span className="capitalize">{r.channel}</span> },
    { header: 'Pack', cell: (r) => r.packId },
    { header: 'Gross', align: 'right', cell: (r) => money(r.grossCents) },
    { header: 'Net', align: 'right', cell: (r) => money(r.netCents) },
    { header: 'Refunded', cell: (r) => (r.refundedAt ? dateTime(r.refundedAt) : '') },
  ]

  function applyAdjust() {
    const mins = Number(minutesField)
    if (!Number.isFinite(mins) || mins === 0 || adjustReason.trim().length === 0) return
    adjust.mutate({ deviceId: dev.id, seconds: Math.round(mins * 60), reason: adjustReason.trim() })
  }

  return (
    <Section>
      <div className="rounded-3xl border-[3px] border-ink bg-paper p-5 shadow-[6px_8px_0_0_rgba(59,47,47,0.25)]">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <span className="font-scrawl text-3xl text-ink">{dev.code}</span>
              {dev.paying && <Pill tone="green">paying</Pill>}
              {dev.blocked && <Pill tone="red">blocked</Pill>}
              <Pill>{dev.platform}</Pill>
            </div>
            <div className="mt-1 font-hand text-sm text-ink-soft">
              {dev.id} · joined {relative(dev.createdAt)} · seen {relative(dev.lastSeenAt)}
              {dev.appVersion ? ` · v${dev.appVersion}` : ''}
            </div>
          </div>
          <div className="text-right">
            <div className="font-hand text-base text-ink-soft">Balance</div>
            <div className="font-scrawl text-[34px] leading-none text-ink tabular-nums">{clock(dev.balanceSec)}</div>
          </div>
        </div>

        {dev.blockedReason && (
          <p className="mt-2 font-hand text-base text-crayon-red">Blocked: {dev.blockedReason}</p>
        )}

        {/* Actions */}
        <div className="mt-4 grid gap-4 md:grid-cols-3">
          <div className="rounded-2xl border-[3px] border-ink bg-paper-deep/40 p-3">
            <div className="mb-2 font-hand text-base text-ink">Adjust minutes</div>
            <div className="flex flex-col gap-2">
              <input
                className={FIELD}
                type="number"
                step="0.5"
                placeholder="minutes (− to debit)"
                value={minutesField}
                onChange={(e) => setMinutesField(e.target.value)}
              />
              <input
                className={FIELD}
                placeholder="reason"
                value={adjustReason}
                onChange={(e) => setAdjustReason(e.target.value)}
              />
              <StickerButton
                tone="green"
                tilt={-1}
                disabled={adjust.isPending || adjustReason.trim().length === 0 || Number(minutesField) === 0}
                onClick={applyAdjust}>
                {adjust.isPending ? 'Applying…' : 'Apply'}
              </StickerButton>
              {adjust.isError && <p className="font-hand text-sm text-crayon-red">{errorMessage(adjust.error)}</p>}
            </div>
          </div>

          <div className="rounded-2xl border-[3px] border-ink bg-paper-deep/40 p-3">
            <div className="mb-2 font-hand text-base text-ink">{dev.blocked ? 'Unblock' : 'Block'}</div>
            {dev.blocked ? (
              <ConfirmButton
                tone="green"
                confirmLabel="unblock?"
                disabled={block.isPending}
                onConfirm={() => block.mutate({ deviceId: dev.id, blocked: false, reason: '' })}>
                Unblock device
              </ConfirmButton>
            ) : (
              <div className="flex flex-col gap-2">
                <input
                  className={FIELD}
                  placeholder="reason"
                  value={blockReason}
                  onChange={(e) => setBlockReason(e.target.value)}
                />
                <ConfirmButton
                  tone="red"
                  confirmLabel="block?"
                  disabled={block.isPending || blockReason.trim().length === 0}
                  onConfirm={() => block.mutate({ deviceId: dev.id, blocked: true, reason: blockReason.trim() })}>
                  Block device
                </ConfirmButton>
              </div>
            )}
          </div>

          <div className="rounded-2xl border-[3px] border-ink bg-paper-deep/40 p-3">
            <div className="mb-2 font-hand text-base text-ink">Free story</div>
            <div className="mb-2 font-hand text-sm text-ink-soft">
              {dev.freeStoryUsed ? 'Used' : 'Available'} · weekly {dev.weeklyGrantAt ? relative(dev.weeklyGrantAt) : 'never'}
            </div>
            <ConfirmButton
              tone="yellow"
              confirmLabel="reset?"
              disabled={reset.isPending}
              onConfirm={() => reset.mutate({ deviceId: dev.id })}>
              Reset free story
            </ConfirmButton>
          </div>
        </div>
      </div>

      <Section title="Ledger entries" className="mt-6">
        <DataTable columns={entryCols} rows={data.entries} getKey={(r) => r.id} empty="No entries" />
      </Section>
      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="Recent sessions">
          <DataTable columns={sessCols} rows={data.sessions} getKey={(r) => r.id} empty="No sessions" />
        </Section>
        <Section title="Purchases">
          <DataTable columns={buyCols} rows={data.purchases} getKey={(r) => r.id} empty="No purchases" />
        </Section>
      </div>
      {data.shares.length > 0 && (
        <Section title="Shares">
          <ul className="flex flex-wrap gap-2">
            {data.shares.map((s) => (
              <li key={s.id}>
                <Pill>{s.title || 'untitled'} · {count(s.views)} views</Pill>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </Section>
  )
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : 'Failed'
}
