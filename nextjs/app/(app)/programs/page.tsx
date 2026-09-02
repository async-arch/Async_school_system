import { StatusBadge } from '@/components/ui'
import { ResourceList } from '@/components/resource-list'
import { RowLink } from '@/components/ui/table'
import { formatDateTime, formatSelection, formatText } from '@/lib/format'
import { toOdooOrder } from '@/lib/list-query'
import { listPrograms } from '@/lib/odoo/models/operations'
import { selectionOptions } from '@/lib/odoo/selections'
import { m2oLabel } from '@/lib/odoo/types'

export const metadata = { title: 'Programs · Async School' }

export default async function ProgramsPage({ searchParams }: PageProps<'/programs'>) {
  const [states, types, audiences] = await Promise.all([
    selectionOptions('school.program', 'state'),
    selectionOptions('school.program', 'program_type'),
    selectionOptions('school.program', 'audience_type'),
  ])

  return (
    <ResourceList
      title="Programs"
      icon="programs"
      basePath="/programs"
      searchParams={searchParams}
      subtitle="Events and activities on the school calendar."
      search={{ placeholder: 'Program name or location' }}
      filters={[
        { key: 'status', label: 'Status', options: states },
        { key: 'type', label: 'Type', options: types },
        { key: 'audience', label: 'Audience', options: audiences },
      ]}
      defaultSort={{ field: 'start_datetime', direction: 'desc' }}
      load={(query) =>
        listPrograms({
          search: query.search,
          filters: query.filters,
          order: toOdooOrder(query),
          limit: query.limit,
          offset: query.offset,
        })
      }
      rowHref={(row) => `/programs/${row.id}`}
      emptyTitle="No programs visible"
      columns={[
        {
          key: 'name',
          label: 'Program',
          sortField: 'name',
          render: (row) => <RowLink href={`/programs/${row.id}`}>{row.name}</RowLink>,
        },
        { key: 'type', label: 'Type', hideBelow: 'md', render: (row) => formatSelection(row.program_type) },
        {
          key: 'audience',
          label: 'Audience',
          hideBelow: 'lg',
          render: (row) => formatSelection(row.audience_type),
        },
        {
          key: 'start',
          label: 'Starts',
          sortField: 'start_datetime',
          render: (row) => formatDateTime(row.start_datetime),
        },
        {
          key: 'end',
          label: 'Ends',
          hideBelow: 'md',
          render: (row) => formatDateTime(row.end_datetime),
        },
        {
          key: 'location',
          label: 'Location',
          hideBelow: 'sm',
          render: (row) => formatText(row.location),
        },
        {
          key: 'organizer',
          label: 'Organiser',
          hideBelow: 'lg',
          render: (row) => m2oLabel(row.organizer_id),
        },
        { key: 'state', label: 'Status', render: (row) => <StatusBadge state={row.state} /> },
      ]}
    />
  )
}
