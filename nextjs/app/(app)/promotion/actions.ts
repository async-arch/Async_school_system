'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

import { requireSession } from '@/lib/odoo/auth'
import { toOdooError } from '@/lib/odoo/errors'
import {
  createPromotionBatch,
  promotionFormOptions,
  unfinishedBatchesFor,
} from '@/lib/odoo/models/assessment'

/**
 * Creating a promotion batch.
 *
 * Odoo owns the rules and states them in its own words — the target year must
 * differ from the current one and must start after it ends, and only a
 * Registrar or an Administrator may manage a batch at all. Those messages are
 * passed through. The checks here save a round trip and, in one case, cover a
 * rule Odoo does not have.
 *
 * That one case is the duplicate check. There is no uniqueness constraint on
 * `school.promotion.batch`, so two batches for the same grade and year can
 * exist and running both would advance the same students twice. This refuses
 * that from the application; the Odoo backend would still permit it, which is
 * why the pull request asks for a model constraint rather than treating this
 * as the fix.
 */

export interface PromotionFormState {
  error?: string
  fieldErrors?: Record<string, string>
  values?: Record<string, string>
}

const FORM_FIELDS = [
  'academicYearId',
  'targetAcademicYearId',
  'gradeId',
  'minimumPassAverage',
  'maxFailedSubjects',
] as const

function text(form: FormData, key: string): string {
  return String(form.get(key) ?? '').trim()
}

function submitted(form: FormData): Record<string, string> {
  return Object.fromEntries(FORM_FIELDS.map((field) => [field, String(form.get(field) ?? '')]))
}

export async function createPromotionBatchAction(
  _previous: PromotionFormState,
  form: FormData,
): Promise<PromotionFormState> {
  await requireSession()

  const fieldErrors: Record<string, string> = {}

  const yearId = Number(text(form, 'academicYearId'))
  const targetYearId = Number(text(form, 'targetAcademicYearId'))
  const gradeId = Number(text(form, 'gradeId'))

  if (!Number.isInteger(yearId) || yearId <= 0) {
    fieldErrors.academicYearId = 'Choose the year that is ending.'
  }
  if (!Number.isInteger(targetYearId) || targetYearId <= 0) {
    fieldErrors.targetAcademicYearId = 'Choose the year students move into.'
  }
  if (yearId && targetYearId && yearId === targetYearId) {
    fieldErrors.targetAcademicYearId = 'The target year has to be a different year.'
  }
  if (!Number.isInteger(gradeId) || gradeId <= 0) {
    fieldErrors.gradeId = 'Choose the grade being promoted.'
  }

  const average = Number(text(form, 'minimumPassAverage'))
  if (!Number.isFinite(average) || average < 0 || average > 100) {
    fieldErrors.minimumPassAverage = 'The pass average is a percentage between 0 and 100.'
  }

  const maxFailed = Number(text(form, 'maxFailedSubjects'))
  if (!Number.isInteger(maxFailed) || maxFailed < 0) {
    fieldErrors.maxFailedSubjects = 'Allowed failed subjects must be zero or more.'
  }

  if (Object.keys(fieldErrors).length > 0) {
    return { fieldErrors, values: submitted(form) }
  }

  const { years, classes } = await promotionFormOptions()
  const year = years.find((option) => option.id === yearId)
  const target = years.find((option) => option.id === targetYearId)

  if (!year || !target) {
    return { error: 'One of those academic years no longer exists.', values: submitted(form) }
  }

  // Mirrors _check_academic_years; Odoo still enforces it on create.
  if (target.date_start < year.date_end) {
    return {
      fieldErrors: {
        targetAcademicYearId: `${target.name} starts before ${year.name} ends, so students cannot move into it.`,
      },
      values: submitted(form),
    }
  }

  /*
    Only classes that actually belong to the chosen year and grade are kept.
    A hand-posted id for someone else's class is dropped rather than sent —
    Odoo's own domain would refuse it, but there is no reason to ask.
  */
  const allowed = new Set(
    classes.filter((row) => row.yearId === yearId && row.gradeId === gradeId).map((row) => row.id),
  )
  const classIds = form
    .getAll('classIds')
    .map(Number)
    .filter((id) => allowed.has(id))

  const clashes = await unfinishedBatchesFor(yearId, gradeId)
  if (clashes.length > 0) {
    return {
      error:
        `A promotion batch for this grade and year already exists and has not been applied ` +
        `("${clashes[0].name}"). Finish or delete that one rather than starting a second, ` +
        `or the same students would be advanced twice.`,
      values: submitted(form),
    }
  }

  let id: number
  try {
    id = await createPromotionBatch({
      academicYearId: yearId,
      targetAcademicYearId: targetYearId,
      gradeId,
      classIds,
      minimumPassAverage: average,
      maxFailedSubjects: maxFailed,
    })
  } catch (cause) {
    return { error: toOdooError(cause).message, values: submitted(form) }
  }

  revalidatePath('/promotion')
  redirect(`/promotion/${id}`)
}
