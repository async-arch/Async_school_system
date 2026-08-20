from odoo import api, fields, models
from odoo.exceptions import AccessError, ValidationError

ASSESSMENT_TYPES = [
    ('quiz', 'Quiz'),
    ('assignment', 'Assignment'),
    ('test', 'Test'),
    ('midterm', 'Mid-term Exam'),
    ('final', 'Final Exam'),
]

# Default max_mark/weight per assessment_type — pre-fills the form field,
# stays editable per-assessment for exceptions (SRS §9.1 keeps these
# configurable; this is convenience, not a hard constraint).
TYPE_DEFAULTS = {
    'quiz': (5.0, 1.0),
    'assignment': (15.0, 3.0),
    'test': (10.0, 2.0),
    'midterm': (20.0, 4.0),
    'final': (50.0, 5.0),
}

# Setup is frozen once the mark list exists: rows were derived from it.
SETUP_FIELDS = {'class_id', 'subject_id', 'term_id', 'date', 'max_mark', 'assessment_type', 'weight'}


class SchoolAssessment(models.Model):
    """An assessment and its mark list (SRS §9). The mark list is generated
    from subject enrollments, never typed in, and the rows are only editable
    while the assessment is open."""
    _name = 'school.assessment'
    _description = 'Assessment / Mark List'
    _inherit = ['mail.thread']
    _order = 'date desc, id desc'

    name = fields.Char(string='Assessment Name', required=True)
    assessment_type = fields.Selection(
        ASSESSMENT_TYPES, string='Type', required=True, default='test')
    class_id = fields.Many2one(
        'school.class', string='Grade / Class', required=True, ondelete='restrict')
    subject_id = fields.Many2one(
        'school.subject', string='Subject', required=True, ondelete='restrict')
    teacher_assignment_id = fields.Many2one(
        'school.teacher.assignment', string='Teacher Assignment',
        ondelete='restrict', index=True,
        domain="[('class_id', '=', class_id), ('subject_id', '=', subject_id), ('term_id', '=', term_id), ('state', '=', 'active'), ('active', '=', True), ('start_date', '<=', date), '|', ('end_date', '=', False), ('end_date', '>=', date)]"
    )
    matching_assignment_count = fields.Integer(
        string='Matching Teacher Assignments',
        compute='_compute_matching_assignment_count',
    )
    assessment_date_in_term = fields.Boolean(
        string='Assessment Date Is Within Term',
        compute='_compute_assessment_date_in_term',
    )
    term_id = fields.Many2one(
        'school.term', string='Term', required=True, ondelete='restrict')
    academic_year_id = fields.Many2one(
        'school.academic.year', related='class_id.academic_year_id',
        string='Academic Year', store=True, readonly=True)
    date = fields.Date(
        string='Assessment Date', required=True,
        default=lambda self: fields.Date.context_today(self))
    max_mark = fields.Float(string='Maximum Mark', required=True, default=100.0)
    weight = fields.Float(
        string='Weight', default=1.0,
        help='Contribution of this assessment to the term result.')
    state = fields.Selection([
        ('draft', 'Draft'),
        ('open', 'Open'),
        ('submitted', 'Submitted'),
        ('returned', 'Returned'),
        ('approved', 'Approved'),
        ('locked', 'Locked'),
        ('published', 'Published'),
    ], default='draft', required=True, tracking=True)

    mark_ids = fields.One2many('school.mark', 'assessment_id', string='Mark List')
    mark_count = fields.Integer(compute='_compute_mark_count')
    event_ids = fields.One2many('school.assessment.event', 'assessment_id', string='Audit Events')

    _max_mark_positive = models.Constraint(
        'CHECK(max_mark > 0)',
        'Maximum Mark must be greater than zero.',
    )
    _weight_not_negative = models.Constraint(
        'CHECK(weight >= 0)',
        'Weight cannot be negative.',
    )

    @api.depends('mark_ids')
    def _compute_mark_count(self):
        for rec in self:
            rec.mark_count = len(rec.mark_ids)

    @api.onchange('assessment_type')
    def _onchange_assessment_type(self):
        if self.assessment_type in TYPE_DEFAULTS:
            self.max_mark, self.weight = TYPE_DEFAULTS[self.assessment_type]

    def _matching_assignment_domain(self):
        self.ensure_one()
        if not (self.class_id and self.subject_id and self.term_id and self.date):
            return [('id', '=', 0)]
        return [
            ('class_id', '=', self.class_id.id),
            ('subject_id', '=', self.subject_id.id),
            ('term_id', '=', self.term_id.id),
            ('state', '=', 'active'),
            ('active', '=', True),
            ('start_date', '<=', self.date),
            ('|', ('end_date', '=', False), ('end_date', '>=', self.date)),
        ]

    @api.depends('class_id', 'subject_id', 'term_id', 'date')
    def _compute_matching_assignment_count(self):
        Assignment = self.env['school.teacher.assignment']
        for rec in self:
            rec.matching_assignment_count = Assignment.search_count(
                rec._matching_assignment_domain())

    @api.depends('term_id', 'date')
    def _compute_assessment_date_in_term(self):
        for rec in self:
            rec.assessment_date_in_term = bool(
                rec.term_id and rec.date
                and rec.term_id.date_start <= rec.date <= rec.term_id.date_end
            )

    @api.constrains('term_id', 'date')
    def _check_assessment_date_in_term(self):
        for rec in self.filtered(lambda item: item.term_id and item.date):
            if not rec.term_id.date_start <= rec.date <= rec.term_id.date_end:
                raise ValidationError(
                    'Assessment Date must be within %s (%s to %s).'
                    % (rec.term_id.name, rec.term_id.date_start,
                       rec.term_id.date_end)
                )

    @api.onchange('class_id')
    def _onchange_class_id(self):
        for rec in self:
            if rec.term_id and rec.term_id.academic_year_id != rec.class_id.academic_year_id:
                rec.term_id = False
            if rec.subject_id and rec.class_id and not self.env['school.grade.subject'].search_count([
                    ('class_id', '=', rec.class_id.id),
                    ('subject_id', '=', rec.subject_id.id),
                    ('active', '=', True)]):
                rec.subject_id = False
            rec.teacher_assignment_id = False
            rec._onchange_assessment_scope()

    @api.onchange('term_id')
    def _onchange_term_id(self):
        for rec in self.filtered('term_id'):
            if not rec.date or rec.date < rec.term_id.date_start:
                rec.date = rec.term_id.date_start
            elif rec.date > rec.term_id.date_end:
                rec.date = rec.term_id.date_end
        self._onchange_assessment_scope()

    @api.onchange('subject_id', 'date')
    def _onchange_assessment_scope(self):
        Assignment = self.env['school.teacher.assignment']
        for rec in self:
            matches = Assignment.search(rec._matching_assignment_domain(), limit=2)
            rec.matching_assignment_count = len(matches)
            rec.teacher_assignment_id = matches if len(matches) == 1 else False

    @api.constrains('class_id', 'subject_id', 'term_id', 'date', 'teacher_assignment_id')
    def _check_assessment_scope(self):
        for rec in self:
            if rec.term_id.academic_year_id != rec.class_id.academic_year_id:
                raise ValidationError('The assessment term must belong to the class academic year.')
            assignment = rec.teacher_assignment_id
            if assignment.class_id != rec.class_id \
                    or assignment.subject_id != rec.subject_id \
                    or assignment.term_id != rec.term_id \
                    or assignment.state != 'active' \
                    or assignment.start_date > rec.date \
                    or (assignment.end_date and assignment.end_date < rec.date):
                raise ValidationError('The assessment must use the exact applicable assignment.')

    @api.model_create_multi
    def create(self, vals_list):
        for vals in vals_list:
            assessment_date = fields.Date.to_date(
                vals.get('date') or fields.Date.context_today(self))
            if vals.get('term_id'):
                term = self.env['school.term'].browse(vals['term_id'])
                if not term.date_start <= assessment_date <= term.date_end:
                    raise ValidationError(
                        'Assessment Date must be within %s (%s to %s).'
                        % (term.name, term.date_start, term.date_end)
                    )
            if not vals.get('teacher_assignment_id') and all(
                    vals.get(field) for field in ('class_id', 'subject_id', 'term_id')):
                assignment = self.env['school.teacher.assignment'].search([
                    ('class_id', '=', vals['class_id']),
                    ('subject_id', '=', vals['subject_id']),
                    ('term_id', '=', vals['term_id']),
                    ('state', '=', 'active'),
                    ('start_date', '<=', assessment_date),
                    ('|', ('end_date', '=', False), ('end_date', '>=', assessment_date)),
                ], limit=1)
                if assignment:
                    vals['teacher_assignment_id'] = assignment.id
            if not vals.get('teacher_assignment_id'):
                raise ValidationError(
                    'Select an active teacher assignment for this class, subject, term, and date.')
            assignment = self.env['school.teacher.assignment'].browse(
                vals['teacher_assignment_id'])
            expected = {
                'class_id': assignment.class_id.id,
                'subject_id': assignment.subject_id.id,
                'term_id': assignment.term_id.id,
            }
            if any(vals.get(field_name) != value
                   for field_name, value in expected.items()):
                raise ValidationError('The assessment must use the exact applicable assignment.')
            if assignment.state != 'active' \
                    or assignment.start_date > assessment_date \
                    or (assignment.end_date and assignment.end_date < assessment_date):
                raise ValidationError('The assessment must use the exact applicable assignment.')
        return super().create(vals_list)

    def write(self, vals):
        if SETUP_FIELDS & vals.keys() and any(r.state != 'draft' for r in self):
            raise ValidationError(
                'Assessment setup is frozen once the mark list is generated.')
        new_state = vals.get('state')
        if new_state in ('approved', 'locked', 'published'):
            self._require_exam_officer()
        if new_state == 'open' and any(
                r.state not in ('draft', 'open') for r in self):
            self._require_exam_officer()
        return super().write(vals)

    def unlink(self):
        if any(r.state != 'draft' for r in self):
            raise ValidationError('Only draft assessments can be deleted.')
        return super().unlink()

    def _require_exam_officer(self):
        if self.env.su:
            return
        if not self.env.user.has_group('school_management.group_school_exam_officer'):
            raise AccessError('Only an Exam Officer can perform this action.')

    def _check_teacher_assigned(self):
        """BR-05: no mark list without an active teacher subject assignment."""
        for rec in self:
            assigned = rec.teacher_assignment_id or self.env['school.teacher.assignment'].search([
                ('subject_id', '=', rec.subject_id.id),
                ('class_id', '=', rec.class_id.id),
                ('term_id', '=', rec.term_id.id),
                ('state', '=', 'active'),
                ('start_date', '<=', rec.date),
                ('|', ('end_date', '=', False), ('end_date', '>=', rec.date)),
            ], limit=1)
            if not assigned:
                raise ValidationError(
                    f'{rec.subject_id.name} has no teacher assigned for '
                    f'{rec.class_id.display_name} in {rec.term_id.name}.')
            if assigned.class_id != rec.class_id or assigned.subject_id != rec.subject_id \
                    or assigned.term_id != rec.term_id:
                raise ValidationError('The assessment must use the exact applicable assignment.')
            if not rec.teacher_assignment_id:
                rec.teacher_assignment_id = assigned

    def _require_assignment_owner(self):
        if self.env.su or self.env.user.has_group('school_management.group_school_exam_officer'):
            return
        for rec in self:
            if rec.teacher_assignment_id.teacher_id.user_id != self.env.user:
                raise AccessError('Teachers may only manage assessments for their exact assignment.')

    def _generate_mark_list(self):
        """BR-06 / AC-06: rows come from subject enrollments valid at the
        assessment date. AC-07 / BR-10: a student enrolled after the date is
        simply not listed — never given a zero."""
        self.ensure_one()
        enrolled = self.env['school.student.subject'].search([
            ('grade_subject_id.class_id', '=', self.class_id.id),
            ('subject_id', '=', self.subject_id.id),
            ('state', '=', 'enrolled'),
            ('date_start', '<=', self.date),
            ('|', ('date_end', '=', False), ('date_end', '>=', self.date),
            ('enrollment_id.state', '!=', 'draft'),
            ('enrollment_id.enrollment_date', '<=', self.date),
            ('|', ('enrollment_id.end_date', '=', False),
                 ('enrollment_id.end_date', '>=', self.date)),
        ])
        listed = set(self.mark_ids.mapped('student_id').ids)
        vals_list = []
        for line in enrolled:
            if line.student_id.id in listed:
                continue
            listed.add(line.student_id.id)
            vals_list.append({
                'assessment_id': self.id,
                'student_id': line.student_id.id,
                'student_subject_id': line.id,
                'mark_status': 'pending',
            })
        if vals_list:
            self.env['school.mark'].sudo().create(vals_list)

    def action_open(self):
        for rec in self:
            if rec.state != 'draft':
                raise ValidationError('Only draft assessments can be opened.')
            rec._check_teacher_assigned()
            rec._require_assignment_owner()
            rec._generate_mark_list()
            rec.state = 'open'

    def action_regenerate(self):
        """Pick up subject enrollments added since opening. Idempotent."""
        for rec in self:
            if rec.state != 'open':
                raise ValidationError('Only open assessments can be regenerated.')
            rec._require_assignment_owner()
            rec._generate_mark_list()

    def action_submit(self):
        self._require_assignment_owner()
        self._transition('open', 'submitted')

    def action_open_return_wizard(self):
        """Button target — opens the reason-prompt wizard. The actual state
        change happens in action_return(), called from the wizard."""
        self.ensure_one()
        if self.state != 'submitted':
            raise ValidationError('Only submitted assessments can be returned.')
        return {
            'type': 'ir.actions.act_window',
            'name': 'Return for Correction',
            'res_model': 'school.assessment.return',
            'view_mode': 'form',
            'target': 'new',
            'context': {'default_assessment_id': self.id},
        }

    def action_return(self, reason):
        """Returns a submitted assessment to open, with a required reason
        posted to the chatter and audit event."""
        self._require_exam_officer()
        for rec in self:
            if rec.state != 'submitted':
                raise ValidationError('Only submitted assessments can be returned.')
            rec.state = 'returned'
            rec.message_post(body='Returned for correction: %s' % reason)
            self.env['school.assessment.event'].sudo().create({
                'assessment_id': rec.id,
                'event_type': 'returned',
                'actor_id': self.env.user.id,
                'reason': reason or self.env.context.get('transition_reason'),
            })

    def action_reopen(self):
        self._require_assignment_owner()
        self._transition('returned', 'open')

    def action_approve(self):
        self._require_exam_officer()
        self._transition('submitted', 'approved')

    def action_lock(self):
        self._require_exam_officer()
        self._transition('approved', 'locked')

    def action_publish(self):
        self._require_exam_officer()
        if not self.env.company.school_grading_configured \
                or not self.env.company.school_grading_scheme_id:
            raise ValidationError(
                'Publishing is blocked until a grading policy is configured in School Settings.')
        self._transition('locked', 'published')

    def action_unlock_wizard(self):
        """Triggers the unlock popup dialog from the form view header."""
        self.ensure_one()
        self._require_exam_officer()
        return {
            'name': 'Unlock Assessment for Correction',
            'type': 'ir.actions.act_window',
            'res_model': 'school.assessment.unlock',
            'view_mode': 'form',
            'target': 'new',
            'context': {'default_assessment_id': self.id},
        }

    def _transition(self, src, dst):
        for rec in self:
            if rec.state != src:
                raise ValidationError(
                    f'Only {src} assessments can move to {dst}.')
            rec.state = dst
            self.env['school.assessment.event'].sudo().create({
                'assessment_id': rec.id,
                'event_type': dst,
                'actor_id': self.env.user.id,
                'reason': self.env.context.get('transition_reason'),
            })


class SchoolAssessmentEvent(models.Model):
    _name = 'school.assessment.event'
    _description = 'Immutable Assessment Audit Event'
    _order = 'occurred_at desc, id desc'

    assessment_id = fields.Many2one(
        'school.assessment', required=True, ondelete='restrict', index=True)
    event_type = fields.Selection([
        ('open', 'Opened'), ('submitted', 'Submitted'), ('returned', 'Returned'),
        ('approved', 'Approved'), ('locked', 'Locked'), ('published', 'Published'),
        ('unlocked', 'Unlocked'), ('mark_correction', 'Mark Corrected'),
    ], required=True)
    actor_id = fields.Many2one(
        'res.users', required=True, readonly=True, default=lambda self: self.env.user)
    occurred_at = fields.Datetime(required=True, readonly=True, default=fields.Datetime.now)
    reason = fields.Text()
    changed_values = fields.Json(readonly=True)

    def write(self, vals):
        raise AccessError('Assessment audit events are immutable.')

    def unlink(self):
        raise AccessError('Assessment audit events are immutable.')


class SchoolAssessmentUnlock(models.TransientModel):
    """BR-11 / AC-13: approved or locked marks reopen only through here, with
    a reason that lands on the assessment's audit trail."""
    _name = 'school.assessment.unlock'
    _description = 'Unlock Assessment for Correction'

    assessment_id = fields.Many2one(
        'school.assessment', string='Assessment', required=True,
        domain=[('state', 'in', ('approved', 'locked', 'published'))])
    reason = fields.Text(string='Reason', required=True)

    def action_confirm(self):
        self.ensure_one()
        assessment = self.assessment_id
        assessment._require_exam_officer()
        if assessment.state not in ('approved', 'locked', 'published'):
            raise ValidationError('This assessment is not locked or approved.')
        assessment.message_post(body=f'Unlocked for correction: {self.reason}')
        self.env['school.assessment.event'].sudo().create({
            'assessment_id': assessment.id,
            'event_type': 'unlocked',
            'actor_id': self.env.user.id,
            'reason': self.reason,
        })
        assessment.state = 'open'


class SchoolAssessmentReturn(models.TransientModel):
    """Thin UI wrapper — action_confirm just calls the real method."""
    _name = 'school.assessment.return'
    _description = 'Return Assessment for Correction'

    assessment_id = fields.Many2one(
        'school.assessment', string='Assessment', required=True,
        domain=[('state', '=', 'submitted')])
    reason = fields.Text(string='Reason', required=True)

    def action_confirm(self):
        self.ensure_one()
        self.assessment_id.action_return(self.reason)