import Link from 'next/link'
import type { ReactNode } from 'react'
import { FilterSelect, SearchField, type FilterSpec } from '@/components/list-toolbar'
import {
  Card,
  Cell,
  DataTable,
  EmptyState,
  ErrorState,
  PageHeader,
  Pagination,
  Row,
  SortHeader,
  Toolbar,
  type Column,
} from '@/components/ui'
import type { IconName } from '@/components/icons'
import { pluralise } from '@/lib/format'
import { listHrefs, parseListQuery, type ListQuery, type RawSearchParams } from '@/lib/list-query'
import { toOdooError } from '@/lib/odoo/errors'
import type { Page } from '@/lib/odoo/types'

/**
 * The shape every list screen shares: read the query out of the URL, fetch one
 * page from Odoo, render it, and turn a refusal into an explanation rather
 * than a crash.
 *
 * Several roles legitimately cannot read some models, so FORBIDDEN is an
 * expected outcome here and not an incident — it renders as a boundary, with
 * no suggestion of a way around it.
 *
 * Search, filtering, sorting and paging are all pushed into the Odoo query.
 * `load` receives the parsed query and is responsible for turning it into a
 * domain; the shell never touches the domain itself.
 */

export interface ListColumn<T> extends Omit<Column, 'header' | 'sort'> {
  /** The Odoo field to order by. Omit for a column that cannot be sorted. */
  sortField?: string
  render: (row: T) => ReactNode
}

export async function ResourceList<T extends { id: number }>({
  title,
  subtitle,
  icon,
  basePath,
  searchParams,
  load,
  columns,
  action,
  search,
  filters = [],
  defaultSort,
  pageSize = 25,
  emptyTitle,
  emptyHint,
  emptyIcon,
  emptyAction,
  rowHref,
  caption,
}: {
  title: string
  /** Overrides the default "n records visible to you". */
  subtitle?: string
  icon?: IconName
  /** Where this list lives, for building filter and page links. */
  basePath: string
  searchParams: Promise<RawSearchParams>
  load: (query: ListQuery) => Promise<Page<T>>
  columns: Array<ListColumn<T>>
  action?: ReactNode
  search?: { placeholder: string }
  filters?: FilterSpec[]
  defaultSort?: { field: string; direction: 'asc' | 'desc' }
  pageSize?: number
  emptyTitle: string
  emptyHint?: string
  emptyIcon?: IconName
  emptyAction?: ReactNode
  /** Makes the first cell a link to the record. */
  rowHref?: (row: T) => string
  caption?: string
}) {
  const params = await searchParams
  const query = parseListQuery(params, {
    filterKeys: filters.map((filter) => filter.key),
    sortFields: columns.flatMap((column) => (column.sortField ? [column.sortField] : [])),
    defaultSort,
    pageSize,
  })
  const hrefs = listHrefs(basePath, params, query)

  let result: Page<T>
  try {
    result = await load(query)
  } catch (cause) {
    const error = toOdooError(cause)
    return (
      <>
        <PageHeader title={title} />
        <ErrorState {...error.toClient()} retryHref={basePath} />
      </>
    )
  }

  const hasToolbar = Boolean(search) || filters.length > 0

  const tableColumns: Column[] = columns.map((column) => ({
    key: column.key,
    label: column.label,
    numeric: column.numeric,
    hideBelow: column.hideBelow,
    sort: column.sortField
      ? query.sortField === column.sortField
        ? query.sortDirection === 'asc'
          ? 'ascending'
          : 'descending'
        : 'none'
      : undefined,
    header: column.sortField ? (
      <SortHeader
        field={column.sortField}
        label={column.label}
        numeric={column.numeric}
        activeField={query.sortField}
        activeDirection={query.sortDirection}
        hrefFor={hrefs.forSort}
      />
    ) : undefined,
  }))

  return (
    <>
      <PageHeader
        title={title}
        subtitle={subtitle ?? `${pluralise(result.total, 'record')} visible to you`}
        action={action}
      />

      <Card padded={false}>
        {hasToolbar ? (
          <Toolbar
            hint={
              hrefs.isNarrowed ? (
                <Link href={hrefs.cleared} className="text-action-blue hover:underline">
                  Clear filters
                </Link>
              ) : undefined
            }
          >
            {search ? <SearchField placeholder={search.placeholder} /> : null}
            {filters.map((filter) => (
              <FilterSelect key={filter.key} filter={filter} />
            ))}
          </Toolbar>
        ) : null}

        {result.rows.length === 0 ? (
          hrefs.isNarrowed ? (
            <EmptyState
              icon="search"
              title="Nothing matches those filters"
              hint="Try a different term, or clear the filters to see the full list."
              action={
                <Link
                  href={hrefs.cleared}
                  className="rounded-[9999px] border border-silver bg-white px-4 py-2 text-[13px] hover:bg-paper"
                >
                  Clear filters
                </Link>
              }
            />
          ) : (
            <EmptyState
              icon={emptyIcon ?? icon}
              title={emptyTitle}
              hint={emptyHint}
              action={emptyAction}
            />
          )
        ) : (
          <DataTable columns={tableColumns} caption={caption ?? title}>
            {result.rows.map((row) => (
              <Row key={row.id} href={rowHref?.(row)}>
                {columns.map((column) => (
                  <Cell
                    key={column.key}
                    numeric={column.numeric}
                    hideBelow={column.hideBelow}
                    strong={column === columns[0]}
                  >
                    {column.render(row)}
                  </Cell>
                ))}
              </Row>
            ))}
          </DataTable>
        )}

        <Pagination
          page={query.page}
          pageSize={query.limit}
          total={result.total}
          hrefForPage={hrefs.forPage}
        />
      </Card>
    </>
  )
}

export { Cell }
