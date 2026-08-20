from odoo import api, fields, models
from odoo.exceptions import ValidationError

# Grade boundaries, highest first. First band whose floor the percentage reaches wins.
DEFAULT_GRADE_BANDS = [(90, 'A'), (80, 'B'), (70, 'C'), (60, 'D'), (50, 'E')]
GRADE_BANDS = DEFAULT_GRADE_BANDS

# BR-10: statuses that carry a countable score. Everything else renders no grade.
SCORED_STATUSES = ('recorded', 'transfer', 'makeup')

# Fields a teacher fills in — roster identity and assessment scope are generated.
ENTRY_FIELDS = {'score', 'mark_status', 'note'}
SCOPE_FIELDS = {'assessment_id', 'student_id', 'student_subject_id', 'class_id',
                'subject_id', 'term_id', 'exam_type', 'max_score'}


class SchoolMark(models.Model):
    _name = 'school.mark'
    _description = 'Student Mark / Result'
    _order = 'academic_year_id, term_id, student_id'

    assessment_id = fields.Many2one(
        'school.assessment', string='Assessment', required=True,
        ondelete='restrict', index=True,
    )
    student_id = fields.Many2one(
        'school.student', string='Student', required=True, ondelete='restrict',
        domain="[('registration_status', '=', 'approved'), ('enrollment_ids.subject_ids.state', '=', 'enrolled')]",
        help='Only approved student registrations can receive marks.',
    )
    student_subject_id = fields.Many2one(
        'school.student.subject', string='Student Subject Enrollment',
        ondelete='restrict', index=True,
        help='Links mark to specific student subject enrollment roster if applicable.'
    )
    # Snapshot of the class at recording time — a later transfer must not
    # rewrite mark history (same fix as attendance in 17.0.7.0.0).
    class_id = fields.Many2one(
        'school.class', string='Grade / Class', readonly=True,
    )
    academic_year_id = fields.Many2one(
        'school.academic.year', related='class_id.academic_year_id',
        string='Academic Year', store=True, readonly=True,
    )
    subject_id = fields.Many2one(
        'school.subject', string='Subject', required=True, ondelete='restrict',
    )
    term_id = fields.Many2one(
        'school.term', string='Term', required=True,
        ondelete='restrict', index=True,
    )
    exam_type = fields.Selection([
        ('quiz', 'Quiz'),
        ('assignment', 'Assignment'),
        ('test', 'Test'),
        ('midterm', 'Mid-term Exam'),
        ('final', 'Final Exam'),
    ], string='Assessment Type', required=True, default='test')

    mark_status = fields.Selection([
        ('pending', 'Pending'),
        ('recorded', 'Recorded'),
        ('absent', 'Absent'),
        ('exempt', 'Exempt'),
        ('not_enrolled', 'Not Enrolled'),
        ('makeup', 'Make-up Required'),
        ('transfer', 'Transfer Mark'),
    ], string='Status', required=True, default='recorded')
    score = fields.Float(string='Score', required=True, default=0.0)
    max_score = fields.Float(string='Out Of', required=True, default=100.0)
    
    # Weight contribution from parent assessment
    weight = fields.Float(
        related='assessment_id.weight', string='Weight (%)', readonly=True,
    )
    percentage = fields.Float(
        string='Percentage', compute='_compute_percentage', store=True,
    )
    weighted_score = fields.Float(
        string='Weighted Score', compute='_compute_percentage', store=True,
        help='Contribution percentage calculated toward term total mark.'
    )
    grade = fields.Char(
        string='Grade', compute='_compute_percentage', store=True,
    )

    recorded_by_id = fields.Many2one(
        'res.users', string='Recorded By', default=lambda self: self.env.user, readonly=True,
    )
    note = fields.Text(string='Remarks')
    active = fields.Boolean(string='Active', default=True)

    _assessment_student_unique = models.Constraint(
        'unique(assessment_id, student_id)',
        'This student is already on the mark list for this assessment.',
    )
    _max_score_positive = models.Constraint(
        'CHECK(max_score > 0)',
        'Out Of must be greater than zero.',
    )
    _score_not_negative = models.Constraint(
        'CHECK(score >= 0)',
        'Score cannot be negative.',
    )

    @api.depends('score', 'max_score', 'mark_status', 'assessment_id.weight')
    def _compute_percentage(self):
        for rec in self:
            if rec.mark_status in SCORED_STATUSES:
                rec.percentage = (rec.score / rec.max_score * 100) if rec.max_score else 0.0
                scheme = rec.env.company.school_grading_scheme_id
                band = scheme.grade_for(rec.percentage) if scheme else False
                rec.grade = band.name if band else next(
                    (g for floor, g in GRADE_BANDS if rec.percentage >= floor), 'F')
                weight_val = rec.assessment_id.weight if rec.assessment_id else 0.0
                rec.weighted_score = (rec.percentage * weight_val / 100.0)
            else:
                rec.percentage = 0.0
                rec.grade = False
                rec.weighted_score = 0.0

    @api.constrains('score', 'max_score')
    def _check_score_within_max(self):
        for rec in self:
            if rec.score > rec.max_score:
                raise ValidationError('Score cannot be greater than Out Of.')

    @api.constrains('student_id', 'subject_id', 'term_id', 'class_id')
    def _check_subject_taught_to_class(self):
        """A mark only makes sense where someone is assigned to teach that subject
        to that class in that term (BR-05). Safely handles unassigned class fallbacks."""
        for rec in self:
            target_class = rec.class_id or rec.assessment_id.class_id or rec.student_id.class_id
            if not target_class or not rec.subject_id or not rec.term_id:
                continue

            taught = self.env['school.teacher.assignment'].search_count([
                ('subject_id', '=', rec.subject_id.id),
                ('class_id', '=', target_class.id),
                ('term_id', '=', rec.term_id.id),
            ])
            if not taught:
                raise ValidationError(
                    f'{rec.subject_id.name} is not assigned to any teacher for '
                    f'{target_class.display_name} in {rec.term_id.name}.'
                )

    @api.constrains('assessment_id', 'student_id', 'student_subject_id',
                    'class_id', 'subject_id', 'term_id', 'exam_type', 'max_score')
    def _check_assessment_scope(self):
        """Every mark is one generated roster row for one exact assessment.

        UI domains are convenience only; this guard also protects imports and RPC.
        """
        for rec in self:
            assessment = rec.assessment_id
            if rec.class_id != assessment.class_id \
                    or rec.subject_id != assessment.subject_id \
                    or rec.term_id != assessment.term_id \
                    or rec.exam_type != assessment.assessment_type \
                    or rec.max_score != assessment.max_mark:
                raise ValidationError(
                    'The mark class, subject, term, type, and maximum must match its assessment.')
            line = rec.student_subject_id
            if not line or line.student_id != rec.student_id \
                    or line.class_id != assessment.class_id \
                    or line.subject_id != assessment.subject_id \
                    or line.state != 'enrolled' \
                    or line.date_start > assessment.date \
                    or (line.date_end and line.date_end < assessment.date):
                raise ValidationError(
                    '%s is not enrolled in %s for %s on the assessment date.' % (
                        rec.student_id.name, assessment.subject_id.name,
                        assessment.class_id.display_name))

    @api.onchange('assessment_id')
    def _onchange_assessment_id(self):
        if self.assessment_id:
            self.class_id = self.assessment_id.class_id
            self.subject_id = self.assessment_id.subject_id
            self.term_id = self.assessment_id.term_id
            self.exam_type = self.assessment_id.assessment_type
            self.max_score = self.assessment_id.max_mark

    @api.model_create_multi
    def create(self, vals_list):
        for vals in vals_list:
            assessment = self.env['school.assessment'].browse(vals.get('assessment_id')) if vals.get('assessment_id') else False
            if assessment and assessment.state not in ('draft', 'open'):
                raise ValidationError(
                    'Mark list rows can only be added while the assessment is open.')
            if assessment:
                expected = {
                    'class_id': assessment.class_id.id,
                    'subject_id': assessment.subject_id.id,
                    'term_id': assessment.term_id.id,
                    'exam_type': assessment.assessment_type,
                    'max_score': assessment.max_mark,
                }
                for field_name, value in expected.items():
                    if field_name in vals and vals[field_name] != value:
                        raise ValidationError(
                            'Mark scope is generated from the assessment and cannot be changed.')
                    vals[field_name] = value
                if vals.get('student_id') and not vals.get('student_subject_id'):
                    line = self.env['school.student.subject'].search([
                        ('student_id', '=', vals['student_id']),
                        ('grade_subject_id.class_id', '=', assessment.class_id.id),
                        ('subject_id', '=', assessment.subject_id.id),
                        ('state', '=', 'enrolled'),
                        ('date_start', '<=', assessment.date),
                        ('|', ('date_end', '=', False), ('date_end', '>=', assessment.date)),
                    ], limit=1)
                    if line:
                        vals['student_subject_id'] = line.id
            elif not vals.get('class_id') and vals.get('student_id'):
                student = self.env['school.student'].browse(vals['student_id'])
                vals['class_id'] = student.class_id.id
        return super().create(vals_list)

    def write(self, vals):
        if SCOPE_FIELDS & vals.keys():
            raise ValidationError(
                'A mark roster row cannot be reassigned. Regenerate the assessment list instead.')
        if ENTRY_FIELDS & vals.keys():
            locked = self.filtered(
                lambda m: m.assessment_id and m.assessment_id.state not in ('draft', 'open'))
            if locked:
                raise ValidationError(
                    'Marks can only be edited while their assessment is open. '
                    'Use the unlock workflow (BR-11).')
            if 'score' in vals and 'mark_status' not in vals:
                pending = self.filtered(lambda m: m.mark_status == 'pending')
                if pending:
                    super(SchoolMark, pending).write(dict(vals, mark_status='recorded'))
                    return super(SchoolMark, self - pending).write(vals)
        tracked = ENTRY_FIELDS & vals.keys()
        before = {
            rec.id: {field: rec[field] for field in tracked}
            for rec in self
        } if tracked else {}
        result = super().write(vals)
        for rec in self.filtered(lambda mark: mark.id in before):
            changed = {
                field: {'old': before[rec.id][field], 'new': rec[field]}
                for field in tracked if before[rec.id][field] != rec[field]
            }
            if changed:
                self.env['school.assessment.event'].sudo().create({
                    'assessment_id': rec.assessment_id.id,
                    'event_type': 'mark_correction',
                    'actor_id': self.env.user.id,
                    'reason': self.env.context.get('correction_reason'),
                    'changed_values': changed,
                })
        return result

    def unlink(self):
        if any(m.assessment_id and m.assessment_id.state not in ('draft', 'open') for m in self):
            raise ValidationError(
                'Mark list rows cannot be deleted once the assessment is submitted.')
        return super().unlink()