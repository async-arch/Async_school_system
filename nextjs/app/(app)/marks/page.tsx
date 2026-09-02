import { Badge, StatusBadge } from '@/components/ui'
import { ResourceList } from '@/components/resource-list'
import { formatPercent, formatScore, formatSelection, formatText } from '@/lib/format'
import { toOdooOrder } from '@/lib/list-query'
import { classOptions, subjectOptions, termOptions } from '@/lib/odoo/filter-options'
import { listMarks } from '@/lib/odoo/models/school'
import { selectionOptions } from '@/lib/odoo/selections'
import { m2oLabel } from '@/lib/odoo/types'

export const metadata = { title: 'Marks · Async School' }

/**
 * `percentage` and `grade` are read straight from Odoo, which applies the
 * configured grading scheme and its bands. The formula is never reimplemented
 * here — if Odoo computes a grade, this displays Odoo's result.
 */
export default async function MarksPage({ searchParams }: PageProps<'/marks'>) {
  const [statuses, types, classes, subjects, terms] = await Promise.all([
    selectionOptions('school.mark', 'mark_status'),
    selectionOptions('school.mark', 'exam_type'),
    classOptions(),
    subjectOptions(),
    termOptions(),
  ])

  return (
    <ResourceList
      title="Marks"
      icon="marks"
      basePath="/marks"
      searchParams={searchParams}
      subtitle="Percentages and grades are computed by Odoo's grading scheme."
      search={{ placeholder: 'Student name' }}
      filters={[
        { key: 'class', label: 'Class', options: classes },
        { key: 'subject', label: 'Subject', options: subjects },
        { key: 'term', label: 'Term', options: terms },
        { key: 'status', label: 'Status', options: statuses.length ? statuses : types },
      ]}
      load={(query) =>
        listMarks({
          search: query.search,
          filters: query.filters,
          order: toOdooOrder(query),
          limit: query.limit,
          offset: query.offset,
        })
      }
      emptyTitle="No marks visible"
      emptyHint="A teacher sees marks for their own exact assignment only. Mark rows appear once an assessment is opened."
      columns={[
        { key: 'student', label: 'Student', render: (row) => m2oLabel(row.student_id) },
        { key: 'subject', label: 'Subject', render: (row) => m2oLabel(row.subject_id) },
        { key: 'class', label: 'Class', hideBelow: 'md', render: (row) => m2oLabel(row.class_id) },
        {
          key: 'type',
          label: 'Assessment',
          hideBelow: 'lg',
          render: (row) => formatSelection(row.exam_type),
        },
        {
          key: 'score',
          label: 'Score',
          numeric: true,
          sortField: 'score',
          render: (row) => formatScore(row.score, row.max_score),
        },
        {
          key: 'percentage',
          label: 'Percent',
          numeric: true,
          hideBelow: 'sm',
          render: (row) => formatPercent(row.percentage),
        },
        {
          key: 'grade',
          label: 'Grade',
          render: (row) => (row.grade ? <Badge tone="neutral">{formatText(row.grade)}</Badge> : '—'),
        },
        {
          key: 'status',
          label: 'Status',
          render: (row) => <StatusBadge state={row.mark_status} model="school.mark" size="sm" />,
        },
      ]}
    />
  )
}
