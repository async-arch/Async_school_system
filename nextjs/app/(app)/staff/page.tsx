import { LinkButton, StatusBadge } from '@/components/ui'
import { ResourceList } from '@/components/resource-list'
import { RowLink } from '@/components/ui/table'
import { formatSelection, formatText } from '@/lib/format'
import { toOdooOrder } from '@/lib/list-query'
import { hasAccess } from '@/lib/odoo/client'
import { listStaff } from '@/lib/odoo/models/school'
import { selectionOptions } from '@/lib/odoo/selections'
import { m2oLabel } from '@/lib/odoo/types'

export const metadata = { title: 'Staff · Async School' }

export default async function StaffPage({ searchParams }: PageProps<'/staff'>) {
  // Odoo's own ACL decides whether the button appears. It is re-checked on the
  // create page and again by Odoo on submit — this only avoids a dead end.
  const [canCreate, states, departments] = await Promise.all([
    hasAccess('school.staff', 'create'),
    selectionOptions('school.staff', 'state'),
    selectionOptions('school.staff', 'department'),
  ])

  return (
    <ResourceList
      title="Staff"
      icon="staff"
      basePath="/staff"
      searchParams={searchParams}
      search={{ placeholder: 'Name or staff ID' }}
      filters={[
        { key: 'status', label: 'Status', options: states },
        { key: 'department', label: 'Department', options: departments },
      ]}
      defaultSort={{ field: 'name', direction: 'asc' }}
      load={(query) =>
        listStaff({
          search: query.search,
          filters: query.filters,
          order: toOdooOrder(query),
          limit: query.limit,
          offset: query.offset,
        })
      }
      action={
        canCreate ? (
          <LinkButton href="/staff/new" variant="primary" icon="plus">
            Register staff
          </LinkButton>
        ) : undefined
      }
      rowHref={(row) => `/staff/${row.id}`}
      emptyTitle="No staff visible"
      emptyHint="Odoo scopes this list to the records your role may see — Front Office sees only its own."
      columns={[
        {
          key: 'name',
          label: 'Name',
          sortField: 'name',
          render: (row) => <RowLink href={`/staff/${row.id}`}>{row.name}</RowLink>,
        },
        {
          key: 'staffId',
          label: 'Staff ID',
          sortField: 'staff_id',
          render: (row) => <span className="tabular">{formatText(row.staff_id)}</span>,
        },
        {
          key: 'department',
          label: 'Department',
          hideBelow: 'sm',
          render: (row) => formatSelection(row.department),
        },
        {
          key: 'jobTitle',
          label: 'Job title',
          hideBelow: 'md',
          render: (row) => m2oLabel(row.job_title_id),
        },
        {
          key: 'responsibility',
          label: 'Responsibility',
          hideBelow: 'lg',
          render: (row) => formatSelection(row.primary_responsibility),
        },
        { key: 'state', label: 'Status', render: (row) => <StatusBadge state={row.state} /> },
      ]}
    />
  )
}
