import 'server-only'
import { callKw, create, hasAccess, readOne, searchRead, write } from '@/lib/odoo/client'
import { orNullOnRefusal } from '@/lib/odoo/errors'
import type { Many2one, Page, Selection } from '@/lib/odoo/types'

/**
 * Teacher profiles.
 *
 * The relationship, read out of the model rather than assumed: a teacher is a
 * *profile on a staff record*. `school.teacher.staff_id` is required with
 * `ondelete='cascade'`, and `_check_staff_active` refuses the link unless the
 * staff member is active, employed, and either in the academic department or
 * holding a teaching responsibility. Teacher is not the same thing as a user
 * either — `user_id` is readonly and provisioned by `_create_teacher_user`.
 *
 * That ordering is why the frontend cannot offer a standalone "add teacher"
 * form: there has to be an eligible staff record first.
 *
 * The list query lives in models/school.ts with the other list services; what
 * is here is everything the list cannot do.
 */

/* ----------------------------------------------------------------- read --- */

export interface TeacherDetail {
  id: number
  name: string
  teacher_id: string | false
  staff_id: Many2one
  user_id: Many2one
  department: Selection
  primary_responsibility: Selection
  teaching_status: Selection
  qualification: string | false
  specialization: string | false
  years_of_experience: number
  max_weekly_workload: number
  available_days: string | false
  hire_date: string | false
  assigned_class_count: number
  assigned_subject_count: number
  total_student_count: number
  current_weekly_periods: number
  active: boolean
}

const TEACHER_DETAIL_FIELDS = [
  'name',
  'teacher_id',
  'staff_id',
  'user_id',
  'department',
  'primary_responsibility',
  'teaching_status',
  'qualification',
  'specialization',
  'years_of_experience',
  'max_weekly_workload',
  'available_days',
  'hire_date',
  'assigned_class_count',
  'assigned_subject_count',
  'total_student_count',
  'current_weekly_periods',
  'active',
] as const

export function getTeacher(id: number): Promise<TeacherDetail | null> {
  return readOne<TeacherDetail>('school.teacher', id, TEACHER_DETAIL_FIELDS)
}

/**
 * The staff records a teacher profile may be created on, and the ones that
 * fall short.
 *
 * `_check_staff_active` refuses a link unless the staff member is active,
 * employed, and either in the academic department or holding a teaching
 * responsibility. Returning only the passes was not enough: a registrar who
 * had just created somebody went looking for them, found a populated list with
 * their person quietly missing, and had no way to tell whether the record had
 * saved. The near misses come back too, each with the reason Odoo would give,
 * so the form can say what to do about it.
 *
 * The rule itself is unchanged — nothing here widens what Odoo accepts.
 */
export interface StaffCandidate {
  id: number
  name: string
  staff_id: string | false
  department: Selection
  email: string | false
  state: Selection
  employment_status: Selection
  primary_responsibility: Selection
  active: boolean
}

export interface EligibilityResult {
  eligible: StaffCandidate[]
  /** Staff who would be teachers but for one thing, with that thing named. */
  blocked: Array<{ staff: StaffCandidate; reason: string; fixable: boolean }>
}

const TEACHING_RESPONSIBILITIES = ['teacher', 'homeroom', 'department_head', 'coordinator']

const CANDIDATE_FIELDS = [
  'name',
  'staff_id',
  'department',
  'email',
  'state',
  'employment_status',
  'primary_responsibility',
  'active',
] as const

/** Why Odoo would refuse this staff member, in the order it would refuse them. */
function refusalReason(staff: StaffCandidate): { reason: string; fixable: boolean } | null {
  if (!staff.active) return { reason: 'the staff record is archived', fixable: false }
  if (staff.state !== 'active') {
    return {
      reason:
        staff.state === 'draft'
          ? 'the staff record is still in draft — activate it first'
          : `the staff record is ${String(staff.state)}`,
      fixable: staff.state === 'draft' || staff.state === 'suspended',
    }
  }
  if (staff.employment_status !== 'active') {
    return { reason: `employment status is ${String(staff.employment_status)}`, fixable: false }
  }
  if (
    staff.department !== 'academic' &&
    !TEACHING_RESPONSIBILITIES.includes(String(staff.primary_responsibility))
  ) {
    return {
      reason: 'not in the academic department and holds no teaching responsibility',
      fixable: true,
    }
  }
  return null
}

export async function listEligibleStaff(): Promise<EligibilityResult> {
  const existing = await orNullOnRefusal(
    searchRead<{ staff_id: Many2one }>('school.teacher', ['staff_id'], { limit: 500 }),
  )
  const taken = new Set(
    (existing?.rows ?? []).map((row) => (row.staff_id ? row.staff_id[0] : 0)).filter(Boolean),
  )

  /*
    One read of everyone who does not already hold a profile, then the rule is
    applied here so the same pass yields both lists. Two queries — one for
    passes and one for near misses — would need the refusal logic expressed
    twice, in two domains, and they would drift.
  */
  const page = await orNullOnRefusal(
    searchRead<StaffCandidate>('school.staff', CANDIDATE_FIELDS, {
      domain: taken.size ? [['id', 'not in', [...taken]]] : [],
      limit: 400,
      order: 'name',
    }),
  )

  const eligible: StaffCandidate[] = []
  const blocked: EligibilityResult['blocked'] = []
  for (const staff of page?.rows ?? []) {
    const refusal = refusalReason(staff)
    if (!refusal) {
      eligible.push(staff)
    } else if (refusal.fixable) {
      // Only the near misses are worth showing; a resigned caretaker is noise.
      blocked.push({ staff, reason: refusal.reason, fixable: refusal.fixable })
    }
  }
  return { eligible, blocked }
}

/**
 * Assignments held by one teacher.
 *
 * Record rules already narrow `school.teacher.assignment` to the signed-in
 * teacher's own rows, so this adds no user filter of its own — passing the id
 * is about *which* teacher's page is open, not about authorisation.
 */
export interface TeacherAssignmentRow {
  id: number
  name: string
  subject_id: Many2one
  class_id: Many2one
  term_id: Many2one
  academic_year_id: Many2one
  responsibility: Selection
  teaching_role: Selection
  weekly_periods: number
  start_date: string
  end_date: string | false
  state: Selection
}

export const TEACHER_ASSIGNMENT_FIELDS = [
  'name',
  'subject_id',
  'class_id',
  'term_id',
  'academic_year_id',
  'responsibility',
  'teaching_role',
  'weekly_periods',
  'start_date',
  'end_date',
  'state',
] as const

export function listAssignmentsForTeacher(
  teacherId: number,
  limit = 100,
): Promise<Page<TeacherAssignmentRow> | null> {
  return orNullOnRefusal(
    searchRead<TeacherAssignmentRow>('school.teacher.assignment', TEACHER_ASSIGNMENT_FIELDS, {
      domain: [['teacher_id', '=', teacherId]],
      limit,
      order: 'academic_year_id desc, term_id, class_id',
    }),
  )
}

/** Timetable slots for one teacher, for the profile's schedule panel. */
export interface TeacherSlotRow {
  id: number
  class_id: Many2one
  subject_id: Many2one
  room_id: Many2one
  term_id: Many2one
  day_of_week: Selection
  start_time: number
  end_time: number
  state: Selection
}

export function listSlotsForTeacher(teacherId: number): Promise<Page<TeacherSlotRow> | null> {
  return orNullOnRefusal(
    searchRead<TeacherSlotRow>(
      'school.class.schedule',
      ['class_id', 'subject_id', 'room_id', 'term_id', 'day_of_week', 'start_time', 'end_time', 'state'],
      {
        domain: [
          ['teacher_id', '=', teacherId],
          ['state', '!=', 'cancelled'],
        ],
        limit: 200,
        order: 'day_of_week, start_time',
      },
    ),
  )
}

/* ---------------------------------------------------------------- write --- */

export interface TeacherIntake {
  staff_id: number
  teaching_status?: string
  qualification?: string
  specialization?: string
  years_of_experience?: number
  max_weekly_workload?: number
  available_days?: string
  /** Optional initial password. See the note on createTeacher. */
  login_password?: string
}

/**
 * Create a teacher profile.
 *
 * Odoo's `create` mints the TCH- sequence and then calls
 * `_create_teacher_user`, which needs `staff_id.email` and raises a
 * ValidationError naming the teacher when it is missing. Nothing is
 * pre-empted here — the caller surfaces that message.
 *
 * `login_password` is Odoo's own field for this: `store=False`, handed
 * straight to `res.users.password` by `_inverse_login_password`, and never
 * written to the teacher record. Leaving it empty makes Odoo email a
 * set-password link instead, which is the better path — but only where an
 * outgoing mail server exists. Without one the account is created with no
 * password and the teacher cannot sign in at all, so the field is offered.
 */
export function createTeacher(intake: TeacherIntake): Promise<number> {
  return create(
    'school.teacher',
    Object.fromEntries(
      Object.entries(intake).filter(([, value]) => value !== undefined && value !== ''),
    ),
  )
}

/**
 * Fields a teacher profile may be edited through.
 *
 * `teacher_id` and `user_id` are readonly on the model, `name`, `department`
 * and `primary_responsibility` are computed or related from the staff record,
 * and `staff_id` is not re-pointed after creation — moving a profile between
 * staff members would rewrite history that assignments and marks hang off.
 */
export const TEACHER_EDITABLE = [
  'teaching_status',
  'qualification',
  'specialization',
  'years_of_experience',
  'max_weekly_workload',
  'available_days',
] as const

export function updateTeacher(id: number, values: Record<string, unknown>): Promise<boolean> {
  return write('school.teacher', [id], values)
}

/**
 * Provision the Odoo login for a teacher.
 *
 * `action_create_login_user` is Odoo's own method: it creates the user against
 * the staff email, puts them in the teacher group, links both records and
 * triggers a password reset. Doing any of that here would be a second
 * implementation of account provisioning.
 */
export function createTeacherLogin(id: number): Promise<unknown> {
  return callKw('school.teacher', 'action_create_login_user', [[id]])
}

/**
 * Set or reset the password on a teacher's login.
 *
 * Writing `login_password` runs Odoo's `_inverse_login_password`, which sets
 * `res.users.password` when a login exists and creates the user when it does
 * not. The field is not stored, so the value lives only for the duration of
 * the write — the same guarantee the Odoo client gives.
 *
 * Odoo's own `_check_strong_password` is the authority on what is acceptable.
 */
export function setTeacherPassword(id: number, password: string): Promise<boolean> {
  return write('school.teacher', [id], { login_password: password })
}

export function canCreateTeacher(): Promise<boolean> {
  return hasAccess('school.teacher', 'create')
}

export function canWriteTeacher(): Promise<boolean> {
  return hasAccess('school.teacher', 'write')
}

/** Selection choices for the teacher form, read from Odoo. */
export async function teacherFieldMeta(): Promise<Record<string, { selection?: Array<{ value: string; label: string }> }>> {
  const raw = await callKw<Record<string, { selection?: Array<[string, string]> }>>(
    'school.teacher',
    'fields_get',
    [['teaching_status']],
    { attributes: ['selection'] },
  )
  return Object.fromEntries(
    Object.entries(raw).map(([name, meta]) => [
      name,
      {
        selection: (meta.selection ?? []).map(([value, label]) => ({ value, label })),
      },
    ]),
  )
}
