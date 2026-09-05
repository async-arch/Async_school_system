import { LinkButton, StatusBadge } from '@/components/ui'
import { ResourceList } from '@/components/resource-list'
import { RowLink } from '@/components/ui/table'
import { toOdooOrder } from '@/lib/list-query'
import { gradeOptions } from '@/lib/odoo/filter-options'
import { canCreatePromotionBatch, listPromotionBatches } from '@/lib/odoo/models/assessment'
import { selectionOptions } from '@/lib/odoo/selections'
import { m2oLabel } from '@/lib/odoo/types'

export const metadata = { title: 'Promotion · Async School' }

export default async function PromotionPage({ searchParams }: PageProps<'/promotion'>) {
  const [states, grades, canCreate] = await Promise.all([
    selectionOptions('school.promotion.batch', 'state'),
    gradeOptions(),
    canCreatePromotionBatch(),
  ])

  return (
    <ResourceList
      title="Promotion"
      icon="promotion"
      basePath="/promotion"
      searchParams={searchParams}
      subtitle="Odoo calculates each outcome from published results, then applies the batch."
      search={{ placeholder: 'Batch name' }}
      action={
        canCreate ? (
          <LinkButton href="/promotion/new" variant="primary" icon="plus">
            New batch
          </LinkButton>
        ) : undefined
      }
      filters={[
        { key: 'status', label: 'Status', options: states },
        { key: 'grade', label: 'Grade', options: grades },
      ]}
      load={(query) =>
        listPromotionBatches({
          search: query.search,
          filters: query.filters,
          order: toOdooOrder(query),
          limit: query.limit,
          offset: query.offset,
        })
      }
      rowHref={(row) => `/promotion/${row.id}`}
      emptyTitle="No promotion batches visible"
      emptyHint="A batch advances one grade from one academic year to the next."
      emptyAction={
        canCreate ? (
          <LinkButton href="/promotion/new" variant="primary" icon="plus" size="sm">
            Create the first batch
          </LinkButton>
        ) : undefined
      }
      columns={[
        {
          key: 'name',
          label: 'Batch',
          render: (row) => <RowLink href={`/promotion/${row.id}`}>{row.name}</RowLink>,
        },
        { key: 'from', label: 'From year', render: (row) => m2oLabel(row.academic_year_id) },
        {
          key: 'to',
          label: 'To year',
          hideBelow: 'sm',
          render: (row) => m2oLabel(row.target_academic_year_id),
        },
        { key: 'grade', label: 'Grade', hideBelow: 'md', render: (row) => m2oLabel(row.grade_id) },
        { key: 'students', label: 'Students', numeric: true, render: (row) => row.line_count },
        {
          key: 'promoted',
          label: 'Promoted',
          numeric: true,
          hideBelow: 'sm',
          render: (row) => row.promoted_count,
        },
        {
          key: 'retained',
          label: 'Retained',
          numeric: true,
          hideBelow: 'lg',
          render: (row) => row.retained_count,
        },
        { key: 'state', label: 'Status', render: (row) => <StatusBadge state={row.state} /> },
      ]}
    />
  )
}
