import 'server-only'

/**
 * The allowlist of Odoo business transitions the UI may invoke.
 *
 * The browser never names a model or a method — it posts a workflow key and a
 * record id, and this table is the only thing that turns those into a call.
 * Anything not listed here is unreachable from the frontend.
 *
 * `from` mirrors the guard inside each Odoo method. It decides which buttons
 * are *offered*; Odoo re-checks the same guard and remains the authority. A
 * mismatch shows up as a rejected action, never as a silent success.
 */

export interface Transition {
  /** Stable key used in the form payload. */
  key: string
  /** The Odoo method. Never supplied by the client. */
  method: string
  label: string
  /** States the transition is offered from. Empty means "any". */
  from: string[]
  /** Shown in a confirmation step before the call is made. */
  confirm?: string
  destructive?: boolean
  /** Odoo requires a reason argument (e.g. assessment return). */
  requiresReason?: boolean
  /** Passed in context rather than as an argument (audit trail). */
  reasonContextKey?: string
  /**
   * Odoo expects the reason on a field before the method runs — e.g.
   * school.document.action_reject() raises unless rejection_reason is set.
   */
  reasonWriteField?: string
}

export interface WorkflowSpec {
  model: string
  /** Field holding the state these transitions move through. */
  stateField: string
  transitions: Transition[]
}

export const WORKFLOWS = {
  /* ----------------------------------------------------------- staff --- */
  staff: {
    model: 'school.staff',
    stateField: 'state',
    transitions: [
      { key: 'activate', method: 'action_activate', label: 'Activate', from: ['draft', 'suspended', 'inactive'] },
      {
        key: 'suspend', method: 'action_suspend', label: 'Suspend', from: ['active'],
        confirm: 'Suspend this staff member? They cannot take new teaching assignments while suspended.',
      },
      {
        key: 'deactivate', method: 'action_deactivate', label: 'Deactivate', from: ['active', 'suspended'],
        confirm: 'Deactivate this staff member? Their Odoo login is archived so access cannot outlive employment.',
        destructive: true,
      },
      {
        key: 'reset', method: 'action_reset_draft', label: 'Return to draft', from: ['active', 'suspended', 'inactive'],
        confirm: 'Return to Draft? Linked teacher profiles are set inactive.',
      },
    ],
  },

  /* --------------------------------------------------------- student --- */
  student: {
    model: 'school.student',
    stateField: 'registration_status',
    transitions: [
      { key: 'verify', method: 'action_pending_verification', label: 'Send for verification', from: ['draft', 'incomplete'] },
      {
        key: 'submit', method: 'action_mark_submitted', label: 'Submit registration',
        from: ['draft', 'pending_verification', 'incomplete'],
      },
      {
        key: 'approve', method: 'action_mark_approved', label: 'Approve registration', from: ['submitted'],
        confirm:
          'Approve this registration? Odoo assigns the student and admission numbers, creates the enrolment and links the guardian.',
      },
      {
        key: 'reject', method: 'action_reject', label: 'Reject', from: ['pending_verification', 'submitted'],
        confirm: 'Reject this registration?', destructive: true,
      },
    ],
  },

  /* ------------------------------------------------------ enrollment --- */
  enrollment: {
    model: 'school.enrollment',
    stateField: 'state',
    transitions: [
      {
        key: 'activate', method: 'action_activate', label: 'Activate', from: ['draft'],
        confirm:
          'Activate this enrolment? Odoo checks class capacity, allocates a roll number, records the placement and derives the compulsory subjects.',
      },
      { key: 'discard', method: 'action_discard', label: 'Discard', from: ['draft'], destructive: true, confirm: 'Discard this draft enrolment?' },
      {
        key: 'withdraw', method: 'action_withdraw', label: 'Withdraw', from: ['active'],
        confirm: 'Withdraw this enrolment? The student lifecycle becomes Withdrawn.', destructive: true,
      },
      { key: 'complete', method: 'action_complete', label: 'Complete', from: ['active'] },
      {
        key: 'graduate', method: 'action_graduate', label: 'Graduate', from: ['active'],
        confirm: 'Graduate this student? The enrolment completes and the lifecycle becomes Graduated.',
      },
    ],
  },

  /* ------------------------------------------------------ assessment --- */
  assessment: {
    model: 'school.assessment',
    stateField: 'state',
    transitions: [
      {
        key: 'open', method: 'action_open', label: 'Open mark list', from: ['draft'],
        confirm: 'Open this assessment? Odoo generates the mark list from the subject enrolments valid on the assessment date.',
      },
      { key: 'regenerate', method: 'action_regenerate', label: 'Regenerate roster', from: ['open'] },
      { key: 'submit', method: 'action_submit', label: 'Submit for approval', from: ['open'], reasonContextKey: 'transition_reason' },
      {
        key: 'return', method: 'action_return', label: 'Return to teacher', from: ['submitted'],
        requiresReason: true, confirm: 'Return this mark list to the teacher?',
      },
      { key: 'reopen', method: 'action_reopen', label: 'Reopen', from: ['returned'] },
      { key: 'approve', method: 'action_approve', label: 'Approve', from: ['submitted'], reasonContextKey: 'transition_reason' },
      { key: 'lock', method: 'action_lock', label: 'Lock', from: ['approved'], reasonContextKey: 'transition_reason' },
      {
        key: 'publish', method: 'action_publish', label: 'Publish', from: ['locked'],
        confirm: 'Publish these results? Publishing requires a configured grading policy.',
        reasonContextKey: 'transition_reason',
      },
    ],
  },

  /*
    ----------------------------------------------------- report card ---

    This table previously described a machine the model does not have.

    `school.report.card` is declared twice in the addon: once in
    models/school_report_card.py and once in models/school_results.py. Only the
    second is imported by models/__init__.py — the first is dead code — so the
    effective states are draft → approved → published, plus superseded, and
    there is no `generated` state and no `action_generate` on the record at all.

    The consequence was that `generate` called a method that does not exist,
    and `approve` was gated on a state a card can never hold, so a report card
    could not be approved through this application at any point. Verified
    against a running Odoo 19:

        _fields['state'].selection -> draft, approved, published, superseded
        hasattr(card, 'action_generate') -> False
        action_approve filters on state == 'draft'

    Generating a report card is the `school.report.card.generate` wizard, which
    creates the record; see lib/odoo/models/assessment.ts.
  */
  reportCard: {
    model: 'school.report.card',
    stateField: 'state',
    transitions: [
      {
        key: 'approve', method: 'action_approve', label: 'Approve', from: ['draft'],
        confirm: 'Approve this report card? Only an Exam Officer may approve, and Odoo re-checks that.',
      },
      {
        key: 'publish', method: 'action_publish', label: 'Publish', from: ['approved'],
        confirm: 'Publish this report card? Any previous published version is superseded.',
      },
    ],
  },

  /* ------------------------------------------------------- promotion --- */
  promotion: {
    model: 'school.promotion.batch',
    stateField: 'state',
    transitions: [
      { key: 'calculate', method: 'action_calculate_outcomes', label: 'Calculate outcomes', from: ['draft', 'calculated'] },
      { key: 'approve', method: 'action_approve', label: 'Approve', from: ['calculated'] },
      {
        key: 'apply', method: 'action_apply_promotion', label: 'Apply promotion', from: ['approved'],
        confirm: 'Apply this promotion batch? Enrolments are advanced for every student in it.',
      },
    ],
  },

  /* --------------------------------------------------- academic year --- */
  academicYear: {
    model: 'school.academic.year',
    stateField: 'state',
    transitions: [
      {
        key: 'open', method: 'action_open', label: 'Open year', from: ['draft'],
        confirm: 'Open this academic year? It becomes the year new registrations default to.',
      },
      { key: 'close', method: 'action_close', label: 'Close year', from: ['open'], confirm: 'Close this year? Closed years become read-only.' },
      { key: 'archive', method: 'action_archive_year', label: 'Archive', from: ['closed'], destructive: true, confirm: 'Archive this academic year?' },
      { key: 'next', method: 'action_create_next_year', label: 'Create next year', from: ['open', 'closed'] },
    ],
  },

  /* -------------------------------------------------------- schedule --- */
  /*
    `action_reset_draft` exists on the model and was reachable from nowhere, so
    a cancelled or completed slot was a dead end in this application: the only
    way back was the Odoo backend. None of these four methods carries a state
    guard — the model lets any of them run from any state — so `from` is this
    table's judgement about what is worth offering, and it is deliberately
    narrower than what Odoo would accept.

    There is no `action_reschedule`. Moving a live lesson is an edit of its day
    and times plus a reason, which `_check_reschedule_reason` requires, so it
    lives on the edit form and is written in one call. See updateSlot().
  */
  schedule: {
    model: 'school.class.schedule',
    stateField: 'state',
    transitions: [
      { key: 'publish', method: 'action_publish', label: 'Publish', from: ['draft', 'rescheduled'] },
      { key: 'complete', method: 'action_complete', label: 'Mark completed', from: ['published'] },
      { key: 'cancel', method: 'action_cancel', label: 'Cancel', from: ['draft', 'published', 'rescheduled'], destructive: true, confirm: 'Cancel this slot? It releases the teacher, class and room.' },
      {
        key: 'reset', method: 'action_reset_draft', label: 'Return to draft',
        from: ['published', 'cancelled', 'completed', 'rescheduled'],
        confirm: 'Return this slot to draft? It stops being part of the published timetable, and a cancelled slot starts holding its teacher, class and room again.',
      },
    ],
  },

  /* ---------------------------------------------------- announcement --- */
  announcement: {
    model: 'school.announcement',
    stateField: 'state',
    transitions: [
      { key: 'publish', method: 'action_publish', label: 'Publish', from: ['draft'] },
      { key: 'archive', method: 'action_archive_announcement', label: 'Archive', from: ['published'] },
      { key: 'reset', method: 'action_reset_draft', label: 'Return to draft', from: ['published', 'archived'] },
    ],
  },

  /* --------------------------------------------------------- program --- */
  program: {
    model: 'school.program',
    stateField: 'state',
    transitions: [
      { key: 'publish', method: 'action_publish', label: 'Publish', from: ['draft'] },
      { key: 'complete', method: 'action_complete', label: 'Mark completed', from: ['published'] },
      { key: 'cancel', method: 'action_cancel', label: 'Cancel', from: ['draft', 'published'], destructive: true, confirm: 'Cancel this program?' },
    ],
  },

  /* -------------------------------------------------------- document --- */
  document: {
    model: 'school.document',
    stateField: 'state',
    transitions: [
      { key: 'verify', method: 'action_verify', label: 'Verify', from: ['pending', 'uploaded', 'rejected'] },
      {
        key: 'reject', method: 'action_reject', label: 'Reject', from: ['pending', 'uploaded', 'verified'],
        destructive: true, requiresReason: true, reasonWriteField: 'rejection_reason',
        confirm: 'Reject this document? Odoo requires a rejection reason.',
      },
    ],
  },
} as const satisfies Record<string, WorkflowSpec>

export type WorkflowKey = keyof typeof WORKFLOWS

export function getWorkflow(key: string): WorkflowSpec | null {
  return (WORKFLOWS as Record<string, WorkflowSpec>)[key] ?? null
}

/** Transitions offered from a given state — for rendering only. */
export function availableTransitions(key: WorkflowKey, state: string): Transition[] {
  const spec = WORKFLOWS[key] as WorkflowSpec
  return spec.transitions.filter((t) => t.from.length === 0 || t.from.includes(state))
}
