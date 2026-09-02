import 'server-only'
import { cache } from 'react'
import { searchRead } from './client'
import { orNullOnRefusal } from './errors'
import type { FilterOption } from '@/components/list-toolbar'

/**
 * Choices for the relational filters — classes, subjects, terms, years.
 *
 * Each is read as the signed-in user, so the dropdown only ever offers what
 * that person can already see; a role whose record rules hide every class gets
 * an empty filter rather than a list of names it may not read. A refusal
 * resolves to an empty list, because a filter that cannot be populated should
 * quietly not appear, not take the page down with it.
 *
 * `cache` dedupes within a request, so a screen offering both a class and a
 * subject filter still makes one call each.
 */

const options = cache(
  async (
    model: string,
    fields: readonly string[],
    order: string,
    label: (row: Record<string, unknown>) => string,
    domain: unknown[] = [],
    limit = 200,
  ): Promise<FilterOption[]> => {
    const page = await orNullOnRefusal(
      searchRead<Record<string, unknown>>(model, fields, { domain, limit, order }),
    )
    return (page?.rows ?? []).map((row) => ({ value: String(row.id), label: label(row) }))
  },
)

export function classOptions(): Promise<FilterOption[]> {
  return options('school.class', ['name'], 'name', (row) => String(row.name), [
    ['active', '=', true],
  ])
}

export function subjectOptions(): Promise<FilterOption[]> {
  return options('school.subject', ['name'], 'name', (row) => String(row.name), [
    ['active', '=', true],
  ])
}

export function termOptions(): Promise<FilterOption[]> {
  return options(
    'school.term',
    ['name', 'academic_year_id'],
    'academic_year_id desc, sequence',
    (row) => {
      const year = row.academic_year_id as [number, string] | false
      return year ? `${row.name} · ${year[1]}` : String(row.name)
    },
    [],
    100,
  )
}

export function academicYearOptions(): Promise<FilterOption[]> {
  return options('school.academic.year', ['name'], 'name desc', (row) => String(row.name), [], 50)
}

export function gradeOptions(): Promise<FilterOption[]> {
  return options('school.grade', ['name'], 'sequence, name', (row) => String(row.name), [
    ['active', '=', true],
  ])
}

export function documentTypeOptions(): Promise<FilterOption[]> {
  return options('school.document.type', ['name'], 'name', (row) => String(row.name), [
    ['active', '=', true],
  ])
}
