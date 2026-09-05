'use server'

import { revalidatePath } from 'next/cache'

import { requireSession } from '@/lib/odoo/auth'
import { toOdooError } from '@/lib/odoo/errors'
import {
  collectVocabulary,
  createVocabulary,
  getVocabulary,
  updateVocabulary,
  type FieldErrors,
} from '@/lib/odoo/models/vocabulary'

/**
 * Creating and editing one row of an academic vocabulary.
 *
 * The browser posts a vocabulary key, never a model name — the key is resolved
 * against the spec table here, and an unknown one is refused rather than
 * passed through. That keeps these two actions from being a general-purpose
 * write endpoint onto any Odoo model.
 *
 * Odoo owns every rule these forms touch: unique codes, one grade per level,
 * a shift whose end is after its start, a job title unique within its
 * department. Each answers in its own words, so nothing here guesses at the
 * message.
 */

export interface VocabularyFormState {
  error?: string
  fieldErrors?: FieldErrors
  /** Which row the message belongs to — 'new' for the add form. */
  target?: string
  /** Set on success so the form can say so without a full navigation. */
  saved?: string
}

function text(form: FormData, key: string): string {
  return String(form.get(key) ?? '')
}

/*
  An unchecked checkbox submits nothing at all, so every box is paired with a
  hidden "false" and the last value wins. Without that, clearing "Active" would
  send no key and Odoo would leave the record as it was.
*/
function lastValue(form: FormData, key: string): string {
  return String(form.getAll(key).at(-1) ?? '')
}

function resolve(form: FormData) {
  const key = text(form, 'vocabulary')
  const spec = getVocabulary(key)
  return { key, spec }
}

export async function createVocabularyRowAction(
  _previous: VocabularyFormState,
  form: FormData,
): Promise<VocabularyFormState> {
  await requireSession()

  const { key, spec } = resolve(form)
  if (!spec) return { error: 'That configuration list does not exist.', target: 'new' }

  const { values, fieldErrors } = collectVocabulary(
    spec,
    (name) => lastValue(form, name),
    (name) => form.has(name),
  )
  if (fieldErrors) return { fieldErrors, target: 'new' }

  try {
    await createVocabulary(spec, values ?? {})
  } catch (cause) {
    return { error: toOdooError(cause).message, target: 'new' }
  }

  revalidatePath(`/configuration/vocabulary/${key}`)
  revalidatePath('/configuration')
  return { saved: `${spec.singular} added`, target: 'new' }
}

export async function updateVocabularyRowAction(
  _previous: VocabularyFormState,
  form: FormData,
): Promise<VocabularyFormState> {
  await requireSession()

  const { key, spec } = resolve(form)
  if (!spec) return { error: 'That configuration list does not exist.' }

  const id = Number(text(form, 'id'))
  if (!Number.isInteger(id) || id <= 0) {
    return { error: 'That row could not be identified.' }
  }

  const { values, fieldErrors } = collectVocabulary(
    spec,
    (name) => lastValue(form, name),
    (name) => form.has(name),
  )
  if (fieldErrors) return { fieldErrors, target: String(id) }

  try {
    await updateVocabulary(spec, id, values ?? {})
  } catch (cause) {
    return { error: toOdooError(cause).message, target: String(id) }
  }

  revalidatePath(`/configuration/vocabulary/${key}`)
  revalidatePath('/configuration')
  return { saved: 'saved', target: String(id) }
}
