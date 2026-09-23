import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTRPC } from '~/lib/trpc'
import { PageHeader } from './layout'
import { AsyncBlock, Section } from './parts'
import { StickerButton } from '~/components/paper'
import { relative } from './format'

export function AlertsPage() {
  const trpc = useTRPC()
  const qc = useQueryClient()
  const [unreadOnly, setUnreadOnly] = useState(false)
  const query = useQuery(trpc.admin.alerts.list.queryOptions({ unreadOnly }))
  const markRead = useMutation(
    trpc.admin.alerts.markRead.mutationOptions({
      onSuccess: () => qc.invalidateQueries({ queryKey: trpc.admin.alerts.list.queryKey({ unreadOnly }) }),
    })
  )

  return (
    <>
      <PageHeader
        title="Alerts"
        right={
          <StickerButton tone={unreadOnly ? 'yellow' : 'paper'} tilt={-1} onClick={() => setUnreadOnly((v) => !v)}>
            {unreadOnly ? 'Unread only' : 'All'}
          </StickerButton>
        }
      />
      <AsyncBlock query={query} isEmpty={(rows) => rows.length === 0}>
        {(rows) => (
          <Section>
            <ul className="space-y-3">
              {rows.map((a) => {
                const unread = a.readAt === null
                return (
                  <li
                    key={a.id}
                    className={`flex items-start justify-between gap-3 rounded-2xl border-[3px] px-4 py-3 shadow-[3px_4px_0_0_rgba(59,47,47,0.2)] ${
                      unread ? 'border-crayon-red bg-paper' : 'border-ink/40 bg-paper-deep/40'
                    }`}>
                    <div className="min-w-0">
                      <div className={`font-hand text-lg text-ink ${unread ? 'font-bold' : ''}`}>{a.message}</div>
                      <div className="mt-0.5 font-hand text-sm text-ink-soft">
                        {a.kind} · {relative(a.createdAt)}
                        {a.sentAt ? ' · emailed' : ''}
                      </div>
                    </div>
                    {unread && (
                      <StickerButton tone="paper" tilt={-1} disabled={markRead.isPending} onClick={() => markRead.mutate({ id: a.id })}>
                        Mark read
                      </StickerButton>
                    )}
                  </li>
                )
              })}
            </ul>
          </Section>
        )}
      </AsyncBlock>
    </>
  )
}
