import 'server-only'
import { callKw, searchCount, searchRead } from '@/lib/odoo/client'
import { orNullOnRefusal } from '@/lib/odoo/errors'
import { selectionOptions } from '@/lib/odoo/selections'
import { statusLabel } from '@/lib/status'
import { todayIso, todayWeekdayCode } from '@/lib/format'
import type { Many2one, Page, Selection } from '@/lib/odoo/types'
import type { ScheduleRow } from './operations'

/**
 * The reads behind the role dashboards.
 *
 * Two rules hold everywhere in this file.
 *
 * Every figure is Odoo's. Nothing is derived by fetching rows and counting
 * them in TypeScript — the counts are `search_count` and grouped aggregates,
 * which means they respect the record rules and stay correct for a school with
 * nine hundred students rather than nine.
 *
 * Every read degrades to null on refusal. A dashboard spans models a given
 * role may not hold, and one restricted panel must not take the page down. A
 * null panel renders as a stated boundary, never as a zero — a dashboard that
 * showed "0 students" to somebody who simply cannot read students would be
 * worse than one that said nothing.
 */

/* ------------------------------------------------------------- grouping --- */

export interface GroupCount {
  value: string
  label: string
  count: number
}

/**
 * How many records sit in each value of one field.
 *
 * `formatted_read_group` is Odoo 19's grouping API; `read_group` still answers
 * but is on its way out. Labels come from the field's own selection so a state
 * added to the module appears here without a change.
 */
export async function groupCount(
  model: string,
  field: string,
  domain: unknown[] = [],
): Promise<GroupCount[] | null> {
  const rows = await orNullOnRefusal(
    callKw<Array<Record<string, unknown>>>(model, 'formatted_read_group', [
      domain,
      [field],
      ['__count'],
    ]),
  )
  if (!rows) return null

  const options = await selectionOptions(model, field)
  const labels = new Map(options.map((option) => [option.value, option.label]))

  return rows
    .map((row) => {
      const raw = row[field]
      // A many2one group comes back as [id, name]; a selection as its code.
      const value = Array.isArray(raw) ? String(raw[0]) : String(raw ?? '')
      const label = Array.isArray(raw)
        ? String(raw[1])
        : (labels.get(value) ?? statusLabel(value))
      return { value, label, count: Number(row.__count ?? 0) }
    })
    .filter((group) => group.count > 0)
}

/** A count that answers null rather than throwing when the role cannot read. */
export function safeCount(model: string, domain: unknown[] = []): Promise<number | null> {
  return orNullOnRefusal(searchCount(model, domain))
}

/* ------------------------------------------------- academic context --- */

export interface AcademicContext {
  year: { id: number; name: string } | null
  term: { id: number; name: string; date_start: string; date_end: string } | null
}

/**
 * Which academic year and term the school is in right now.
 *
 * The year is Odoo's own `is_current` flag, which a constraint keeps unique.
 * Terms carry no equivalent flag, so the current one is the term whose date
 * range contains today — a query, not a rule invented here. Both may be null,
 * and the dashboard says so rather than guessing.
 */
export async function academicContext(): Promise<AcademicContext> {
  const today = todayIso()
  const [years, terms] = await Promise.all([
    orNullOnRefusal(
      searchRead<{ id: number; name: string }>('school.academic.year', ['name'], {
        domain: [['is_current', '=', true]],
        limit: 1,
      }),
    ),
    orNullOnRefusal(
      searchRead<{ id: number; name: string; date_start: string; date_end: string }>(
        'school.term',
        ['name', 'date_start', 'date_end'],
        {
          domain: [
            ['date_start', '<=', today],
            ['date_end', '>=', today],
            ['active', '=', true],
          ],
          limit: 1,
          order: 'sequence',
        },
      ),
    ),
  ])
  return { year: years?.rows[0] ?? null, term: terms?.rows[0] ?? null }
}

/* -------------------------------------------------------------- teacher --- */

/**
 * The signed-in teacher's lessons for today.
 *
 * `day_of_week` is Odoo's own weekday selection, '0' for Monday. Cancelled
 * slots are excluded because a cancelled lesson is not something to turn up to.
 */
export function todaysLessons(teacherId: number): Promise<Page<ScheduleRow> | null> {
  return orNullOnRefusal(
    searchRead<ScheduleRow>(
      'school.class.schedule',
      [
        'class_id',
        'subject_id',
        'teacher_id',
        'term_id',
        'room_id',
        'day_of_week',
        'start_time',
        'end_time',
        'schedule_type',
        'state',
      ],
      {
        domain: [
          ['teacher_id', '=', teacherId],
          ['day_of_week', '=', todayWeekdayCode()],
          ['state', 'not in', ['cancelled']],
        ],
        limit: 12,
        order: 'start_time',
      },
    ),
  )
}

export interface ClassSummary {
  id: number
  name: string
  student_ids: number[]
  capacity: number
  grade_id: Many2one
}

/** The classes a teacher is assigned to, from the scope Odoo already flattens. */
export function classesForTeacher(classIds: number[]): Promise<Page<ClassSummary> | null> {
  if (classIds.length === 0) return Promise.resolve(null)
  return orNullOnRefusal(
    searchRead<ClassSummary>('school.class', ['name', 'student_ids', 'capacity', 'grade_id'], {
      domain: [['id', 'in', classIds]],
      limit: 12,
      order: 'name',
    }),
  )
}

/** Today's register, grouped by status, within whatever the role may see. */
export function attendanceTodayByStatus(): Promise<GroupCount[] | null> {
  return groupCount('school.attendance', 'status', [['date', '=', todayIso()]])
}

/* ------------------------------------------------------------ registrar --- */

export interface RecentStudentRow {
  id: number
  name: string
  regno: string | false
  class_id: Many2one
  registration_status: Selection
  registration_date: string | false
}

export function recentRegistrations(limit = 6): Promise<Page<RecentStudentRow> | null> {
  return orNullOnRefusal(
    searchRead<RecentStudentRow>(
      'school.student',
      ['name', 'regno', 'class_id', 'registration_status', 'registration_date'],
      { limit, order: 'registration_date desc, id desc' },
    ),
  )
}

/**
 * Registrations that have stopped moving.
 *
 * Submitted and pending-verification are the two states where somebody else is
 * waiting on the registrar; approved and rejected are finished.
 */
export function registrationsAwaitingAction(): Promise<number | null> {
  return safeCount('school.student', [
    ['registration_status', 'in', ['pending_verification', 'submitted']],
  ])
}

export function documentsAwaitingVerification(): Promise<number | null> {
  return safeCount('school.document', [['state', 'in', ['pending', 'uploaded']]])
}

/* ------------------------------------------------------------- director --- */

/** Batches calculated and waiting on an approval that only a person can give. */
export function promotionsAwaitingApproval(): Promise<number | null> {
  return safeCount('school.promotion.batch', [['state', '=', 'calculated']])
}

/**
 * Report cards waiting on an Exam Officer.
 *
 * `draft`, not `generated`: the effective model has no `generated` state — see
 * the note on `reportCard` in lib/odoo/workflows.ts. This counted zero for
 * every school until that was traced.
 */
export function reportCardsAwaitingApproval(): Promise<number | null> {
  return safeCount('school.report.card', [['state', '=', 'draft']])
}

export function assessmentsAwaitingApproval(): Promise<number | null> {
  return safeCount('school.assessment', [['state', '=', 'submitted']])
}

/* --------------------------------------------------------- front office --- */

export interface ProgramSummary {
  id: number
  name: string
  program_type: Selection
  start_datetime: string
  end_datetime: string
  location: string | false
  state: Selection
  audience_type: Selection
  organizer_id: Many2one
}

/** Published programs that have not finished yet. */
export function upcomingPrograms(limit = 5): Promise<Page<ProgramSummary> | null> {
  return orNullOnRefusal(
    searchRead<ProgramSummary>(
      'school.program',
      [
        'name',
        'program_type',
        'start_datetime',
        'end_datetime',
        'location',
        'state',
        'audience_type',
        'organizer_id',
      ],
      {
        domain: [
          ['state', '=', 'published'],
          ['end_datetime', '>=', `${todayIso()} 00:00:00`],
        ],
        limit,
        order: 'start_datetime',
      },
    ),
  )
}
