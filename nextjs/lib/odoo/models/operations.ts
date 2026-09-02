import 'server-only'
import { callKw, create, readOne, searchRead, write } from '@/lib/odoo/client'
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

export function setAttendanceStatus(id: number, status: string): Promise<boolean> {
  return write('school.attendance', [id], { status })
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

export interface DocumentTypeRow {
  id: number
  name: string
  code: string | false
  owner_type: Selection
  expires: boolean
  sensitive: boolean
  active: boolean
}

export function listDocumentTypes(): Promise<Page<DocumentTypeRow> | null> {
  return orNullOnRefusal(
    searchRead<DocumentTypeRow>(
      'school.document.type',
      ['name', 'code', 'owner_type', 'expires', 'sensitive', 'active'],
      { limit: 100, order: 'name' },
    ),
  )
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

export function listTerms(): Promise<Page<TermRow>> {
  return searchRead<TermRow>(
    'school.term',
    ['name', 'academic_year_id', 'date_start', 'date_end', 'sequence', 'active'],
    { limit: 100, order: 'academic_year_id desc, sequence' },
  )
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
