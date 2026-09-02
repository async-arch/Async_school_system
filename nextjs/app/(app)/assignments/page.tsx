import { StatusBadge } from '@/components/ui'
import { ResourceList } from '@/components/resource-list'
import { formatSelection } from '@/lib/format'
import { toOdooOrder } from '@/lib/list-query'
import { classOptions, subjectOptions } from '@/lib/odoo/filter-options'
import { listAssignments } from '@/lib/odoo/models/school'
import { selectionOptions } from '@/lib/odoo/selections'
import { m2oLabel } from '@/lib/odoo/types'

export const metadata = { title: 'Teaching assignments · Async School' }

export default async function AssignmentsPage({ searchParams }: PageProps<'/assignments'>) {
  const [states, responsibilities, classes, subjects] = await Promise.all([
    selectionOptions('school.teacher.assignment', 'state'),
    selectionOptions('school.teacher.assignment', 'responsibility'),
    classOptions(),
    subjectOptions(),
  ])

  return (
    <ResourceList
      title="Teaching assignments"
      icon="assignments"
      basePath="/assignments"
      searchParams={searchParams}
      subtitle="One active teacher per subject, class and term — enforced by Odoo, not here."
      search={{ placeholder: 'Assignment reference' }}
      filters={[
        { key: 'status', label: 'Status', options: states },
        { key: 'class', label: 'Class', options: classes },
        { key: 'subject', label: 'Subject', options: subjects },
        { key: 'responsibility', label: 'Role', options: responsibilities },
      ]}
      load={(query) =>
        listAssignments({
          search: query.search,
          filters: query.filters,
          order: toOdooOrder(query),
          limit: query.limit,
          offset: query.offset,
        })
      }
      emptyTitle="No assignments visible"
      emptyHint="Teachers see only their own assignments."
      columns={[
        { key: 'teacher', label: 'Teacher', render: (row) => m2oLabel(row.teacher_id) },
        { key: 'subject', label: 'Subject', render: (row) => m2oLabel(row.subject_id) },
        { key: 'class', label: 'Class', render: (row) => m2oLabel(row.class_id) },
        { key: 'term', label: 'Term', hideBelow: 'md', render: (row) => m2oLabel(row.term_id) },
        {
          key: 'responsibility',
          label: 'Role',
          hideBelow: 'lg',
          render: (row) => formatSelection(row.responsibility),
        },
        {
          key: 'periods',
          label: 'Periods/wk',
          numeric: true,
          hideBelow: 'sm',
          render: (row) => row.weekly_periods,
        },
        { key: 'state', label: 'Status', render: (row) => <StatusBadge state={row.state} /> },
      ]}
    />
  )
}
