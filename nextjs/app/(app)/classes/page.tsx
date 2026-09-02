import { Badge } from '@/components/ui'
import { ResourceList } from '@/components/resource-list'
import { formatSelection } from '@/lib/format'
import { toOdooOrder } from '@/lib/list-query'
import { academicYearOptions, gradeOptions } from '@/lib/odoo/filter-options'
import { listClasses } from '@/lib/odoo/models/school'
import { selectionOptions } from '@/lib/odoo/selections'
import { m2oLabel } from '@/lib/odoo/types'

export const metadata = { title: 'Classes · Async School' }

export default async function ClassesPage({ searchParams }: PageProps<'/classes'>) {
  const [levels, years, grades] = await Promise.all([
    selectionOptions('school.class', 'education_level'),
    academicYearOptions(),
    gradeOptions(),
  ])

  return (
    <ResourceList
      title="Classes"
      icon="classes"
      basePath="/classes"
      searchParams={searchParams}
      subtitle="A grade and section for one academic year. Capacity is checked when an enrolment activates."
      search={{ placeholder: 'Class name' }}
      filters={[
        { key: 'year', label: 'Year', options: years },
        { key: 'grade', label: 'Grade', options: grades },
        { key: 'level', label: 'Level', options: levels },
      ]}
      defaultSort={{ field: 'name', direction: 'asc' }}
      load={(query) =>
        listClasses({
          search: query.search,
          filters: query.filters,
          order: toOdooOrder(query),
          limit: query.limit,
          offset: query.offset,
        })
      }
      emptyTitle="No classes visible"
      emptyHint="Classes are created per academic year from a grade and a section."
      columns={[
        { key: 'name', label: 'Class', sortField: 'name', render: (row) => row.name },
        { key: 'grade', label: 'Grade', render: (row) => m2oLabel(row.grade_id) },
        {
          key: 'section',
          label: 'Section',
          hideBelow: 'sm',
          render: (row) => m2oLabel(row.section_id),
        },
        {
          key: 'year',
          label: 'Academic year',
          hideBelow: 'md',
          render: (row) => m2oLabel(row.academic_year_id),
        },
        {
          key: 'level',
          label: 'Level',
          hideBelow: 'lg',
          render: (row) => formatSelection(row.education_level),
        },
        {
          key: 'occupancy',
          label: 'Enrolled',
          numeric: true,
          render: (row) => <Occupancy enrolled={row.student_ids.length} capacity={row.capacity} />,
        },
      ]}
    />
  )
}

/**
 * How full a class is. The count is what Odoo returned, not a recalculation —
 * the capacity rule itself lives in the enrolment activation.
 */
function Occupancy({ enrolled, capacity }: { enrolled: number; capacity: number }) {
  if (!capacity) {
    return (
      <span>
        <span className="tabular">{enrolled}</span>
        <span className="ml-1 text-stone">/ no limit</span>
      </span>
    )
  }
  const full = enrolled >= capacity
  return (
    <span className="inline-flex items-center gap-2">
      <span className="tabular">
        {enrolled} / {capacity}
      </span>
      {full ? <Badge tone="solid">Full</Badge> : null}
    </span>
  )
}
