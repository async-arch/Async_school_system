import 'server-only'
import type { Domain } from './types'

/**
 * Turning a list screen's URL query into an Odoo domain.
 *
 * Every list service takes the same options and builds its domain from these
 * two helpers, so "search" and "filter" mean the same thing on every screen.
 * The mapping from a query-string key to an Odoo field is declared per service
 * — the browser never names a field, only a key the service already knows.
 */

export interface ListOptions {
  search?: string
  filters?: Record<string, string>
  /** Already validated against the screen's allowlist in lib/list-query.ts. */
  order?: string
  limit?: number
  offset?: number
}

/**
 * `term` matched against any of `fields`, as Odoo's prefix-notation OR.
 *
 * Three fields become `['|', '|', a, b, c]`: one fewer `|` than there are
 * terms, all of them first.
 */
export function searchDomain(term: string | undefined, fields: readonly string[]): Domain {
  const needle = term?.trim()
  if (!needle || fields.length === 0) return []
  const conditions = fields.map((field) => [field, 'ilike', needle])
  return [...Array(conditions.length - 1).fill('|'), ...conditions]
}

export type FilterKind = 'selection' | 'many2one' | 'date' | 'boolean'

export interface FilterField {
  field: string
  kind?: FilterKind
}

/**
 * Equality terms for whichever filters the URL actually carried.
 *
 * A many2one filter arrives as a string and has to reach Odoo as an integer,
 * and a non-numeric value is dropped rather than sent — a hand-edited URL
 * should narrow to nothing at worst, never raise.
 */
export function filterDomain(
  filters: Record<string, string> | undefined,
  spec: Record<string, FilterField>,
): Domain {
  if (!filters) return []
  const domain: Domain = []

  for (const [key, raw] of Object.entries(filters)) {
    const definition = spec[key]
    if (!definition || !raw) continue

    switch (definition.kind) {
      case 'many2one': {
        const id = Number(raw)
        if (Number.isInteger(id) && id > 0) domain.push([definition.field, '=', id])
        break
      }
      case 'boolean':
        domain.push([definition.field, '=', raw === 'true'])
        break
      case 'date':
        if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) domain.push([definition.field, '=', raw])
        break
      default:
        domain.push([definition.field, '=', raw])
    }
  }
  return domain
}

/** The domain for a list screen: its own base terms, then search, then filters. */
export function listDomain(
  options: ListOptions,
  config: {
    base?: Domain
    searchFields?: readonly string[]
    filters?: Record<string, FilterField>
  },
): Domain {
  return [
    ...(config.base ?? []),
    ...searchDomain(options.search, config.searchFields ?? []),
    ...filterDomain(options.filters, config.filters ?? {}),
  ]
}
