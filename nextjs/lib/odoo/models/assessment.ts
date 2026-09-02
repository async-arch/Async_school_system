import 'server-only'
import { callKw, readOne, searchRead, write } from '@/lib/odoo/client'
import { orNullOnRefusal } from '@/lib/odoo/errors'
import { listDomain, type ListOptions } from '@/lib/odoo/list'
import type { Many2one, Page, Selection } from '@/lib/odoo/types'

/**
 * Assessments, mark entry and report cards.
 *
 * Two rules from the module shape everything here. Mark rows are *generated*
 * from subject enrolments by `action_open` — never hand-built — so this layer
 * exposes no way to create one. And a mark's scope (class, subject, term,
 * type, maximum) is frozen: `school.mark.write` rejects any change to it, so
 * only score, status and note are ever sent.
 */

/* ---------------------------------------------------------- assessment --- */

export interface AssessmentRow {
  id: number
  name: string
  assessment_type: Selection
  class_id: Many2one
  subject_id: Many2one
  term_id: Many2one
  academic_year_id: Many2one
  teacher_assignment_id: Many2one
  date: string
  max_mark: number
  weight: number
  state: Selection
  mark_count: number
}

const ASSESSMENT_FIELDS = [
  'name',
  'assessment_type',
  'class_id',
  'subject_id',
  'term_id',
  'academic_year_id',
  'teacher_assignment_id',
  'date',
  'max_mark',
  'weight',
  'state',
  'mark_count',
] as const

export const ASSESSMENT_FILTERS = {
  status: { field: 'state' },
  type: { field: 'assessment_type' },
  class: { field: 'class_id', kind: 'many2one' },
  subject: { field: 'subject_id', kind: 'many2one' },
  term: { field: 'term_id', kind: 'many2one' },
} as const

export function listAssessments(options: ListOptions = {}): Promise<Page<AssessmentRow>> {
  return searchRead<AssessmentRow>('school.assessment', ASSESSMENT_FIELDS, {
    domain: listDomain(options, { searchFields: ['name'], filters: ASSESSMENT_FILTERS }),
    limit: options.limit ?? 25,
    offset: options.offset ?? 0,
    order: options.order ?? 'date desc',
  })
}

/**
 * Assessments still needing something from the signed-in teacher.
 *
 * `open` means the mark list is generated and waiting for entry; `returned`
 * means an exam officer sent it back. Record rules already narrow this to the
 * teacher's own assignments, so no user filter is added here.
 */
export function listAssessmentsAwaitingEntry(limit = 6): Promise<Page<AssessmentRow> | null> {
  return orNullOnRefusal(
    searchRead<AssessmentRow>('school.assessment', ASSESSMENT_FIELDS, {
      domain: [['state', 'in', ['open', 'returned']]],
      limit,
      order: 'date desc',
    }),
  )
}

/** Mark lists submitted and waiting on an exam officer. */
export function listAssessmentsAwaitingApproval(limit = 6): Promise<Page<AssessmentRow> | null> {
  return orNullOnRefusal(
    searchRead<AssessmentRow>('school.assessment', ASSESSMENT_FIELDS, {
      domain: [['state', '=', 'submitted']],
      limit,
      order: 'date desc',
    }),
  )
}

export function getAssessment(id: number): Promise<AssessmentRow | null> {
  return readOne<AssessmentRow>('school.assessment', id, ASSESSMENT_FIELDS)
}

/** The immutable audit trail Odoo writes for every transition and correction. */
export interface AssessmentEventRow {
  id: number
  event_type: Selection
  actor_id: Many2one
  occurred_at: string
  reason: string | false
}

export function listAssessmentEvents(
  assessmentId: number,
): Promise<Page<AssessmentEventRow> | null> {
  return orNullOnRefusal(
    searchRead<AssessmentEventRow>(
      'school.assessment.event',
      ['event_type', 'actor_id', 'occurred_at', 'reason'],
      { domain: [['assessment_id', '=', assessmentId]], limit: 50, order: 'occurred_at desc' },
    ),
  )
}

/* --------------------------------------------------------------- marks --- */

export interface MarkEntryRow {
  id: number
  student_id: Many2one
  score: number
  max_score: number
  percentage: number
  grade: string | false
  mark_status: Selection
  note: string | false
}

const MARK_ENTRY_FIELDS = [
  'student_id',
  'score',
  'max_score',
  'percentage',
  'grade',
  'mark_status',
  'note',
] as const

export function listAssessmentMarks(assessmentId: number): Promise<Page<MarkEntryRow>> {
  return searchRead<MarkEntryRow>('school.mark', MARK_ENTRY_FIELDS, {
    domain: [['assessment_id', '=', assessmentId]],
    limit: 200,
    order: 'student_id asc',
  })
}

/** Selection labels come from Odoo rather than being hardcoded here. */
export async function markStatusOptions(): Promise<Array<{ value: string; label: string }>> {
  const meta = await callKw<Record<string, { selection?: Array<[string, string]> }>>(
    'school.mark',
    'fields_get',
    [['mark_status']],
    { attributes: ['selection'] },
  )
  return (meta.mark_status?.selection ?? []).map(([value, label]) => ({ value, label }))
}

/**
 * Record a score.
 *
 * Only the entry fields are writable — `school.mark.write` raises on any
 * scope change, and refuses the write entirely once the assessment leaves
 * `open`. A correction reason rides in the context so Odoo can attach it to
 * the `mark_correction` audit event.
 */
export function saveMark(
  markId: number,
  values: { score?: number; mark_status?: string; note?: string },
  reason?: string,
): Promise<boolean> {
  return callKw<boolean>('school.mark', 'write', [[markId], values], {
    context: reason ? { correction_reason: reason } : {},
  })
}

/* --------------------------------------------------------- report card --- */

export interface ReportCardRow {
  id: number
  name: string
  student_id: Many2one
  class_id: Many2one
  term_id: Many2one
  academic_year_id: Many2one
  state: Selection
}

export const REPORT_CARD_FILTERS = {
  status: { field: 'state' },
  result: { field: 'result_status' },
  class: { field: 'class_id', kind: 'many2one' },
  term: { field: 'term_id', kind: 'many2one' },
} as const

export function listReportCards(options: ListOptions = {}): Promise<Page<ReportCardRow>> {
  return searchRead<ReportCardRow>(
    'school.report.card',
    ['name', 'student_id', 'class_id', 'term_id', 'academic_year_id', 'state'],
    {
      domain: listDomain(options, {
        searchFields: ['name', 'student_id.name'],
        filters: REPORT_CARD_FILTERS,
      }),
      limit: options.limit ?? 25,
      offset: options.offset ?? 0,
      order: options.order ?? 'id desc',
    },
  )
}

/**
 * Report-card detail.
 *
 * `school.report.card` is defined in two module files, so the merged model
 * carries both generations of fields. Anything not present simply comes back
 * absent, and the whole read degrades to null rather than failing the page.
 */
export interface ReportCardDetail extends ReportCardRow {
  overall_percentage: number
  overall_grade: string | false
  result_status: Selection
  class_rank: number
  attendance_present: number
  attendance_absent: number
  attendance_late: number
  attendance_total: number
  attendance_percentage: number
  promotion_decision: Selection
  generated_at: string | false
  approved_at: string | false
  published_at: string | false
}

export function getReportCard(id: number): Promise<ReportCardDetail | null> {
  return orNullOnRefusal(
    readOne<ReportCardDetail>('school.report.card', id, [
      'name',
      'student_id',
      'class_id',
      'term_id',
      'academic_year_id',
      'state',
      'overall_percentage',
      'overall_grade',
      'result_status',
      'class_rank',
      'attendance_present',
      'attendance_absent',
      'attendance_late',
      'attendance_total',
      'attendance_percentage',
      'promotion_decision',
      'generated_at',
      'approved_at',
      'published_at',
    ]),
  )
}

export interface ReportCardLineRow {
  id: number
  subject_id: Many2one
  score: number
  maximum: number
  percentage: number
  grade: string | false
}

export function listReportCardLines(cardId: number): Promise<Page<ReportCardLineRow> | null> {
  return orNullOnRefusal(
    searchRead<ReportCardLineRow>(
      'school.report.card.line',
      ['subject_id', 'score', 'maximum', 'percentage', 'grade'],
      { domain: [['report_card_id', '=', cardId]], limit: 50 },
    ),
  )
}

/* ----------------------------------------------------------- promotion --- */

export interface PromotionBatchRow {
  id: number
  name: string
  academic_year_id: Many2one
  target_academic_year_id: Many2one
  grade_id: Many2one
  minimum_pass_average: number
  max_failed_subjects: number
  state: Selection
  line_count: number
  promoted_count: number
  retained_count: number
  graduated_count: number
  conditional_count: number
}

const PROMOTION_FIELDS = [
  'name',
  'academic_year_id',
  'target_academic_year_id',
  'grade_id',
  'minimum_pass_average',
  'max_failed_subjects',
  'state',
  'line_count',
  'promoted_count',
  'retained_count',
  'graduated_count',
  'conditional_count',
] as const

export const PROMOTION_FILTERS = {
  status: { field: 'state' },
  grade: { field: 'grade_id', kind: 'many2one' },
} as const

export function listPromotionBatches(options: ListOptions = {}): Promise<Page<PromotionBatchRow>> {
  return searchRead<PromotionBatchRow>('school.promotion.batch', PROMOTION_FIELDS, {
    domain: listDomain(options, { searchFields: ['name'], filters: PROMOTION_FILTERS }),
    limit: options.limit ?? 25,
    offset: options.offset ?? 0,
    order: options.order ?? 'id desc',
  })
}

export function getPromotionBatch(id: number): Promise<PromotionBatchRow | null> {
  return readOne<PromotionBatchRow>('school.promotion.batch', id, PROMOTION_FIELDS)
}

export interface PromotionLineRow {
  id: number
  student_id: Many2one
  regno: string | false
  current_class_id: Many2one
  annual_average: number
  calculated_outcome: Selection
  final_outcome: Selection
  is_overridden: boolean
  target_class_id: Many2one
  state: Selection
}

export function listPromotionLines(batchId: number): Promise<Page<PromotionLineRow> | null> {
  return orNullOnRefusal(
    searchRead<PromotionLineRow>(
      'school.promotion.line',
      [
        'student_id',
        'regno',
        'current_class_id',
        'annual_average',
        'calculated_outcome',
        'final_outcome',
        'is_overridden',
        'target_class_id',
        'state',
      ],
      { domain: [['batch_id', '=', batchId]], limit: 200, order: 'student_id' },
    ),
  )
}

/** Override an outcome. Odoo records the reason and flags the line. */
export function overridePromotionOutcome(
  lineId: number,
  outcome: string,
  reason: string,
): Promise<boolean> {
  return write('school.promotion.line', [lineId], {
    final_outcome: outcome,
    override_reason: reason,
  })
}
