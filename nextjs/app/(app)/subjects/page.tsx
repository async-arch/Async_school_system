import { Badge } from '@/components/ui'
import { ResourceList } from '@/components/resource-list'
import { formatSelection, formatText } from '@/lib/format'
import { toOdooOrder } from '@/lib/list-query'
import { listSubjects } from '@/lib/odoo/models/school'
import { selectionOptions } from '@/lib/odoo/selections'

export const metadata = { title: 'Subjects · Async School' }

export default async function SubjectsPage({ searchParams }: PageProps<'/subjects'>) {
  const types = await selectionOptions('school.subject', 'subject_type')

  return (
    <ResourceList
      title="Subjects"
      icon="subjects"
      basePath="/subjects"
      searchParams={searchParams}
      subtitle="What a class studies is set per class in the curriculum, not here."
      search={{ placeholder: 'Subject name or code' }}
      filters={[{ key: 'type', label: 'Type', options: types }]}
      defaultSort={{ field: 'name', direction: 'asc' }}
      load={(query) =>
        listSubjects({
          search: query.search,
          filters: query.filters,
          order: toOdooOrder(query),
          limit: query.limit,
          offset: query.offset,
        })
      }
      emptyTitle="No subjects visible"
      columns={[
        { key: 'name', label: 'Subject', sortField: 'name', render: (row) => row.name },
        {
          key: 'code',
          label: 'Code',
          sortField: 'code',
          render: (row) => <span className="tabular">{formatText(row.code)}</span>,
        },
        { key: 'type', label: 'Type', render: (row) => formatSelection(row.subject_type) },
        {
          key: 'active',
          label: 'In use',
          render: (row) =>
            row.active ? <Badge tone="neutral">Active</Badge> : <Badge tone="muted">Archived</Badge>,
        },
      ]}
    />
  )
}
