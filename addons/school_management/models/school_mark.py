from odoo import api, fields, models
from odoo.exceptions import ValidationError

# Grade boundaries, highest first. First band whose floor the percentage reaches wins.
DEFAULT_GRADE_BANDS = [(90, 'A'), (80, 'B'), (70, 'C'), (60, 'D'), (50, 'E')]
GRADE_BANDS = DEFAULT_GRADE_BANDS

# BR-10: statuses that carry a countable score. Everything else renders no grade.
SCORED_STATUSES = ('recorded', 'transfer', 'makeup')

# Fields a teacher fills in — editable only while the assessment is open.
ENTRY_FIELDS = {'score', 'max_score', 'mark_status', 'note', 'student_id'}


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
        domain="[('registration_status', '=', 'approved')]",
        help='Only approved student registrations can receive marks.',
    )
    student_subject_id = fields.Many2one(
        'school.student.subject', string='Subject Enrollment',
        ondelete='restrict', index=True,
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
    percentage = fields.Float(string='Percentage', compute='_compute_percentage', store=True)
    grade = fields.Char(string='Grade', compute='_compute_percentage', store=True)

    recorded_by_id = fields.Many2one(
        'res.users', string='Recorded By', default=lambda self: self.env.user, readonly=True,
    )
    note = fields.Text(string='Remarks')
    active = fields.Boolean(string='Active', default=True)

    _sql_constraints = [
        ('assessment_student_unique', 'unique(assessment_id, student_id)',
         'This student is already on the mark list for this assessment.'),
        ('max_score_positive', 'CHECK(max_score > 0)', 'Out Of must be greater than zero.'),
        ('score_not_negative', 'CHECK(score >= 0)', 'Score cannot be negative.'),
    ]

    @api.depends('score', 'max_score', 'mark_status')
    def _compute_percentage(self):
        for rec in self:
            if rec.mark_status in SCORED_STATUSES:
                rec.percentage = (rec.score / rec.max_score * 100) if rec.max_score else 0.0
                rec.grade = next(
                    (grade for floor, grade in DEFAULT_GRADE_BANDS
                     if rec.percentage >= floor),
                    'F',
                )
            else:
                rec.percentage = 0.0
                rec.grade = False

    @api.constrains('score', 'max_score')
    def _check_score_within_max(self):
        for rec in self:
            if rec.score > rec.max_score:
                raise ValidationError('Score cannot be greater than Out Of.')

    @api.constrains('student_id', 'subject_id', 'term_id')
    def _check_subject_taught_to_class(self):
        """A mark only makes sense where someone is assigned to teach that subject
        to that class in that term (BR-05)."""
        for rec in self:
            taught = self.env['school.teacher.assignment'].search_count([
                ('subject_id', '=', rec.subject_id.id),
                ('class_id', '=', rec.class_id.id),
                ('term_id', '=', rec.term_id.id),
            ])
            if not taught:
                raise ValidationError(
                    f'{rec.subject_id.name} is not assigned to any teacher for '
                    f'{rec.class_id.display_name} in {rec.term_id.name}.'
                )

    @api.onchange('assessment_id')
    def _onchange_assessment_id(self):
        if self.assessment_id:
            self.subject_id = self.assessment_id.subject_id
            self.term_id = self.assessment_id.term_id
            self.exam_type = self.assessment_id.assessment_type
            self.max_score = self.assessment_id.max_mark

    @api.model_create_multi
    def create(self, vals_list):
        for vals in vals_list:
            assessment = self.env['school.assessment'].browse(vals.get('assessment_id'))
            if assessment and assessment.state not in ('draft', 'open'):
                raise ValidationError(
                    'Mark list rows can only be added while the assessment is open.')
            if assessment:
                vals.setdefault('subject_id', assessment.subject_id.id)
                vals.setdefault('term_id', assessment.term_id.id)
                vals.setdefault('exam_type', assessment.assessment_type)
                vals.setdefault('max_score', assessment.max_mark)
                vals['class_id'] = assessment.class_id.id
                if not vals.get('student_subject_id'):
                    subject_enrollment = self.env['school.student.subject'].search([
                        ('student_id', '=', vals['student_id']),
                        ('class_id', '=', assessment.class_id.id),
                        ('subject_id', '=', assessment.subject_id.id),
                        ('state', '=', 'enrolled'),
                    ], limit=1)
                    if subject_enrollment:
                        vals['student_subject_id'] = subject_enrollment.id
            elif not vals.get('class_id'):
                student = self.env['school.student'].browse(vals['student_id'])
                vals['class_id'] = student.class_id.id
        return super().create(vals_list)

    def write(self, vals):
        if ENTRY_FIELDS & vals.keys():
            locked = self.filtered(
                lambda m: m.assessment_id.state not in ('draft', 'open'))
            if locked:
                raise ValidationError(
                    'Marks can only be edited while their assessment is open. '
                    'Use the unlock workflow (BR-11).')
            if 'score' in vals and 'mark_status' not in vals:
                pending = self.filtered(lambda m: m.mark_status == 'pending')
                if pending:
                    super(SchoolMark, pending).write(dict(vals, mark_status='recorded'))
                    return super(SchoolMark, self - pending).write(vals)
        return super().write(vals)

    def unlink(self):
        if any(m.assessment_id.state not in ('draft', 'open') for m in self):
            raise ValidationError(
                'Mark list rows cannot be deleted once the assessment is submitted.')
        return super().unlink()
