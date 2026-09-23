import { useQuery } from '@tanstack/react-query'
import type { inferRouterOutputs } from '@trpc/server'
import { useTRPC } from '~/lib/trpc'
import type { AppRouter } from '../../../server/router'
import { PageHeader } from './layout'
import { AsyncBlock, DataTable, Section, type Column } from './parts'
import { dateTime } from './format'

type AuditRow = inferRouterOutputs<AppRouter>['admin']['audit']['list'][number]

export function AuditPage() {
  const trpc = useTRPC()
  const query = useQuery(trpc.admin.audit.list.queryOptions({ limit: 200 }))

  const cols: Column<AuditRow>[] = [
    { header: 'When', cell: (r) => dateTime(r.createdAt), className: 'whitespace-nowrap' },
    { header: 'Who', cell: (r) => r.actor },
    { header: 'Action', cell: (r) => r.action },
    { header: 'Target', cell: (r) => r.target ?? '' },
    {
      header: 'Detail',
      cell: (r) => (r.detail ? <code className="font-mono text-xs">{JSON.stringify(r.detail)}</code> : ''),
    },
  ]

  return (
    <>
      <PageHeader title="Audit" />
      <AsyncBlock query={query} isEmpty={(rows) => rows.length === 0}>
        {(rows) => (
          <Section>
            <DataTable columns={cols} rows={rows} getKey={(r) => r.id} empty="No admin actions yet" />
          </Section>
        )}
      </AsyncBlock>
    </>
  )
}
