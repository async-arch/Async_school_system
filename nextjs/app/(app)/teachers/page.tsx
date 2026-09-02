import { StatusBadge } from '@/components/ui'
import { ResourceList } from '@/components/resource-list'
import { formatSelection, formatText } from '@/lib/format'
import { toOdooOrder } from '@/lib/list-query'
import { listTeachers } from '@/lib/odoo/models/school'
import { selectionOptions } from '@/lib/odoo/selections'

export const metadata = { title: 'Teachers · Async School' }

export default async function TeachersPage({ searchParams }: PageProps<'/teachers'>) {
  const [statuses, departments] = await Promise.all([
    selectionOptions('school.teacher', 'teaching_status'),
    selectionOptions('school.teacher', 'department'),
  ])

  return (
    <ResourceList
      title="Teachers"
      icon="teachers"
      basePath="/teachers"
      searchParams={searchParams}
      subtitle="Workload figures are computed by Odoo from active assignments."
      search={{ placeholder: 'Name or teacher ID' }}
      filters={[
        { key: 'status', label: 'Status', options: statuses },
        { key: 'department', label: 'Department', options: departments },
      ]}
      defaultSort={{ field: 'name', direction: 'asc' }}
      load={(query) =>
        listTeachers({
          search: query.search,
          filters: query.filters,
          order: toOdooOrder(query),
          limit: query.limit,
          offset: query.offset,
        })
      }
      emptyTitle="No teacher profiles visible"
      emptyHint="A teacher profile is created when a staff member takes a teaching responsibility."
      columns={[
        { key: 'name', label: 'Name', sortField: 'name', render: (row) => row.name },
        {
          key: 'teacherId',
          label: 'Teacher ID',
          hideBelow: 'sm',
          render: (row) => <span className="tabular">{formatText(row.teacher_id)}</span>,
        },
        {
          key: 'department',
          label: 'Department',
          hideBelow: 'lg',
          render: (row) => formatSelection(row.department),
        },
        {
          key: 'classes',
          label: 'Classes',
          numeric: true,
          render: (row) => row.assigned_class_count,
        },
        {
          key: 'subjects',
          label: 'Subjects',
          numeric: true,
          hideBelow: 'sm',
          render: (row) => row.assigned_subject_count,
        },
        {
          key: 'students',
          label: 'Students',
          numeric: true,
          hideBelow: 'md',
          render: (row) => row.total_student_count,
        },
        {
          key: 'periods',
          label: 'Periods/wk',
          numeric: true,
          render: (row) => row.current_weekly_periods,
        },
        {
          key: 'status',
          label: 'Status',
          render: (row) => <StatusBadge state={row.teaching_status} />,
        },
      ]}
    />
  )
}
