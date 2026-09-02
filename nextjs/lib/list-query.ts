/**
 * The query behind every list screen, expressed in the URL.
 *
 * Search, filters, sort and page all live in the query string, which buys three
 * things for free: the back button works, a filtered list can be linked to or
 * bookmarked, and — because the page is a server component — every change
 * re-queries Odoo rather than narrowing rows the browser happens to be holding.
 * That last point is not a nicety. A page is a page: filtering fifty visible
 * rows out of nine hundred, or sorting them, would quietly give a wrong answer.
 */

export type SortDirection = 'asc' | 'desc'

export interface ListQuery {
  /** The free-text term, already trimmed. */
  search?: string
  /** Filter key to selected value. Only non-empty values appear. */
  filters: Record<string, string>
  sortField?: string
  sortDirection: SortDirection
  page: number
  limit: number
  offset: number
}

/** What a page receives from Next, before we make sense of it. */
export type RawSearchParams = Record<string, string | string[] | undefined>

function one(params: RawSearchParams, key: string): string | undefined {
  const value = params[key]
  const first = Array.isArray(value) ? value[0] : value
  const trimmed = first?.trim()
  return trimmed ? trimmed : undefined
}

export function parseListQuery(
  params: RawSearchParams,
  options: {
    /** Filter keys this screen understands. Anything else in the URL is ignored. */
    filterKeys?: readonly string[]
    /** Sort fields this screen allows — an allowlist, so the URL cannot name
     *  an arbitrary Odoo field to order by. */
    sortFields?: readonly string[]
    defaultSort?: { field: string; direction: SortDirection }
    pageSize?: number
  } = {},
): ListQuery {
  const { filterKeys = [], sortFields = [], defaultSort, pageSize = 25 } = options

  const filters: Record<string, string> = {}
  for (const key of filterKeys) {
    const value = one(params, key)
    if (value) filters[key] = value
  }

  const [rawField, rawDirection] = (one(params, 'sort') ?? '').split(':')
  const sortField = sortFields.includes(rawField) ? rawField : defaultSort?.field
  const sortDirection: SortDirection =
    rawDirection === 'desc' || rawDirection === 'asc'
      ? rawDirection
      : sortField === defaultSort?.field
        ? (defaultSort?.direction ?? 'asc')
        : 'asc'

  const page = Math.max(1, Number(one(params, 'page') ?? '1') || 1)

  return {
    search: one(params, 'q'),
    filters,
    sortField,
    sortDirection,
    page,
    limit: pageSize,
    offset: (page - 1) * pageSize,
  }
}

/** The `order` string for Odoo, or undefined to keep the model's own order. */
export function toOdooOrder(query: ListQuery): string | undefined {
  return query.sortField ? `${query.sortField} ${query.sortDirection}` : undefined
}

/**
 * Link builders for the toolbar and the table headings.
 *
 * Changing a search term, a filter or the sort always returns to page one:
 * staying on page seven of a result set that no longer has seven pages is how
 * a list ends up looking empty for no visible reason.
 */
export function listHrefs(basePath: string, params: RawSearchParams, query: ListQuery) {
  const build = (changes: Record<string, string | undefined>, keepPage = false) => {
    const next = new URLSearchParams()
    for (const [key, value] of Object.entries(params)) {
      const single = Array.isArray(value) ? value[0] : value
      if (single) next.set(key, single)
    }
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value)
      else next.delete(key)
    }
    if (!keepPage) next.delete('page')
    const search = next.toString()
    return search ? `${basePath}?${search}` : basePath
  }

  return {
    forPage: (page: number) => build({ page: page > 1 ? String(page) : undefined }, true),
    forSort: (field: string, direction: SortDirection) => build({ sort: `${field}:${direction}` }),
    forFilter: (key: string, value: string | undefined) => build({ [key]: value }),
    cleared: basePath,
    /** True when anything is narrowing the list, so a "clear" control is useful. */
    isNarrowed: Boolean(query.search) || Object.keys(query.filters).length > 0,
  }
}
