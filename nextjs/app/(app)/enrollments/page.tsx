import { StatusBadge } from '@/components/ui'
import { ResourceList } from '@/components/resource-list'
import { RowLink } from '@/components/ui/table'
import { formatDate, formatSelection, formatText } from '@/lib/format'
import { toOdooOrder } from '@/lib/list-query'
import { academicYearOptions, classOptions } from '@/lib/odoo/filter-options'
import { listEnrollments } from '@/lib/odoo/models/student'
import { selectionOptions } from '@/lib/odoo/selections'
import { m2oLabel } from '@/lib/odoo/types'

export const metadata = { title: 'Enrolments · Async School' }

export default async function EnrollmentsPage({ searchParams }: PageProps<'/enrollments'>) {
  const [states, admissionTypes, classes, years] = await Promise.all([
    selectionOptions('school.enrollment', 'state'),
    selectionOptions('school.enrollment', 'admission_type'),
    classOptions(),
    academicYearOptions(),
  ])

  return (
    <ResourceList
      title="Enrolments"
      icon="enrolment"
      basePath="/enrollments"
      searchParams={searchParams}
      subtitle="One active enrolment per student per academic year — enforced by Odoo."
      search={{ placeholder: 'Student or enrolment reference' }}
      filters={[
        { key: 'status', label: 'Status', options: states },
        { key: 'class', label: 'Class', options: classes },
        { key: 'year', label: 'Year', options: years },
        { key: 'admission', label: 'Admission', options: admissionTypes },
      ]}
      defaultSort={{ field: 'enrollment_date', direction: 'desc' }}
      load={(query) =>
        listEnrollments({
          search: query.search,
          filters: query.filters,
          order: toOdooOrder(query),
          limit: query.limit,
          offset: query.offset,
        })
      }
      rowHref={(row) => `/enrollments/${row.id}`}
      emptyTitle="No enrolments visible"
      emptyHint="Teachers see enrolments for their own classes only. Approving a registration creates the first one."
      columns={[
        {
          key: 'name',
          label: 'Enrolment',
          render: (row) => <RowLink href={`/enrollments/${row.id}`}>{row.name}</RowLink>,
        },
        { key: 'student', label: 'Student', render: (row) => m2oLabel(row.student_id) },
        { key: 'class', label: 'Class', render: (row) => m2oLabel(row.class_id) },
        {
          key: 'year',
          label: 'Year',
          hideBelow: 'md',
          render: (row) => m2oLabel(row.academic_year_id),
        },
        {
          key: 'roll',
          label: 'Roll',
          numeric: true,
          hideBelow: 'sm',
          render: (row) => formatText(row.roll_number || undefined),
        },
        {
          key: 'admission',
          label: 'Admission',
          hideBelow: 'lg',
          render: (row) => formatSelection(row.admission_type),
        },
        {
          key: 'from',
          label: 'From',
          sortField: 'enrollment_date',
          hideBelow: 'md',
          render: (row) => formatDate(row.enrollment_date),
        },
        { key: 'state', label: 'Status', render: (row) => <StatusBadge state={row.state} model="school.enrollment" /> },
      ]}
    />
  )
}
