'use client'

import { useActionState } from 'react'
import { Badge, Button, Card, Cell, DataTable, EmptyState, Row, cx } from '@/components/ui'
import { FormError, FormSuccess, INPUT_CLASS, INPUT_INVALID } from '@/components/ui/form'
import { createTermAction, updateTermAction, type TermFormState } from './actions'

/**
 * Terms, edited in place against their academic year.
 *
 * A school has two or three terms per year, so the whole list fits on one
 * screen and separate create and edit routes would cost more navigation than
 * they explain. Each row is its own form; the card below adds one.
 *
 * The dates are plain `<input type="date">` values in ISO form, which is what
 * Odoo stores. No timezone conversion happens anywhere on this screen — an
 * academic date is a calendar date, and letting the browser shift it by an
 * hour would move a term boundary.
 */

export interface TermView {
  id: number
  name: string
  academicYearId: string
  dateStart: string
  dateEnd: string
  sequence: string
  active: boolean
}

export interface YearOption {
  id: number
  name: string
}

export function TermsManager({
  terms,
  years,
  canCreate,
  canWrite,
}: {
  terms: TermView[]
  years: YearOption[]
  canCreate: boolean
  canWrite: boolean
}) {
  return (
    <div className="space-y-4">
      <Card padded={false}>
        {terms.length === 0 ? (
          <EmptyState
            title="No terms yet"
            hint="Every assessment, mark list and report card is filed under a term."
          />
        ) : (
          <DataTable
            columns={[
              'Term',
              'Academic year',
              'Starts',
              'Ends',
              'Order',
              'Active',
              ...(canWrite ? [''] : []),
            ]}
            caption="Terms"
          >
            {terms.map((term) => (
              <TermRow key={term.id} term={term} years={years} canWrite={canWrite} />
            ))}
          </DataTable>
        )}
      </Card>

      {canCreate ? <AddTerm years={years} /> : null}
    </div>
  )
}

function TermRow({
  term,
  years,
  canWrite,
}: {
  term: TermView
  years: YearOption[]
  canWrite: boolean
}) {
  const [state, action, pending] = useActionState<TermFormState, FormData>(updateTermAction, {})
  const mine = state.target === String(term.id)
  const formId = `term-${term.id}`
  const error = (field: string) => (mine ? state.fieldErrors?.[field] : undefined)

  return (
    <>
      <Row>
        <Cell strong>
          <input
            name="name"
            form={formId}
            defaultValue={term.name}
            aria-label="Term name"
            disabled={!canWrite}
            className={cx(INPUT_CLASS, error('name') && INPUT_INVALID)}
          />
        </Cell>
        <Cell>
          <select
            name="academic_year_id"
            form={formId}
            defaultValue={term.academicYearId}
            aria-label="Academic year"
            disabled={!canWrite}
            className={cx(INPUT_CLASS, error('academic_year_id') && INPUT_INVALID)}
          >
            {years.map((year) => (
              <option key={year.id} value={year.id}>
                {year.name}
              </option>
            ))}
          </select>
        </Cell>
        <Cell>
          <input
            type="date"
            name="date_start"
            form={formId}
            defaultValue={term.dateStart}
            aria-label="Start date"
            disabled={!canWrite}
            className={cx(INPUT_CLASS, error('date_start') && INPUT_INVALID)}
          />
        </Cell>
        <Cell>
          <input
            type="date"
            name="date_end"
            form={formId}
            defaultValue={term.dateEnd}
            aria-label="End date"
            disabled={!canWrite}
            className={cx(INPUT_CLASS, error('date_end') && INPUT_INVALID)}
          />
        </Cell>
        <Cell numeric>
          <input
            type="number"
            step={1}
            name="sequence"
            form={formId}
            defaultValue={term.sequence}
            aria-label="Order"
            disabled={!canWrite}
            className={cx(INPUT_CLASS, error('sequence') && INPUT_INVALID)}
          />
        </Cell>
        <Cell>
          <input type="hidden" name="active" value="false" form={formId} />
          <input
            type="checkbox"
            name="active"
            value="true"
            form={formId}
            defaultChecked={term.active}
            disabled={!canWrite}
            aria-label="Active"
            className="h-4 w-4 rounded border-silver text-action-blue focus:ring-action-blue"
          />
        </Cell>
        {canWrite ? (
          <Cell>
            <div className="flex items-center gap-2">
              <form id={formId} action={action}>
                <input type="hidden" name="id" value={term.id} />
              </form>
              <Button type="submit" form={formId} variant="quiet" size="sm" disabled={pending}>
                {pending ? 'Saving…' : 'Save'}
              </Button>
              {term.active ? null : <Badge tone="neutral">Archived</Badge>}
            </div>
          </Cell>
        ) : null}
      </Row>
      {mine && (state.error || state.saved || state.fieldErrors) ? (
        <Row>
          <Cell>
            <div className="py-1">
              {state.error ? <FormError>{state.error}</FormError> : null}
              {state.fieldErrors ? (
                <FormError>{Object.values(state.fieldErrors).join(' ')}</FormError>
              ) : null}
              {state.saved && !state.error ? <FormSuccess>Saved.</FormSuccess> : null}
            </div>
          </Cell>
        </Row>
      ) : null}
    </>
  )
}

function AddTerm({ years }: { years: YearOption[] }) {
  const [state, action, pending] = useActionState<TermFormState, FormData>(createTermAction, {})
  const mine = state.target === 'new'
  const error = (field: string) => (mine ? state.fieldErrors?.[field] : undefined)

  return (
    <Card>
      <h2 className="mb-1 text-[14px] font-medium text-graphite">Add a term</h2>
      <p className="mb-3 text-[12px] text-stone">
        The dates must fall inside the academic year you choose — Odoo refuses a term that starts
        before it or ends after it.
      </p>
      <form action={action} className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <LabelledInput label="Term" htmlFor="new-name" error={error('name')} required>
            <input
              id="new-name"
              name="name"
              placeholder="Term 1"
              className={cx(INPUT_CLASS, error('name') && INPUT_INVALID)}
            />
          </LabelledInput>

          <LabelledInput
            label="Academic year"
            htmlFor="new-year"
            error={error('academic_year_id')}
            required
          >
            <select
              id="new-year"
              name="academic_year_id"
              defaultValue={years[0]?.id ?? ''}
              className={cx(INPUT_CLASS, error('academic_year_id') && INPUT_INVALID)}
            >
              {years.length === 0 ? <option value="">No academic year yet</option> : null}
              {years.map((year) => (
                <option key={year.id} value={year.id}>
                  {year.name}
                </option>
              ))}
            </select>
          </LabelledInput>

          <LabelledInput label="Starts" htmlFor="new-start" error={error('date_start')} required>
            <input
              id="new-start"
              type="date"
              name="date_start"
              className={cx(INPUT_CLASS, error('date_start') && INPUT_INVALID)}
            />
          </LabelledInput>

          <LabelledInput label="Ends" htmlFor="new-end" error={error('date_end')} required>
            <input
              id="new-end"
              type="date"
              name="date_end"
              className={cx(INPUT_CLASS, error('date_end') && INPUT_INVALID)}
            />
          </LabelledInput>

          <LabelledInput label="Order" htmlFor="new-sequence" error={error('sequence')}>
            <input
              id="new-sequence"
              type="number"
              step={1}
              name="sequence"
              defaultValue={10}
              className={cx(INPUT_CLASS, error('sequence') && INPUT_INVALID)}
            />
          </LabelledInput>
        </div>

        {mine && state.error ? <FormError>{state.error}</FormError> : null}
        {mine && state.saved && !state.error ? (
          <FormSuccess>Added. It is now offered wherever a term is chosen.</FormSuccess>
        ) : null}

        <Button type="submit" variant="primary" size="sm" disabled={pending || years.length === 0}>
          {pending ? 'Adding…' : 'Add term'}
        </Button>
      </form>
    </Card>
  )
}

function LabelledInput({
  label,
  htmlFor,
  error,
  required,
  children,
}: {
  label: string
  htmlFor: string
  error?: string
  required?: boolean
  children: React.ReactNode
}) {
  return (
    <div className="min-w-0">
      <label htmlFor={htmlFor} className="mb-1.5 block text-[12px] font-medium text-graphite">
        {label}
        {required ? (
          <span className="ml-0.5 text-danger" aria-hidden>
            *
          </span>
        ) : null}
      </label>
      {children}
      {error ? (
        <p role="alert" className="mt-1 text-[11px] text-danger">
          {error}
        </p>
      ) : null}
    </div>
  )
}
