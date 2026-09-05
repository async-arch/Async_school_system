import 'server-only'
import { callKw, create, hasAccess, readOne, searchRead, write } from '@/lib/odoo/client'
import { orNullOnRefusal } from '@/lib/odoo/errors'
import { listDomain, type ListOptions } from '@/lib/odoo/list'
import type { Many2one, Page, Selection } from '@/lib/odoo/types'

/**
 * Attendance, timetable, announcements, programs, documents and the academic
 * configuration vocabularies.
 *
 * Attendance rows are anchored to an enrolment and its effective placement —
 * Odoo fills both in `_complete_from_enrollment` on create and write, so this
 * layer never sets `class_id` or `placement_id` itself.
 */

/* ------------------------------------------------------------ attendance --- */

export interface AttendanceRow {
  id: number
  student_id: Many2one
  class_id: Many2one
  date: string
  status: Selection
  attendance_type: Selection
  period: string | false
  note: string | false
}

const ATTENDANCE_FIELDS = [
  'student_id',
  'class_id',
  'date',
  'status',
  'attendance_type',
  'period',
  'note',
] as const

export const ATTENDANCE_FILTERS = {
  date: { field: 'date', kind: 'date' },
  class: { field: 'class_id', kind: 'many2one' },
  status: { field: 'status' },
  type: { field: 'attendance_type' },
} as const

export function listAttendance(options: ListOptions = {}): Promise<Page<AttendanceRow>> {
  return searchRead<AttendanceRow>('school.attendance', ATTENDANCE_FIELDS, {
    domain: listDomain(options, {
      searchFields: ['student_id.name'],
      filters: ATTENDANCE_FILTERS,
    }),
    limit: options.limit ?? 50,
    offset: options.offset ?? 0,
    order: options.order ?? 'date desc, student_id',
  })
}

export async function attendanceStatusOptions(): Promise<Array<{ value: string; label: string }>> {
  const meta = await callKw<Record<string, { selection?: Array<[string, string]> }>>(
    'school.attendance',
    'fields_get',
    [['status']],
    { attributes: ['selection'] },
  )
  return (meta.status?.selection ?? []).map(([value, label]) => ({ value, label }))
}


/**
 * Build the roster for one class and date.
 *
 * `school.attendance.roster` is a transient wizard: create it, then call
 * `action_generate`, which derives the roster from the placements effective on
 * that date and skips students already recorded. Odoo owns all of that.
 */
export async function generateAttendanceRoster(classId: number, date: string): Promise<void> {
  const wizardId = await create('school.attendance.roster', { class_id: classId, date })
  await callKw('school.attendance.roster', 'action_generate', [[wizardId]])
}

/* -------------------------------------------------------------- schedule --- */

export interface ScheduleRow {
  id: number
  class_id: Many2one
  subject_id: Many2one
  teacher_id: Many2one
  term_id: Many2one
  room_id: Many2one
  day_of_week: Selection
  start_time: number
  end_time: number
  schedule_type: Selection
  state: Selection
}

const SCHEDULE_FIELDS = [
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
] as const

export const SCHEDULE_FILTERS = {
  status: { field: 'state' },
  day: { field: 'day_of_week' },
  type: { field: 'schedule_type' },
  class: { field: 'class_id', kind: 'many2one' },
  subject: { field: 'subject_id', kind: 'many2one' },
} as const

export function listSchedule(options: ListOptions = {}): Promise<Page<ScheduleRow>> {
  return searchRead<ScheduleRow>('school.class.schedule', SCHEDULE_FIELDS, {
    domain: listDomain(options, { filters: SCHEDULE_FILTERS }),
    limit: options.limit ?? 50,
    offset: options.offset ?? 0,
    order: options.order ?? 'day_of_week, start_time',
  })
}

/**
 * Every slot for one class and term, for the weekly grid.
 *
 * The grid needs the whole week at once rather than a page of it, so this is
 * the one schedule read that is deliberately unpaged — a week is bounded by
 * days times periods, not by how much data exists.
 */
export function listScheduleGrid(options: {
  classId?: number
  teacherId?: number
  termId?: number
}): Promise<Page<ScheduleRow>> {
  const domain: unknown[] = [['state', '!=', 'cancelled']]
  if (options.classId) domain.push(['class_id', '=', options.classId])
  if (options.teacherId) domain.push(['teacher_id', '=', options.teacherId])
  if (options.termId) domain.push(['term_id', '=', options.termId])
  return searchRead<ScheduleRow>('school.class.schedule', SCHEDULE_FIELDS, {
    domain,
    limit: 400,
    order: 'day_of_week, start_time',
  })
}

export function getSchedule(id: number): Promise<ScheduleRow | null> {
  return readOne<ScheduleRow>('school.class.schedule', id, SCHEDULE_FIELDS)
}

/* ------------------------------------------------------- slot authoring --- */

/**
 * Creating and editing one timetable slot.
 *
 * The day builder makes a whole day at once and is the normal way a timetable
 * gets built. This is the other half: the one-off — a makeup lesson, a room
 * that changed, a period that moves to Tuesday — which the builder cannot
 * express and which had no path at all.
 *
 * **Everything hangs off the teacher assignment.** `school.class.schedule`
 * refuses a create without one, and `_check_teacher_assignment` then requires
 * that the slot's class, subject, term, year and teacher all match that exact
 * assignment and that it is active. So the form asks for the assignment and
 * this derives the other five from it, rather than asking for six fields that
 * can disagree. That derivation is Odoo's own `_onchange_teacher_assignment_id`
 * — which never fires over JSON-RPC, so it has to happen here.
 *
 * Nothing else is re-implemented. The double-booking check, the "end after
 * start" constraint, the active-teacher rule on a published slot and the
 * reschedule-reason requirement all stay in Odoo and answer in its words.
 */

export interface ScheduleDetail extends ScheduleRow {
  teacher_assignment_id: Many2one
  academic_year_id: Many2one
  notes: string | false
  reschedule_reason: string | false
}

export const SCHEDULE_DETAIL_FIELDS = [
  ...SCHEDULE_FIELDS,
  'teacher_assignment_id',
  'academic_year_id',
  'notes',
  'reschedule_reason',
] as const

export function getScheduleDetail(id: number): Promise<ScheduleDetail | null> {
  return readOne<ScheduleDetail>('school.class.schedule', id, SCHEDULE_DETAIL_FIELDS)
}

export interface AssignmentOption {
  id: number
  label: string
  classId: number
  subjectId: number
  termId: number
  teacherId: number
}

/**
 * The active assignments a slot may be created against, already labelled.
 *
 * Mirrors the `teacher_assignment_id` domain on the model — class, subject,
 * term and `state = active` — so the picker cannot offer one Odoo would then
 * refuse.
 */
export async function listAssignmentOptions(): Promise<AssignmentOption[]> {
  const rows = await searchRead<{
    id: number
    class_id: Many2one
    subject_id: Many2one
    term_id: Many2one
    teacher_id: Many2one
  }>('school.teacher.assignment', ['class_id', 'subject_id', 'term_id', 'teacher_id'], {
    domain: [
      ['state', '=', 'active'],
      ['active', '=', true],
    ],
    limit: 500,
    order: 'class_id, subject_id',
    withTotal: false,
  })

  const id = (value: Many2one) => (Array.isArray(value) ? (value[0] as number) : 0)
  const label = (value: Many2one) => (Array.isArray(value) ? String(value[1]) : '')

  return rows.rows
    .filter((row) => id(row.class_id) && id(row.subject_id) && id(row.term_id))
    .map((row) => ({
      id: row.id,
      label: `${label(row.class_id)} · ${label(row.subject_id)} · ${label(row.term_id)} — ${label(row.teacher_id)}`,
      classId: id(row.class_id),
      subjectId: id(row.subject_id),
      termId: id(row.term_id),
      teacherId: id(row.teacher_id),
    }))
}

/** The scheduling facts of a slot — everything that is not the assignment. */
export interface SlotTiming {
  dayOfWeek: string
  startTime: number
  endTime: number
  roomId?: number
  scheduleType: string
  notes?: string
}

/**
 * The five fields Odoo derives from the assignment.
 *
 * Sent explicitly because `_check_teacher_assignment` compares them against
 * the assignment on every write, and because `create` needs class and term to
 * resolve `academic_year_id` through its related field.
 */
function fromAssignment(option: AssignmentOption) {
  return {
    teacher_assignment_id: option.id,
    class_id: option.classId,
    subject_id: option.subjectId,
    term_id: option.termId,
    teacher_id: option.teacherId,
  }
}

export function createSlot(
  intake: SlotTiming,
  assignment: AssignmentOption,
): Promise<number> {
  return create('school.class.schedule', {
    ...fromAssignment(assignment),
    day_of_week: intake.dayOfWeek,
    start_time: intake.startTime,
    end_time: intake.endTime,
    room_id: intake.roomId ?? false,
    schedule_type: intake.scheduleType,
    notes: intake.notes || false,
  })
}

/**
 * Edit the scheduling facts of an existing slot.
 *
 * Deliberately not the assignment: moving a slot to a different teacher,
 * subject or class is a different lesson, not an edit of this one, and Odoo
 * would have to re-check five interlocking fields to allow it. Cancel and
 * create instead — which is also what leaves an honest audit trail.
 *
 * `reschedule` writes the state and the reason alongside the change, in one
 * call, because `_check_reschedule_reason` refuses the state without the
 * reason. Odoo's field tracking keeps the previous day and times in the log.
 */
export function updateSlot(
  id: number,
  values: SlotTiming,
  reschedule?: { reason: string },
): Promise<boolean> {
  return write('school.class.schedule', [id], {
    day_of_week: values.dayOfWeek,
    start_time: values.startTime,
    end_time: values.endTime,
    room_id: values.roomId ?? false,
    schedule_type: values.scheduleType,
    notes: values.notes || false,
    ...(reschedule ? { state: 'rescheduled', reschedule_reason: reschedule.reason } : {}),
  })
}

export function canWriteSchedule(): Promise<boolean> {
  return hasAccess('school.class.schedule', 'write')
}

export function canCreateSchedule(): Promise<boolean> {
  return hasAccess('school.class.schedule', 'create')
}

/** Odoo stores times as a float; 8.5 is 08:30. */
export function formatSlotTime(value: number): string {
  const hours = Math.floor(value)
  const minutes = Math.round((value - hours) * 60)
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
}

export const WEEKDAYS = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
] as const

/* ---------------------------------------------------------- announcement --- */

export interface AnnouncementRow {
  id: number
  name: string
  category: Selection
  audience_type: Selection
  priority: Selection
  state: Selection
  publish_datetime: string | false
  expiry_datetime: string | false
  author_id: Many2one
  is_live: boolean
}

const ANNOUNCEMENT_FIELDS = [
  'name',
  'category',
  'audience_type',
  'priority',
  'state',
  'publish_datetime',
  'expiry_datetime',
  'author_id',
  'is_live',
] as const

export const ANNOUNCEMENT_FILTERS = {
  status: { field: 'state' },
  category: { field: 'category' },
  audience: { field: 'audience_type' },
  priority: { field: 'priority' },
} as const

export function listAnnouncements(options: ListOptions = {}): Promise<Page<AnnouncementRow>> {
  return searchRead<AnnouncementRow>('school.announcement', ANNOUNCEMENT_FIELDS, {
    domain: listDomain(options, {
      searchFields: ['name'],
      filters: ANNOUNCEMENT_FILTERS,
    }),
    limit: options.limit ?? 25,
    offset: options.offset ?? 0,
    order: options.order ?? 'publish_datetime desc',
  })
}

/** Live announcements for a dashboard panel. `is_live` has a search method. */
export function listLiveAnnouncements(limit = 4): Promise<Page<AnnouncementRow> | null> {
  return orNullOnRefusal(
    searchRead<AnnouncementRow>('school.announcement', ANNOUNCEMENT_FIELDS, {
      domain: [['is_live', '=', true]],
      limit,
      order: 'priority desc, publish_datetime desc',
    }),
  )
}

export function getAnnouncement(
  id: number,
): Promise<(AnnouncementRow & { message: string | false; link: string | false }) | null> {
  return readOne('school.announcement', id, [...ANNOUNCEMENT_FIELDS, 'message', 'link'])
}

/**
 * Which field carries the audience for each audience type.
 *
 * This mirrors `AUDIENCE_VALUE_FIELDS` in the addon, and Odoo's
 * `_check_audience_values` rejects a create where the matching field is empty —
 * so every type but `all_staff` needs a value chosen.
 */
const AUDIENCE_VALUE_FIELDS = {
  department: 'department',
  responsibility: 'responsibility',
  teacher_group: 'teacher_ids',
  subject_group: 'subject_ids',
  class_section: 'class_ids',
  branch_campus: 'campus_ids',
  selected_staff: 'staff_ids',
} as const

export type AudienceType = keyof typeof AUDIENCE_VALUE_FIELDS | 'all_staff'

/** The record-backed audience types, and the model each one picks from. */
const AUDIENCE_RECORD_MODELS = {
  teacher_group: 'school.teacher',
  subject_group: 'school.subject',
  class_section: 'school.class',
  branch_campus: 'school.campus',
  selected_staff: 'school.staff',
} as const

export type AudienceRecordType = keyof typeof AUDIENCE_RECORD_MODELS

export type AudienceChoices = Record<AudienceRecordType, SimpleRow[]>

/**
 * The pickable records behind every record-backed audience type.
 *
 * Each one degrades to an empty list rather than failing the page: a teacher
 * authoring an announcement cannot read `school.staff`, and that is correct —
 * they simply do not get the "selected staff" audience.
 */
export async function audienceChoices(): Promise<AudienceChoices> {
  const keys = Object.keys(AUDIENCE_RECORD_MODELS) as AudienceRecordType[]
  const pages = await Promise.all(
    keys.map((key) =>
      orNullOnRefusal(
        searchRead<SimpleRow>(AUDIENCE_RECORD_MODELS[key], ['name'], {
          limit: 200,
          order: 'name',
        }),
      ),
    ),
  )
  return Object.fromEntries(
    keys.map((key, index) => [key, pages[index]?.rows ?? []]),
  ) as AudienceChoices
}

export interface AnnouncementIntake {
  name: string
  message: string
  category: string
  priority: string
  audience_type: AudienceType
  /** A selection code for department/responsibility, record ids for the rest. */
  audience_value: string | number[]
  publish_datetime?: string
  expiry_datetime?: string
  link?: string
}

/**
 * Create an announcement in draft.
 *
 * Publishing is a separate, allowlisted transition — `action_publish` resolves
 * the recipients and stamps the visibility window, and writing `state` here
 * would skip all of it.
 */
export function createAnnouncement(intake: AnnouncementIntake): Promise<number> {
  const values: Record<string, unknown> = {
    name: intake.name,
    message: intake.message,
    category: intake.category,
    priority: intake.priority,
    audience_type: intake.audience_type,
    publish_datetime: intake.publish_datetime || false,
    expiry_datetime: intake.expiry_datetime || false,
    link: intake.link || false,
  }

  const field =
    intake.audience_type === 'all_staff' ? null : AUDIENCE_VALUE_FIELDS[intake.audience_type]
  if (field) {
    // Odoo's many2many write command: 6 replaces the whole set.
    values[field] = Array.isArray(intake.audience_value)
      ? [[6, 0, intake.audience_value]]
      : intake.audience_value
  }

  return create('school.announcement', values)
}

/** The audience fields, read back so an edit form can open on what is set. */
export interface AnnouncementAudience {
  department: Selection
  responsibility: Selection
  teacher_ids: number[]
  subject_ids: number[]
  class_ids: number[]
  campus_ids: number[]
  staff_ids: number[]
}

export function getAnnouncementAudience(id: number): Promise<AnnouncementAudience | null> {
  return orNullOnRefusal(
    readOne<AnnouncementAudience>('school.announcement', id, [
      'department', 'responsibility', 'teacher_ids', 'subject_ids',
      'class_ids', 'campus_ids', 'staff_ids',
    ]),
  )
}

/**
 * Correct an announcement.
 *
 * The audience is only written while the announcement is still draft.
 * `action_publish` resolves the audience into `recipient_user_ids` once and
 * record rules read that stored set, so changing the audience afterwards would
 * look like it worked and reach nobody new. Refusing to send it is honest;
 * silently writing a field with no effect is not.
 */
export function updateAnnouncement(
  id: number,
  intake: Omit<AnnouncementIntake, 'audience_type' | 'audience_value'> &
    Partial<Pick<AnnouncementIntake, 'audience_type' | 'audience_value'>>,
): Promise<boolean> {
  const values: Record<string, unknown> = {
    name: intake.name,
    message: intake.message,
    category: intake.category,
    priority: intake.priority,
    publish_datetime: intake.publish_datetime || false,
    expiry_datetime: intake.expiry_datetime || false,
    link: intake.link || false,
  }

  if (intake.audience_type) {
    values.audience_type = intake.audience_type
    const field =
      intake.audience_type === 'all_staff' ? null : AUDIENCE_VALUE_FIELDS[intake.audience_type]
    if (field) {
      values[field] = Array.isArray(intake.audience_value)
        ? [[6, 0, intake.audience_value]]
        : intake.audience_value
    }
  }

  return write('school.announcement', [id], values)
}

/* --------------------------------------------------------------- program --- */

export interface ProgramRow {
  id: number
  name: string
  program_type: Selection
  audience_type: Selection
  start_datetime: string
  end_datetime: string
  location: string | false
  organizer_id: Many2one
  state: Selection
}

const PROGRAM_FIELDS = [
  'name',
  'program_type',
  'audience_type',
  'start_datetime',
  'end_datetime',
  'location',
  'organizer_id',
  'state',
] as const

export const PROGRAM_FILTERS = {
  status: { field: 'state' },
  type: { field: 'program_type' },
  audience: { field: 'audience_type' },
} as const

export function listPrograms(options: ListOptions = {}): Promise<Page<ProgramRow>> {
  return searchRead<ProgramRow>('school.program', PROGRAM_FIELDS, {
    domain: listDomain(options, { searchFields: ['name', 'location'], filters: PROGRAM_FILTERS }),
    limit: options.limit ?? 25,
    offset: options.offset ?? 0,
    order: options.order ?? 'start_datetime desc',
  })
}

export function getProgram(id: number): Promise<ProgramRow | null> {
  return readOne<ProgramRow>('school.program', id, PROGRAM_FIELDS)
}

/* -------------------------------------------------------------- document --- */

export interface DocumentRow {
  id: number
  name: string
  document_type_id: Many2one
  student_id: Many2one
  staff_id: Many2one
  state: Selection
  expiry_date: string | false
  verified_by_id: Many2one
  verified_at: string | false
  rejection_reason: string | false
}

const DOCUMENT_FIELDS = [
  'name',
  'document_type_id',
  'student_id',
  'staff_id',
  'state',
  'expiry_date',
  'verified_by_id',
  'verified_at',
  'rejection_reason',
] as const

export const DOCUMENT_FILTERS = {
  status: { field: 'state' },
  type: { field: 'document_type_id', kind: 'many2one' },
} as const

export function listDocuments(options: ListOptions = {}): Promise<Page<DocumentRow>> {
  return searchRead<DocumentRow>('school.document', DOCUMENT_FIELDS, {
    domain: listDomain(options, {
      searchFields: ['name', 'student_id.name', 'staff_id.name'],
      filters: DOCUMENT_FILTERS,
    }),
    limit: options.limit ?? 25,
    offset: options.offset ?? 0,
    order: options.order ?? 'id desc',
  })
}

export function getDocument(id: number): Promise<DocumentRow | null> {
  return readOne<DocumentRow>('school.document', id, DOCUMENT_FIELDS)
}



/* --------------------------------------------------------- configuration --- */

export interface SimpleRow {
  id: number
  name: string
  [key: string]: unknown
}

/**
 * The academic vocabularies behind every picker: grades, sections, streams,
 * shifts, campuses and rooms. Each degrades to null on refusal so one
 * restricted vocabulary does not fail the configuration page.
 */
export const CONFIG_MODELS = {
  grades: { model: 'school.grade', fields: ['name', 'code', 'level', 'sequence', 'active'] },
  sections: { model: 'school.section', fields: ['name', 'sequence', 'class_count', 'active'] },
  streams: { model: 'school.stream', fields: ['name', 'code', 'sequence', 'active'] },
  shifts: { model: 'school.shift', fields: ['name', 'code', 'time_start', 'time_end', 'active'] },
  campuses: { model: 'school.campus', fields: ['name', 'code', 'address', 'active'] },
  rooms: { model: 'school.room', fields: ['name', 'code', 'room_type', 'capacity', 'active'] },
} as const

export type ConfigKey = keyof typeof CONFIG_MODELS

export function listConfig(key: ConfigKey): Promise<Page<SimpleRow> | null> {
  const spec = CONFIG_MODELS[key]
  return orNullOnRefusal(
    searchRead<SimpleRow>(spec.model, spec.fields, { limit: 200, order: 'name' }),
  )
}

/* --------------------------------------------------------------- terms --- */

export interface TermRow {
  id: number
  name: string
  academic_year_id: Many2one
  date_start: string
  date_end: string
  sequence: number
  active: boolean
}

export const TERM_FIELDS = [
  'name',
  'academic_year_id',
  'date_start',
  'date_end',
  'sequence',
  'active',
] as const

export function listTerms(): Promise<Page<TermRow>> {
  return searchRead<TermRow>('school.term', TERM_FIELDS, {
    limit: 100,
    order: 'academic_year_id desc, sequence',
    // Archived terms still have to be visible: reopening one is why somebody
    // opens this screen. A domain on `active` is silently ignored; this is
    // Odoo's own switch.
    context: { active_test: false },
    withTotal: false,
  })
}

/**
 * Terms are created and edited here rather than through the generic
 * vocabulary screen, because a term is not a vocabulary: it belongs to an
 * academic year and Odoo refuses one whose dates fall outside that year, or
 * whose name repeats within it. The form therefore has to ask for a year and
 * two dates, and let Odoo answer on the rest.
 *
 * `school.term` also carries a second, unused pair of date fields —
 * `start_date`/`end_date` alongside the required `date_start`/`date_end`.
 * Only the latter pair is constrained against the academic year and read by
 * assessments, marks, report cards and assignments, so only that pair is
 * written here. The vestigial pair is left alone; removing it is a model
 * change, not a frontend one.
 */
export function getTerm(id: number): Promise<TermRow | null> {
  return readOne<TermRow>('school.term', id, TERM_FIELDS)
}

export function createTerm(values: Record<string, unknown>): Promise<number> {
  return create('school.term', values)
}

export function updateTerm(id: number, values: Record<string, unknown>): Promise<boolean> {
  return write('school.term', [id], values)
}

/* ---------------------------------------------------------- curriculum --- */

export interface GradeSubjectRow {
  id: number
  class_id: Many2one
  subject_id: Many2one
  subject_type: Selection
  maximum_mark: number
  pass_mark: number
  active: boolean
}

/**
 * One curriculum line, with the fields the list does not carry.
 *
 * `optional_selection_limit` only means anything on an optional or elective
 * subject — it is how many of them a student must choose — so the form asks
 * for it conditionally rather than always.
 */
export interface CurriculumLine extends GradeSubjectRow {
  optional_selection_limit: number
}

export function getCurriculumLine(id: number): Promise<CurriculumLine | null> {
  return readOne<CurriculumLine>('school.grade.subject', id, [
    'class_id',
    'subject_id',
    'subject_type',
    'maximum_mark',
    'pass_mark',
    'optional_selection_limit',
    'active',
  ])
}

/**
 * Change how a subject is graded for one class.
 *
 * `class_id` and `subject_id` are deliberately not writable here. The pair is
 * unique and everything already recorded — marks, report-card snapshots —
 * hangs off it, so re-pointing a line would rewrite history rather than
 * correct it. Removing the subject and adding the right one is the honest
 * operation, and the class-subjects wizard already does that.
 *
 * Odoo owns the arithmetic: a CHECK constraint keeps the pass mark between
 * zero and the maximum, and answers in its own words when it does not.
 */
export function updateCurriculumLine(
  id: number,
  values: Record<string, unknown>,
): Promise<boolean> {
  return write('school.grade.subject', [id], values)
}

export function listCurriculum(options: { classId?: number } = {}): Promise<
  Page<GradeSubjectRow>
> {
  return searchRead<GradeSubjectRow>(
    'school.grade.subject',
    ['class_id', 'subject_id', 'subject_type', 'maximum_mark', 'pass_mark', 'active'],
    {
      domain: options.classId ? [['class_id', '=', options.classId]] : [],
      limit: 200,
      order: 'class_id, subject_id',
    },
  )
}

/**
 * Save every changed row in one round trip.
 *
 * Odoo's write() takes many ids but only one values dict, so this groups
 * changes by target status first — a class of 30 that settles on "present"
 * costs one write call, not thirty.
 */
export async function setAttendanceStatusBatch(
  changes: Array<{ id: number; status: string }>,
): Promise<void> {
  const byStatus = new Map<string, number[]>()
  for (const { id, status } of changes) {
    const ids = byStatus.get(status) ?? []
    ids.push(id)
    byStatus.set(status, ids)
  }
  await Promise.all(
    Array.from(byStatus.entries()).map(([status, ids]) => write('school.attendance', ids, { status })),
  )
}