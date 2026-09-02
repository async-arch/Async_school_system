'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { requireSession } from '@/lib/odoo/auth'
import { toOdooError } from '@/lib/odoo/errors'
import {
  createTeacher,
  createTeacherLogin,
  updateTeacher,
  TEACHER_EDITABLE,
} from '@/lib/odoo/models/teacher'

/**
 * Every mutation runs as the signed-in user's Odoo session. Nothing from the
 * browser is trusted for authorisation, and Odoo re-checks the ACL, the record
 * rule and every constraint — `_check_staff_active` in particular, which is
 * what decides whether a staff member may hold a teaching profile at all.
 */

export interface TeacherFormState {
  error?: string
  fieldErrors?: Record<string, string>
  ok?: string
  values?: Record<string, string>
}

const text = (form: FormData, key: string) => String(form.get(key) ?? '').trim()

const INTAKE_FIELDS = [
  'staff_id', 'teaching_status', 'qualification', 'specialization',
  'years_of_experience', 'max_weekly_workload', 'available_days',
] as const

const submitted = (form: FormData) =>
  Object.fromEntries(INTAKE_FIELDS.map((f) => [f, text(form, f)]))

/** A whole number or undefined; a blank input must not become 0. */
function optionalInt(form: FormData, key: string): number | undefined {
  const raw = text(form, key)
  if (!raw) return undefined
  const value = Number(raw)
  return Number.isInteger(value) && value >= 0 ? value : undefined
}

export async function createTeacherAction(
  _previous: TeacherFormState,
  form: FormData,
): Promise<TeacherFormState> {
  await requireSession()

  const staffId = Number(text(form, 'staff_id'))
  if (!Number.isInteger(staffId) || staffId <= 0) {
    return {
      fieldErrors: { staff_id: 'Choose the staff member this profile belongs to.' },
      values: submitted(form),
    }
  }

  let id: number
  try {
    id = await createTeacher({
      staff_id: staffId,
      teaching_status: text(form, 'teaching_status') || undefined,
      qualification: text(form, 'qualification') || undefined,
      specialization: text(form, 'specialization') || undefined,
      years_of_experience: optionalInt(form, 'years_of_experience'),
      max_weekly_workload: optionalInt(form, 'max_weekly_workload'),
      available_days: text(form, 'available_days') || undefined,
    })
  } catch (cause) {
    // "A teacher profile must be linked to an active staff record", "Selected
    // staff member must be a teacher or academic staff member", and the
    // missing-email message from _create_teacher_user. All written for the
    // person doing the work.
    return { error: toOdooError(cause).message, values: submitted(form) }
  }

  revalidatePath('/teachers')
  revalidatePath('/staff')
  redirect(`/teachers/${id}`)
}

export async function updateTeacherAction(
  _previous: TeacherFormState,
  form: FormData,
): Promise<TeacherFormState> {
  await requireSession()
  const id = Number(text(form, 'id'))
  if (!Number.isInteger(id) || id <= 0) return { error: 'That profile could not be identified.' }

  const values: Record<string, unknown> = {}
  for (const field of TEACHER_EDITABLE) {
    if (!form.has(field)) continue
    if (field === 'years_of_experience' || field === 'max_weekly_workload') {
      const value = optionalInt(form, field)
      values[field] = value ?? 0
    } else {
      values[field] = text(form, field) || false
    }
  }

  try {
    await updateTeacher(id, values)
  } catch (cause) {
    return { error: toOdooError(cause).message, values: submitted(form) }
  }

  revalidatePath(`/teachers/${id}`)
  revalidatePath('/teachers')
  redirect(`/teachers/${id}`)
}

/**
 * Provision the teaching login.
 *
 * Odoo owns the whole flow, including sending the password reset. This never
 * handles a password: `_create_teacher_user` with no password given calls
 * `action_reset_password`, so no credential passes through this application.
 */
export async function createTeacherLoginAction(
  _previous: TeacherFormState,
  form: FormData,
): Promise<TeacherFormState> {
  await requireSession()
  const id = Number(text(form, 'id'))
  if (!Number.isInteger(id) || id <= 0) return { error: 'That profile could not be identified.' }

  try {
    await createTeacherLogin(id)
  } catch (cause) {
    // The usual refusal is "The linked staff record needs an email address
    // before a login can be created for …", which tells the user exactly
    // which record to go and fix.
    return { error: toOdooError(cause).message }
  }

  revalidatePath(`/teachers/${id}`)
  return { ok: 'Login created. Odoo has emailed the teacher a password reset.' }
}
