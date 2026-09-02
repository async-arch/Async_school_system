import { StatusBadge } from '@/components/ui'
import { ResourceList } from '@/components/resource-list'
import { RowLink } from '@/components/ui/table'
import { formatDate } from '@/lib/format'
import { toOdooOrder } from '@/lib/list-query'
import { documentTypeOptions } from '@/lib/odoo/filter-options'
import { listDocuments } from '@/lib/odoo/models/operations'
import { selectionOptions } from '@/lib/odoo/selections'
import { m2oLabel, type Many2one } from '@/lib/odoo/types'

export const metadata = { title: 'Documents · Async School' }

/** A document belongs to either a student or a staff member, never both. */
function owner(student: Many2one, staff: Many2one): string {
  return student ? student[1] : staff ? staff[1] : '—'
}

export default async function DocumentsPage({ searchParams }: PageProps<'/documents'>) {
  const [states, types] = await Promise.all([
    selectionOptions('school.document', 'state'),
    documentTypeOptions(),
  ])

  return (
    <ResourceList
      title="Documents"
      icon="documents"
      basePath="/documents"
      searchParams={searchParams}
      subtitle="Odoo records a checksum and refuses to delete document history."
      search={{ placeholder: 'Document, student or staff name' }}
      filters={[
        { key: 'status', label: 'Status', options: states },
        { key: 'type', label: 'Type', options: types },
      ]}
      load={(query) =>
        listDocuments({
          search: query.search,
          filters: query.filters,
          order: toOdooOrder(query),
          limit: query.limit,
          offset: query.offset,
        })
      }
      rowHref={(row) => `/documents/${row.id}`}
      emptyTitle="No documents visible"
      emptyHint="Document access is restricted to the registrar and HR."
      columns={[
        {
          key: 'name',
          label: 'Document',
          sortField: 'name',
          render: (row) => <RowLink href={`/documents/${row.id}`}>{row.name}</RowLink>,
        },
        { key: 'type', label: 'Type', render: (row) => m2oLabel(row.document_type_id) },
        { key: 'owner', label: 'Owner', render: (row) => owner(row.student_id, row.staff_id) },
        {
          key: 'expires',
          label: 'Expires',
          hideBelow: 'md',
          render: (row) => formatDate(row.expiry_date),
        },
        {
          key: 'verifiedBy',
          label: 'Verified by',
          hideBelow: 'lg',
          render: (row) => m2oLabel(row.verified_by_id),
        },
        { key: 'state', label: 'Status', render: (row) => <StatusBadge state={row.state} /> },
      ]}
    />
  )
}
