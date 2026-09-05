'use client'

import { useActionState, useState } from 'react'
import { Button, Card, Note, cx } from '@/components/ui'
import { Field, FormActions, FormError, INPUT_CLASS, INPUT_INVALID } from '@/components/ui/form'
import { createPromotionBatchAction, type PromotionFormState } from './actions'

/**
 * A promotion batch: one grade, moving from one academic year to the next.
 *
 * The class list narrows as the year and grade are chosen, because that is the
 * domain `class_ids` carries on the model. Leaving it empty is the normal case
 * and means every class of that grade — which is exactly what Odoo falls back
 * to when it calculates.
 *
 * Nothing here decides an outcome. The thresholds are stored on the batch and
 * Odoo applies them against each student's published results when the batch is
 * calculated.
 */

export interface YearChoice {
  id: number
  name: string
  date_start: string
  date_end: string
}

export interface GradeChoice {
  id: number
  name: string
}

export interface ClassChoice {
  id: number
  name: string
  yearId: number
  gradeId: number
}

export function PromotionForm({
  years,
  grades,
  classes,
}: {
  years: YearChoice[]
  grades: GradeChoice[]
  classes: ClassChoice[]
}) {
  const [state, action, pending] = useActionState<PromotionFormState, FormData>(
    createPromotionBatchAction,
    {},
  )

  const value = (field: string) => state.values?.[field] ?? ''
  const error = (field: string) => state.fieldErrors?.[field]

  /*
    The class picker depends on the year and the grade, so those two are the
    only fields this component tracks. Everything else is uncontrolled and
    re-seeded from the rejected submission — React 19 resets a form once its
    action returns, so a field that held its own state would silently lose
    whatever the user had just typed.
  */
  const [yearId, setYearId] = useState(value('academicYearId'))
  const [gradeId, setGradeId] = useState(value('gradeId'))
  const formKey = state.values ? JSON.stringify(state.values) : 'initial'

  const scoped = classes.filter(
    (row) => String(row.yearId) === yearId && String(row.gradeId) === gradeId,
  )

  return (
    <form action={action}>
      <Card>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Year ending"
            htmlFor="academicYearId"
            required
            error={error('academicYearId')}
            hint="The year whose results decide each outcome."
          >
            <select
              id="academicYearId"
              name="academicYearId"
              value={yearId}
              onChange={(event) => setYearId(event.target.value)}
              className={cx(INPUT_CLASS, error('academicYearId') && INPUT_INVALID)}
            >
              <option value="">Choose a year…</option>
              {years.map((year) => (
                <option key={year.id} value={year.id}>
                  {year.name}
                </option>
              ))}
            </select>
          </Field>

          <Field
            label="Year students move into"
            htmlFor="targetAcademicYearId"
            required
            error={error('targetAcademicYearId')}
            hint="Must start after the ending year finishes."
          >
            <select
              id="targetAcademicYearId"
              name="targetAcademicYearId"
              key={`target-${formKey}`}
              defaultValue={value('targetAcademicYearId')}
              className={cx(INPUT_CLASS, error('targetAcademicYearId') && INPUT_INVALID)}
            >
              <option value="">Choose a year…</option>
              {years.map((year) => (
                <option key={year.id} value={year.id}>
                  {year.name}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Grade" htmlFor="gradeId" required error={error('gradeId')}>
            <select
              id="gradeId"
              name="gradeId"
              value={gradeId}
              onChange={(event) => setGradeId(event.target.value)}
              className={cx(INPUT_CLASS, error('gradeId') && INPUT_INVALID)}
            >
              <option value="">Choose a grade…</option>
              {grades.map((grade) => (
                <option key={grade.id} value={grade.id}>
                  {grade.name}
                </option>
              ))}
            </select>
          </Field>

          <Field
            label="Minimum pass average (%)"
            htmlFor="minimumPassAverage"
            required
            error={error('minimumPassAverage')}
            hint="A student at or above this is promoted."
          >
            <input
              id="minimumPassAverage"
              name="minimumPassAverage"
              type="number"
              step="0.1"
              min="0"
              max="100"
              key={`avg-${formKey}`}
              defaultValue={value('minimumPassAverage') || '50'}
              className={cx(INPUT_CLASS, error('minimumPassAverage') && INPUT_INVALID)}
            />
          </Field>

          <Field
            label="Allowed failed subjects"
            htmlFor="maxFailedSubjects"
            required
            error={error('maxFailedSubjects')}
          >
            <input
              id="maxFailedSubjects"
              name="maxFailedSubjects"
              type="number"
              step="1"
              min="0"
              key={`failed-${formKey}`}
              defaultValue={value('maxFailedSubjects') || '0'}
              className={cx(INPUT_CLASS, error('maxFailedSubjects') && INPUT_INVALID)}
            />
          </Field>

          <div className="sm:col-span-2">
            <Field
              label="Classes included"
              htmlFor="classIds"
              hint={
                yearId && gradeId
                  ? 'Leave everything unticked to include every class of this grade, which is the usual case.'
                  : 'Choose a year and a grade first.'
              }
            >
              {scoped.length === 0 ? (
                <p className="rounded-[8px] border border-dashed border-silver px-3 py-2 text-[13px] text-stone">
                  {yearId && gradeId
                    ? 'That grade has no classes in that year.'
                    : 'Nothing to choose yet.'}
                </p>
              ) : (
                <div className="flex flex-wrap gap-x-5 gap-y-2">
                  {scoped.map((row) => (
                    <label key={row.id} className="flex items-center gap-2 text-[13px]">
                      <input
                        type="checkbox"
                        name="classIds"
                        value={row.id}
                        className="h-4 w-4 rounded border-silver text-action-blue focus:ring-action-blue"
                      />
                      {row.name}
                    </label>
                  ))}
                </div>
              )}
            </Field>
          </div>
        </div>

        {state.error ? (
          <div className="mt-4">
            <FormError>{state.error}</FormError>
          </div>
        ) : null}

        <FormActions>
          <Button type="submit" variant="primary" disabled={pending}>
            {pending ? 'Creating…' : 'Create batch'}
          </Button>
        </FormActions>
      </Card>

      <Note>
        Creating the batch does not move anybody. Odoo calculates each outcome from published
        results, the batch is then approved, and only applying it advances the enrolments — three
        separate steps on the batch itself.
      </Note>
    </form>
  )
}
