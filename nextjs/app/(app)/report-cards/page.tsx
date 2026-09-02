import { StatusBadge } from '@/components/ui'
import { ResourceList } from '@/components/resource-list'
import { RowLink } from '@/components/ui/table'
import { toOdooOrder } from '@/lib/list-query'
import { classOptions, termOptions } from '@/lib/odoo/filter-options'
import { listReportCards } from '@/lib/odoo/models/assessment'
import { selectionOptions } from '@/lib/odoo/selections'
import { m2oLabel } from '@/lib/odoo/types'

export const metadata = { title: 'Report cards · Async School' }

export default async function ReportCardsPage({ searchParams }: PageProps<'/report-cards'>) {
  const [states, classes, terms] = await Promise.all([
    selectionOptions('school.report.card', 'state'),
    classOptions(),
    termOptions(),
  ])

  return (
    <ResourceList
      title="Report cards"
      icon="reportCards"
      basePath="/report-cards"
      searchParams={searchParams}
      subtitle="Versioned and permanent — Odoo supersedes rather than overwrites, and refuses deletion."
      search={{ placeholder: 'Student or reference' }}
      filters={[
        { key: 'status', label: 'Status', options: states },
        { key: 'class', label: 'Class', options: classes },
        { key: 'term', label: 'Term', options: terms },
      ]}
      load={(query) =>
        listReportCards({
          search: query.search,
          filters: query.filters,
          order: toOdooOrder(query),
          limit: query.limit,
          offset: query.offset,
        })
      }
      rowHref={(row) => `/report-cards/${row.id}`}
      emptyTitle="No report cards visible"
      emptyHint="Generated from published marks by an Exam Officer."
      columns={[
        {
          key: 'name',
          label: 'Report card',
          render: (row) => <RowLink href={`/report-cards/${row.id}`}>{row.name}</RowLink>,
        },
        { key: 'student', label: 'Student', render: (row) => m2oLabel(row.student_id) },
        { key: 'class', label: 'Class', hideBelow: 'sm', render: (row) => m2oLabel(row.class_id) },
        { key: 'term', label: 'Term', render: (row) => m2oLabel(row.term_id) },
        {
          key: 'year',
          label: 'Year',
          hideBelow: 'md',
          render: (row) => m2oLabel(row.academic_year_id),
        },
        { key: 'state', label: 'Status', render: (row) => <StatusBadge state={row.state} /> },
      ]}
    />
  )
}
