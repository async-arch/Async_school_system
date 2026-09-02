import { Badge, StatusBadge } from '@/components/ui'
import { ResourceList } from '@/components/resource-list'
import { RowLink } from '@/components/ui/table'
import { formatDate } from '@/lib/format'
import { toOdooOrder } from '@/lib/list-query'
import { listAcademicYears } from '@/lib/odoo/models/school'
import { selectionOptions } from '@/lib/odoo/selections'

export const metadata = { title: 'Academic years · Async School' }

/** Years are named by the Ethiopian year of their Gregorian start date. */
export default async function AcademicYearsPage({ searchParams }: PageProps<'/academic-years'>) {
  const states = await selectionOptions('school.academic.year', 'state')

  return (
    <ResourceList
      title="Academic years"
      icon="academicYear"
      basePath="/academic-years"
      searchParams={searchParams}
      subtitle="Named by the Ethiopian year of the start date, as Odoo validates it."
      search={{ placeholder: 'Year' }}
      filters={[{ key: 'status', label: 'Status', options: states }]}
      defaultSort={{ field: 'name', direction: 'desc' }}
      load={(query) =>
        listAcademicYears({
          search: query.search,
          filters: query.filters,
          order: toOdooOrder(query),
          limit: query.limit,
          offset: query.offset,
        })
      }
      rowHref={(row) => `/academic-years/${row.id}`}
      emptyTitle="No academic years visible"
      columns={[
        {
          key: 'name',
          label: 'Year',
          sortField: 'name',
          render: (row) => <RowLink href={`/academic-years/${row.id}`}>{row.name}</RowLink>,
        },
        {
          key: 'start',
          label: 'Starts',
          sortField: 'date_start',
          render: (row) => formatDate(row.date_start),
        },
        { key: 'end', label: 'Ends', hideBelow: 'sm', render: (row) => formatDate(row.date_end) },
        {
          key: 'classes',
          label: 'Classes',
          numeric: true,
          hideBelow: 'md',
          render: (row) => row.class_count,
        },
        { key: 'state', label: 'Status', render: (row) => <StatusBadge state={row.state} /> },
        {
          key: 'current',
          label: 'Default for new records',
          hideBelow: 'lg',
          render: (row) => (row.is_current ? <Badge tone="live">Current</Badge> : null),
        },
      ]}
    />
  )
}
