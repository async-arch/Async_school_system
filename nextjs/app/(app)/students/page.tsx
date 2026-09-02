import { LinkButton, StatusBadge } from '@/components/ui'
import { ResourceList } from '@/components/resource-list'
import { RowLink } from '@/components/ui/table'
import { hasAccess } from '@/lib/odoo/client'
import { classOptions } from '@/lib/odoo/filter-options'
import { listStudents } from '@/lib/odoo/models/school'
import { selectionOptions } from '@/lib/odoo/selections'
import { toOdooOrder } from '@/lib/list-query'
import { formatText } from '@/lib/format'
import { m2oLabel } from '@/lib/odoo/types'

export const metadata = { title: 'Students · Async School' }

/**
 * Searching, filtering, sorting and paging all reach Odoo as a domain, an
 * order and a limit. Nothing is narrowed in the browser: record rules already
 * scope the rows per user, and one page is never the whole result set.
 */
export default async function StudentsPage({ searchParams }: PageProps<'/students'>) {
  const [canCreate, registrationStatuses, lifecycleStatuses, classes] = await Promise.all([
    hasAccess('school.student', 'create'),
    selectionOptions('school.student', 'registration_status'),
    selectionOptions('school.student', 'lifecycle_status'),
    classOptions(),
  ])

  return (
    <ResourceList
      title="Students"
      icon="students"
      basePath="/students"
      searchParams={searchParams}
      search={{ placeholder: 'Name, student ID or admission number' }}
      filters={[
        { key: 'status', label: 'Registration', options: registrationStatuses },
        { key: 'lifecycle', label: 'Lifecycle', options: lifecycleStatuses },
        { key: 'class', label: 'Class', options: classes },
      ]}
      defaultSort={{ field: 'name', direction: 'asc' }}
      load={(query) =>
        listStudents({
          search: query.search,
          filters: query.filters,
          order: toOdooOrder(query),
          limit: query.limit,
          offset: query.offset,
        })
      }
      action={
        canCreate ? (
          <LinkButton href="/students/new" variant="primary" icon="plus">
            Register student
          </LinkButton>
        ) : undefined
      }
      rowHref={(row) => `/students/${row.id}`}
      emptyTitle="No students visible"
      emptyHint="Odoo scopes this list to the records your role may see."
      emptyAction={
        canCreate ? (
          <LinkButton href="/students/new" variant="primary" icon="plus" size="sm">
            Register the first student
          </LinkButton>
        ) : undefined
      }
      columns={[
        {
          key: 'name',
          label: 'Name',
          sortField: 'name',
          render: (row) => <RowLink href={`/students/${row.id}`}>{row.name}</RowLink>,
        },
        {
          key: 'regno',
          label: 'Student ID',
          sortField: 'regno',
          render: (row) => <span className="tabular">{formatText(row.regno)}</span>,
        },
        { key: 'class', label: 'Class', render: (row) => m2oLabel(row.class_id) },
        {
          key: 'year',
          label: 'Academic year',
          hideBelow: 'md',
          render: (row) => m2oLabel(row.academic_year_id),
        },
        {
          key: 'lifecycle',
          label: 'Lifecycle',
          hideBelow: 'lg',
          render: (row) => <StatusBadge state={row.lifecycle_status} size="sm" />,
        },
        {
          key: 'status',
          label: 'Registration',
          render: (row) => <StatusBadge state={row.registration_status} model="school.student" />,
        },
      ]}
    />
  )
}
