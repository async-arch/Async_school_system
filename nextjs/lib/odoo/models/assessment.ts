import 'server-only'
import { callKw, create, hasAccess, readOne, searchRead, write } from '@/lib/odoo/client'
import { orNullOnRefusal } from '@/lib/odoo/errors'
import { listDomain, type ListOptions } from '@/lib/odoo/list'
import { m2oId, type Many2one, type Page, type Selection } from '@/lib/odoo/types'

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

export interface AssignmentOption {
  id: number
  teacher_id: Many2one
  subject_id: Many2one
  class_id: Many2one
  term_id: Many2one
  start_date: string
  end_date: string | false
}

/**
 * The assignments an assessment may be created against.
 *
 * An assessment must name the *exact* applicable assignment — Odoo checks that
 * its class, subject and term all match, that it is active, and that the
 * assessment date falls inside its window. Picking the assignment therefore
 * settles the scope in one choice instead of three that can disagree.
 */
export function listAssignmentOptions(): Promise<Page<AssignmentOption>> {
  return searchRead<AssignmentOption>(
    'school.teacher.assignment',
    ['teacher_id', 'subject_id', 'class_id', 'term_id', 'start_date', 'end_date'],
    {
      domain: [
        ['state', '=', 'active'],
        ['active', '=', true],
      ],
      limit: 200,
      order: 'class_id, subject_id',
    },
  )
}

/**
 * Which fields Odoo freezes once the mark list exists.
 *
 * `school.assessment.write` refuses any of these on a record past draft —
 * "Assessment setup is frozen once the mark list is generated." — because the
 * rows were generated against exactly this scope and maximum. The name is not
 * among them, so a typo stays correctable for the life of the assessment.
 */
export const ASSESSMENT_SETUP_FIELDS = [
  'assessment_type', 'date', 'max_mark', 'weight',
] as const

export function updateAssessment(
  id: number,
  values: Record<string, unknown>,
): Promise<boolean> {
  return write('school.assessment', [id], values)
}

export interface AssessmentIntake {
  assignmentId: number
  name: string
  assessment_type: string
  date: string
  max_mark: number
  weight: number
}

/**
 * Create an assessment in draft.
 *
 * The class, subject and term are read back from the assignment rather than
 * taken from the form: Odoo rejects any disagreement, and a client-sent scope
 * is never trusted for a record this one authorises against. The mark list is
 * not created here — `action_open` generates it from the subject enrolments
 * valid on the assessment date, which is the only way rows may come into
 * existence.
 */
export async function createAssessment(intake: AssessmentIntake): Promise<number> {
  const assignment = await readOne<AssignmentOption>(
    'school.teacher.assignment',
    intake.assignmentId,
    ['class_id', 'subject_id', 'term_id', 'start_date', 'end_date'],
  )
  if (!assignment) throw new Error('That teacher assignment is no longer available.')

  const classId = m2oId(assignment.class_id)
  const subjectId = m2oId(assignment.subject_id)
  const termId = m2oId(assignment.term_id)
  if (classId === null || subjectId === null || termId === null) {
    throw new Error('That assignment is missing its class, subject or term.')
  }

  return create('school.assessment', {
    name: intake.name,
    assessment_type: intake.assessment_type,
    date: intake.date,
    max_mark: intake.max_mark,
    weight: intake.weight,
    teacher_assignment_id: intake.assignmentId,
    class_id: classId,
    subject_id: subjectId,
    term_id: termId,
  })
}

/** The states Odoo's unlock wizard accepts. */
export const UNLOCKABLE_STATES = new Set(['approved', 'locked', 'published'])

/**
 * Reopen an approved, locked or published assessment for correction.
 *
 * `school.assessment.unlock` is a transient wizard: create it with the reason,
 * then call `action_confirm`, which re-checks the Exam Officer group, writes an
 * `unlocked` audit event carrying the reason, and moves the assessment back to
 * `open`. None of that is repeated here — BR-11/AC-13 put it in the model on
 * purpose, and a direct `write({state})` would skip the event entirely.
 */
export async function unlockAssessment(assessmentId: number, reason: string): Promise<void> {
  const wizardId = await create('school.assessment.unlock', {
    assessment_id: assessmentId,
    reason,
  })
  await callKw('school.assessment.unlock', 'action_confirm', [[wizardId]])
}

/* --------------------------------------------------------- report card --- */

/*
  Written against `models/school_results.py`, which is the only definition of
  `school.report.card` that Odoo loads.

  `models/school_report_card.py` declares the same model with a different shape
  — a `generated` state, an `overall_percentage`, a `school.report.card.line`
  one2many — but it is absent from `models/__init__.py` and therefore dead. The
  services here previously described that dead shape, which is why the detail
  page answered 404 for every card and every role: ten of the nineteen fields it
  asked for do not exist, `read` raised, and the refusal handler turned that
  into "no such record".

  The live model keeps subject results in a JSON snapshot rather than in child
  records, taken at generation time so a published card cannot drift when a
  mark is later corrected.
*/

export interface ReportCardRow {
  id: number
  name: string
  student_id: Many2one
  class_id: Many2one
  term_id: Many2one
  academic_year_id: Many2one
  state: Selection
  result: Selection
  overall_average: number
  version: number
}

const REPORT_CARD_LIST_FIELDS = [
  'name',
  'student_id',
  'class_id',
  'term_id',
  'academic_year_id',
  'state',
  'result',
  'overall_average',
  'version',
] as const

export const REPORT_CARD_FILTERS = {
  status: { field: 'state' },
  result: { field: 'result' },
  class: { field: 'class_id', kind: 'many2one' },
  term: { field: 'term_id', kind: 'many2one' },
} as const

export function listReportCards(options: ListOptions = {}): Promise<Page<ReportCardRow>> {
  return searchRead<ReportCardRow>('school.report.card', REPORT_CARD_LIST_FIELDS, {
    domain: listDomain(options, {
      searchFields: ['name', 'student_id.name'],
      filters: REPORT_CARD_FILTERS,
    }),
    limit: options.limit ?? 25,
    offset: options.offset ?? 0,
    order: options.order ?? 'id desc',
  })
}

/** One subject inside `result_snapshot`, as Odoo writes it at generation. */
export interface SubjectResult {
  subject: string
  raw_total: number
  maximum_total: number
  percentage: number
  grade: string | false
  pass: boolean
}

export interface ReportCardDetail extends ReportCardRow {
  /** Frozen at generation; the source of the subject table. */
  result_snapshot: SubjectResult[] | false
  /** Attendance status counts for the term, as `{status: count}`. */
  attendance_summary: Record<string, number> | false
  conduct: Selection
  class_rank: number
  class_size: number
  grade_rank: number
  grade_size: number
  homeroom_remarks: string | false
  principal_remarks: string | false
  correction_reason: string | false
  grading_scheme_id: Many2one
  enrollment_id: Many2one
  supersedes_id: Many2one
  superseded_by_id: Many2one
  approved_by_id: Many2one
  approved_at: string | false
  published_at: string | false
}

export function getReportCard(id: number): Promise<ReportCardDetail | null> {
  return orNullOnRefusal(
    readOne<ReportCardDetail>('school.report.card', id, [
      ...REPORT_CARD_LIST_FIELDS,
      'result_snapshot',
      'attendance_summary',
      'conduct',
      'class_rank',
      'class_size',
      'grade_rank',
      'grade_size',
      'homeroom_remarks',
      'principal_remarks',
      'correction_reason',
      'grading_scheme_id',
      'enrollment_id',
      'supersedes_id',
      'superseded_by_id',
      'approved_by_id',
      'approved_at',
      'published_at',
    ]),
  )
}

/**
 * The subject rows, straight out of the snapshot.
 *
 * No arithmetic happens here. Odoo applied the grading scheme and the
 * assessment weights when it generated the card, and re-deriving any of it in
 * TypeScript would be a second, divergent implementation of the school's
 * grading policy.
 */
export function subjectResults(card: ReportCardDetail): SubjectResult[] {
  return Array.isArray(card.result_snapshot) ? card.result_snapshot : []
}

/** Attendance counts for the term, ordered with the meaningful states first. */
export function attendanceBreakdown(card: ReportCardDetail): Array<{ status: string; count: number }> {
  const summary = card.attendance_summary
  if (!summary || typeof summary !== 'object') return []
  const order = ['present', 'absent', 'late', 'excused', 'sick', 'official_duty', 'half_day']
  return Object.entries(summary)
    .map(([status, count]) => ({ status, count: Number(count) || 0 }))
    .sort((a, b) => {
      const ai = order.indexOf(a.status)
      const bi = order.indexOf(b.status)
      return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi)
    })
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

/* ------------------------------------------------ report card generator --- */

/**
 * Generate report cards.
 *
 * This is the only way a report card comes into existence — `school.report.card`
 * has no create form and no `action_generate` on the record. Generation is the
 * `school.report.card.generate` wizard, which reads the published marks for a
 * term and mints a versioned card per student, superseding any previous one.
 *
 * The wizard is a TransientModel, so this follows the same shape as the
 * attendance roster: create the record, then call its action. The model and
 * method names are constants in this file — the browser supplies only the
 * class, student and term ids, exactly as it does for every other call.
 *
 * Odoo re-checks that the caller is an Administrator or Exam Officer inside
 * `action_generate`, and raises if a grading scheme is not configured. Neither
 * check is repeated here.
 */
export async function generateReportCards(input: {
  mode: 'class' | 'student'
  classId?: number
  studentId?: number
  termId: number
  correctionReason?: string
}): Promise<void> {
  const values: Record<string, unknown> = {
    generation_mode: input.mode,
    term_id: input.termId,
  }
  if (input.mode === 'class' && input.classId) values.class_id = input.classId
  if (input.mode === 'student' && input.studentId) values.student_id = input.studentId
  if (input.correctionReason) values.correction_reason = input.correctionReason

  const wizardId = await create('school.report.card.generate', values)
  await callKw('school.report.card.generate', 'action_generate', [[wizardId]])
}

/** Whether the signed-in user may generate report cards, per Odoo's own ACL. */
export function canGenerateReportCards(): Promise<boolean> {
  return hasAccess('school.report.card.generate', 'create')
}

/* --------------------------------------------------- promotion authoring --- */

/**
 * Creating a promotion batch — the step that closes an academic year.
 *
 * `school.promotion.batch` could be listed, opened and run, and could be
 * created nowhere: on a fresh database the last three steps of the school year
 * (calculate → approve → apply) were unreachable, because there was never a
 * batch to run them on.
 *
 * Everything below the create is Odoo's. `action_calculate_outcomes` reads each
 * student's published report cards — falling back to their recorded marks —
 * averages them against this batch's threshold, and picks promoted, retained
 * or graduated. `action_approve` refuses a batch with no lines or with any
 * promoted/retained student who has no target class. `action_apply_promotion`
 * completes the old enrolment and opens the next one. None of that is repeated
 * here, and no outcome is ever computed in TypeScript.
 */

export interface PromotionYearOption {
  id: number
  name: string
  date_start: string
  date_end: string
  state: Selection
}

export interface PromotionGradeOption {
  id: number
  name: string
  sequence: number
}

export interface PromotionClassOption {
  id: number
  name: string
  yearId: number
  gradeId: number
}

/**
 * The pickers a batch is built from.
 *
 * Classes are fetched flat with their year and grade so the form can narrow
 * them as the two are chosen — the same shape `class_ids` carries as a domain
 * on the model. Odoo re-checks the domain on write regardless.
 */
export async function promotionFormOptions(): Promise<{
  years: PromotionYearOption[]
  grades: PromotionGradeOption[]
  classes: PromotionClassOption[]
}> {
  const [years, grades, classes] = await Promise.all([
    searchRead<PromotionYearOption>(
      'school.academic.year',
      ['name', 'date_start', 'date_end', 'state'],
      { limit: 50, order: 'date_start desc', withTotal: false },
    ),
    searchRead<PromotionGradeOption>('school.grade', ['name', 'sequence'], {
      domain: [['active', '=', true]],
      limit: 50,
      order: 'sequence',
      withTotal: false,
    }),
    searchRead<{ id: number; name: string; academic_year_id: Many2one; grade_id: Many2one }>(
      'school.class',
      ['name', 'academic_year_id', 'grade_id'],
      { domain: [['active', '=', true]], limit: 500, order: 'name', withTotal: false },
    ),
  ])

  return {
    years: years.rows,
    grades: grades.rows,
    classes: classes.rows.flatMap((row) => {
      const yearId = m2oId(row.academic_year_id)
      const gradeId = m2oId(row.grade_id)
      return yearId && gradeId ? [{ id: row.id, name: row.name, yearId, gradeId }] : []
    }),
  }
}

/**
 * Batches already covering this year and grade that have not been applied.
 *
 * Odoo has **no uniqueness constraint** on a promotion batch, so nothing stops
 * a second one for the same grade and year existing — and running both would
 * advance the same students twice. This is a frontend guard against that, not
 * a rule: the Odoo backend would still allow it, and a constraint on the model
 * is the real fix. See the note in the pull request.
 */
export async function unfinishedBatchesFor(
  yearId: number,
  gradeId: number,
): Promise<PromotionBatchRow[]> {
  const page = await searchRead<PromotionBatchRow>('school.promotion.batch', PROMOTION_FIELDS, {
    domain: [
      ['academic_year_id', '=', yearId],
      ['grade_id', '=', gradeId],
      ['state', '!=', 'done'],
    ],
    limit: 5,
    withTotal: false,
  })
  return page.rows
}

export interface PromotionBatchIntake {
  academicYearId: number
  targetAcademicYearId: number
  gradeId: number
  classIds: number[]
  minimumPassAverage: number
  maxFailedSubjects: number
}

export function createPromotionBatch(intake: PromotionBatchIntake): Promise<number> {
  return create('school.promotion.batch', {
    academic_year_id: intake.academicYearId,
    target_academic_year_id: intake.targetAcademicYearId,
    grade_id: intake.gradeId,
    // Empty means "every class of that grade in that year", which is what
    // action_calculate_outcomes falls back to.
    class_ids: [[6, 0, intake.classIds]],
    minimum_pass_average: intake.minimumPassAverage,
    max_failed_subjects: intake.maxFailedSubjects,
  })
}

export function canCreatePromotionBatch(): Promise<boolean> {
  return hasAccess('school.promotion.batch', 'create')
}
