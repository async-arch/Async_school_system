'use server'

import { revalidatePath } from 'next/cache'

import { requireSession } from '@/lib/odoo/auth'
import { toOdooError } from '@/lib/odoo/errors'
import { createTerm, updateTerm } from '@/lib/odoo/models/operations'

/**
 * Creating and editing academic terms.
 *
 * A term is the unit assessments, marks, report cards and teaching
 * assignments are all filed under, and until now it could be created nowhere
 * in this application — a school could open an academic year and then had no
 * way to divide it.
 *
 * Odoo owns the rules and states them well: a term cannot start before its
 * academic year or end after it, its end cannot precede its start, and its
 * name is unique within the year. Those messages are passed through rather
 * than restated. The only checks here are the ones that save a round trip.
 */

export interface TermFormState {
  error?: string
  fieldErrors?: Record<string, string>
  /** Which row the message belongs to — 'new' for the add form. */
  target?: string
  saved?: boolean
}

function text(form: FormData, key: string): string {
  return String(form.get(key) ?? '').trim()
}

function lastValue(form: FormData, key: string): string {
  return String(form.getAll(key).at(-1) ?? '')
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

function collect(form: FormData): {
  values?: Record<string, unknown>
  fieldErrors?: Record<string, string>
} {
  const fieldErrors: Record<string, string> = {}

  const name = text(form, 'name')
  if (!name) fieldErrors.name = 'The term needs a name.'

  const yearId = Number(text(form, 'academic_year_id'))
  if (!Number.isInteger(yearId) || yearId <= 0) {
    fieldErrors.academic_year_id = 'Choose the academic year this term belongs to.'
  }

  const dateStart = text(form, 'date_start')
  const dateEnd = text(form, 'date_end')
  if (!ISO_DATE.test(dateStart)) fieldErrors.date_start = 'Give the term a start date.'
  if (!ISO_DATE.test(dateEnd)) fieldErrors.date_end = 'Give the term an end date.'
  if (!fieldErrors.date_start && !fieldErrors.date_end && dateEnd < dateStart) {
    // Mirrors the model's CHECK(date_end >= date_start); Odoo still enforces it.
    fieldErrors.date_end = 'The end date cannot be before the start date.'
  }

  const rawSequence = text(form, 'sequence')
  const sequence = rawSequence === '' ? 10 : Number(rawSequence)
  if (!Number.isInteger(sequence)) {
    fieldErrors.sequence = 'Sequence must be a whole number.'
  }

  if (Object.keys(fieldErrors).length > 0) return { fieldErrors }

  return {
    values: {
      name,
      academic_year_id: yearId,
      date_start: dateStart,
      date_end: dateEnd,
      sequence,
      ...(form.has('active') ? { active: lastValue(form, 'active') === 'true' } : {}),
    },
  }
}

export async function createTermAction(
  _previous: TermFormState,
  form: FormData,
): Promise<TermFormState> {
  await requireSession()

  const { values, fieldErrors } = collect(form)
  if (fieldErrors) return { fieldErrors, target: 'new' }

  try {
    await createTerm(values ?? {})
  } catch (cause) {
    return { error: toOdooError(cause).message, target: 'new' }
  }

  revalidatePath('/configuration/terms')
  revalidatePath('/configuration')
  return { saved: true, target: 'new' }
}

export async function updateTermAction(
  _previous: TermFormState,
  form: FormData,
): Promise<TermFormState> {
  await requireSession()

  const id = Number(text(form, 'id'))
  if (!Number.isInteger(id) || id <= 0) return { error: 'That term could not be identified.' }

  const { values, fieldErrors } = collect(form)
  if (fieldErrors) return { fieldErrors, target: String(id) }

  try {
    await updateTerm(id, values ?? {})
  } catch (cause) {
    return { error: toOdooError(cause).message, target: String(id) }
  }

  revalidatePath('/configuration/terms')
  revalidatePath('/configuration')
  return { saved: true, target: String(id) }
}
