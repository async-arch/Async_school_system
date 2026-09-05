'use client'

import { useActionState } from 'react'
import { Badge, Button, Card, Cell, DataTable, EmptyState, Row, cx } from '@/components/ui'
import { FormError, FormSuccess, INPUT_CLASS, INPUT_INVALID } from '@/components/ui/form'
import {
  createVocabularyRowAction,
  updateVocabularyRowAction,
  type VocabularyFormState,
} from '../actions'

/**
 * One vocabulary, edited in place.
 *
 * These lists are small — twelve grades, two streams, five sections — and the
 * whole job is usually "rename that one" or "add a B". Sending somebody to a
 * separate page and back for a two-field record costs more than it explains,
 * so each row is its own form and the last row adds a new one. It is the shape
 * the grading bands and document rules screens already use.
 *
 * Every input is named for its Odoo field, and the spec that produced the
 * columns is the same one the server action validates against, so the two
 * cannot drift.
 */

export interface FieldView {
  name: string
  label: string
  kind: 'text' | 'integer' | 'boolean' | 'selection' | 'clock'
  required?: boolean
  help?: string
}

export interface RowView {
  id: number
  values: Record<string, string>
  /** Computed columns the form does not write. */
  readOnly: Record<string, string>
}

export function VocabularyManager({
  vocabulary,
  singular,
  fields,
  readOnlyColumns,
  rows,
  choices,
  canCreate,
  canWrite,
}: {
  vocabulary: string
  singular: string
  fields: FieldView[]
  readOnlyColumns: Array<{ name: string; label: string }>
  rows: RowView[]
  choices: Record<string, Array<{ value: string; label: string }>>
  canCreate: boolean
  canWrite: boolean
}) {
  const columns = [
    ...fields.map((field) => field.label),
    ...readOnlyColumns.map((column) => column.label),
    ...(canWrite ? [''] : []),
  ]

  return (
    <div className="space-y-4">
      <Card padded={false}>
        {rows.length === 0 ? (
          <EmptyState title={`No ${singular}s recorded`} />
        ) : (
          <DataTable columns={columns} caption={singular}>
            {rows.map((row) => (
              <EditableRow
                key={row.id}
                row={row}
                vocabulary={vocabulary}
                fields={fields}
                readOnlyColumns={readOnlyColumns}
                choices={choices}
                canWrite={canWrite}
              />
            ))}
          </DataTable>
        )}
      </Card>

      {canCreate ? (
        <AddRow vocabulary={vocabulary} singular={singular} fields={fields} choices={choices} />
      ) : null}
    </div>
  )
}

/* ------------------------------------------------------------- one row --- */

function EditableRow({
  row,
  vocabulary,
  fields,
  readOnlyColumns,
  choices,
  canWrite,
}: {
  row: RowView
  vocabulary: string
  fields: FieldView[]
  readOnlyColumns: Array<{ name: string; label: string }>
  choices: Record<string, Array<{ value: string; label: string }>>
  canWrite: boolean
}) {
  const [state, action, pending] = useActionState<VocabularyFormState, FormData>(
    updateVocabularyRowAction,
    {},
  )
  const mine = state.target === String(row.id)
  const formId = `vocabulary-${vocabulary}-${row.id}`
  const archived = row.values.active === 'false'

  return (
    <>
      <Row>
        {fields.map((field) => (
          <Cell key={field.name}>
            <Input
              field={field}
              formId={formId}
              rowKey={String(row.id)}
              defaultValue={row.values[field.name] ?? ''}
              choices={choices[field.name]}
              error={mine ? state.fieldErrors?.[field.name] : undefined}
              disabled={!canWrite}
            />
          </Cell>
        ))}
        {readOnlyColumns.map((column) => (
          <Cell key={column.name} numeric>
            {row.readOnly[column.name] ?? '—'}
          </Cell>
        ))}
        {canWrite ? (
          <Cell>
            <div className="flex items-center gap-2">
              {/*
                The form element sits outside the row so the table markup stays
                a table; the inputs above join it by id.
              */}
              <form id={formId} action={action}>
                <input type="hidden" name="vocabulary" value={vocabulary} />
                <input type="hidden" name="id" value={row.id} />
              </form>
              <Button type="submit" form={formId} variant="quiet" size="sm" disabled={pending}>
                {pending ? 'Saving…' : 'Save'}
              </Button>
              {archived ? <Badge tone="neutral">Archived</Badge> : null}
            </div>
          </Cell>
        ) : null}
      </Row>
      {mine && (state.error || state.saved) ? (
        <Row>
          <Cell>
            <div className="py-1">
              {state.error ? <FormError>{state.error}</FormError> : null}
              {state.saved && !state.error ? <FormSuccess>Saved.</FormSuccess> : null}
            </div>
          </Cell>
        </Row>
      ) : null}
    </>
  )
}

/* --------------------------------------------------------- the add form --- */

function AddRow({
  vocabulary,
  singular,
  fields,
  choices,
}: {
  vocabulary: string
  singular: string
  fields: FieldView[]
  choices: Record<string, Array<{ value: string; label: string }>>
}) {
  const [state, action, pending] = useActionState<VocabularyFormState, FormData>(
    createVocabularyRowAction,
    {},
  )
  const mine = state.target === 'new'

  return (
    <Card>
      <h2 className="mb-3 text-[14px] font-medium text-graphite">Add a {singular}</h2>
      <form action={action} className="space-y-3">
        <input type="hidden" name="vocabulary" value={vocabulary} />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {fields.map((field) => (
            <div key={field.name} className="min-w-0">
              <label
                htmlFor={`new-${field.name}`}
                className="mb-1.5 block text-[12px] font-medium text-graphite"
              >
                {field.label}
                {field.required ? (
                  <span className="ml-0.5 text-danger" aria-hidden>
                    *
                  </span>
                ) : null}
              </label>
              <Input
                field={field}
                rowKey="new"
                defaultValue={field.name === 'active' ? 'true' : ''}
                choices={choices[field.name]}
                error={mine ? state.fieldErrors?.[field.name] : undefined}
              />
              {field.help && !(mine && state.fieldErrors?.[field.name]) ? (
                <p className="mt-1 text-[11px] text-stone">{field.help}</p>
              ) : null}
              {mine && state.fieldErrors?.[field.name] ? (
                <p role="alert" className="mt-1 text-[11px] text-danger">
                  {state.fieldErrors[field.name]}
                </p>
              ) : null}
            </div>
          ))}
        </div>

        {mine && state.error ? <FormError>{state.error}</FormError> : null}
        {mine && state.saved && !state.error ? (
          <FormSuccess>Added. It is available everywhere that offers a {singular}.</FormSuccess>
        ) : null}

        <Button type="submit" variant="primary" size="sm" disabled={pending}>
          {pending ? 'Adding…' : `Add ${singular}`}
        </Button>
      </form>
    </Card>
  )
}

/* ------------------------------------------------------------ one input --- */

function Input({
  field,
  formId,
  rowKey,
  defaultValue,
  choices,
  error,
  disabled,
}: {
  field: FieldView
  formId?: string
  rowKey: string
  defaultValue: string
  choices?: Array<{ value: string; label: string }>
  error?: string
  disabled?: boolean
}) {
  const id = `${rowKey}-${field.name}`
  const shared = {
    id,
    name: field.name,
    form: formId,
    disabled,
    'aria-label': field.label,
    'aria-invalid': error ? true : undefined,
    className: cx(INPUT_CLASS, error && INPUT_INVALID),
  }

  if (field.kind === 'boolean') {
    return (
      <span className="flex items-center gap-2">
        {/* Paired with the box so clearing it sends "false" rather than nothing. */}
        <input type="hidden" name={field.name} value="false" form={formId} />
        <input
          type="checkbox"
          id={id}
          name={field.name}
          value="true"
          form={formId}
          disabled={disabled}
          defaultChecked={defaultValue === 'true'}
          aria-label={field.label}
          className="h-4 w-4 rounded border-silver text-action-blue focus:ring-action-blue"
        />
      </span>
    )
  }

  if (field.kind === 'selection') {
    return (
      <select {...shared} defaultValue={defaultValue}>
        <option value="">—</option>
        {(choices ?? []).map((choice) => (
          <option key={choice.value} value={choice.value}>
            {choice.label}
          </option>
        ))}
      </select>
    )
  }

  return (
    <input
      {...shared}
      type={field.kind === 'clock' ? 'time' : field.kind === 'integer' ? 'number' : 'text'}
      defaultValue={defaultValue}
      {...(field.kind === 'integer' ? { step: 1 } : {})}
    />
  )
}
