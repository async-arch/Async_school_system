from odoo import api, fields, models
from odoo.exceptions import ValidationError


APPROVED_ASSESSMENT_STATES = ('approved', 'locked', 'published')
RESULT_MARK_STATUSES = ('recorded', 'transfer', 'makeup')


class SchoolGradingPolicy(models.Model):
    _name = 'school.grading.policy'
    _description = 'Grading Policy'
    _order = 'name'

    name = fields.Char(string='Name', required=True)
    pass_percentage = fields.Float(string='Pass Percentage', required=True, default=50.0)
    band_ids = fields.One2many(
        'school.grading.band', 'policy_id', string='Grade Bands', copy=True,
    )
    active = fields.Boolean(string='Active', default=True)

    _sql_constraints = [
        ('pass_percentage_range', 'CHECK(pass_percentage >= 0 AND pass_percentage <= 100)',
         'Pass percentage must be between 0 and 100.'),
    ]

    @api.model
    def _default_policy(self):
        policy = self.env.ref(
            'school_management.grading_policy_default', raise_if_not_found=False,
        )
        if not policy:
            policy = self.search([('active', '=', True)], limit=1)
        if not policy:
            raise ValidationError('Configure an active grading policy before calculating results.')
        return policy

    def get_grade(self, percentage):
        self.ensure_one()
        band = self.band_ids.filtered(
            lambda item: item.active and item.minimum_percentage <= percentage
        ).sorted(key=lambda item: (item.minimum_percentage, item.sequence), reverse=True)[:1]
        return band.letter_grade if band else 'F'


class SchoolGradingBand(models.Model):
    _name = 'school.grading.band'
    _description = 'Grading Policy Band'
    _order = 'minimum_percentage desc, sequence, id'

    policy_id = fields.Many2one(
        'school.grading.policy', string='Grading Policy', required=True,
        ondelete='cascade', index=True,
    )
    sequence = fields.Integer(string='Sequence', default=10)
    minimum_percentage = fields.Float(string='Minimum Percentage', required=True)
    letter_grade = fields.Char(string='Letter Grade', required=True, size=3)
    label = fields.Char(string='Label')
    active = fields.Boolean(string='Active', default=True)

    _sql_constraints = [
        ('minimum_percentage_range',
         'CHECK(minimum_percentage >= 0 AND minimum_percentage <= 100)',
         'Minimum percentage must be between 0 and 100.'),
        ('policy_letter_unique', 'unique(policy_id, letter_grade)',
         'A grading policy cannot contain the same letter grade twice.'),
    ]


class SchoolSubjectResult(models.Model):
    _name = 'school.subject.result'
    _description = 'Weighted Subject Result'
    _order = 'academic_year_id, term_id, class_id, student_id, subject_id'

    student_id = fields.Many2one(
        'school.student', string='Student', required=True, ondelete='restrict', index=True,
    )
    enrollment_id = fields.Many2one(
        'school.enrollment', string='Enrollment', required=True, ondelete='restrict', index=True,
    )
    class_id = fields.Many2one(
        'school.class', string='Grade / Class', required=True, ondelete='restrict', index=True,
    )
    academic_year_id = fields.Many2one(
        related='class_id.academic_year_id', string='Academic Year', store=True, index=True,
    )
    subject_id = fields.Many2one(
        'school.subject', string='Subject', required=True, ondelete='restrict', index=True,
    )
    term_id = fields.Many2one(
        'school.term', string='Term', required=True, ondelete='restrict', index=True,
    )
    grading_policy_id = fields.Many2one(
        'school.grading.policy', string='Grading Policy', required=True, ondelete='restrict',
    )
    percentage = fields.Float(string='Weighted Percentage', digits=(16, 2), readonly=True)
    grade = fields.Char(string='Grade', readonly=True)
    passed = fields.Boolean(string='Passed', readonly=True)
    result_status = fields.Selection([
        ('incomplete', 'Incomplete'),
        ('pass', 'Pass'),
        ('fail', 'Fail'),
    ], string='Result Status', required=True, default='incomplete', readonly=True)
    weight_total = fields.Float(string='Contributing Weight', readonly=True)
    assessment_count = fields.Integer(string='Approved Assessments', readonly=True)
    generated_at = fields.Datetime(string='Calculated At', readonly=True)

    _sql_constraints = [
        ('student_enrollment_subject_term_unique',
         'unique(student_id, enrollment_id, subject_id, term_id)',
         'A student can have only one result per subject and term for an enrollment.'),
        ('class_matches_enrollment',
         'CHECK(class_id IS NOT NULL)',
         'A subject result must retain its historical class.'),
    ]

    @api.constrains('student_id', 'enrollment_id', 'class_id')
    def _check_enrollment_identity(self):
        for rec in self:
            if rec.enrollment_id.student_id != rec.student_id:
                raise ValidationError('The result student must match the enrollment student.')
            if rec.enrollment_id.class_id != rec.class_id:
                raise ValidationError('The result class must match the enrollment class.')

    @api.model
    def _policy_for(self, class_id, subject_id):
        Curriculum = self.env['school.grade.subject']
        domain = [('subject_id', '=', subject_id), ('active', '=', True)]
        if 'class_id' in Curriculum._fields:
            domain.append(('class_id', '=', class_id))
        elif 'grade_id' in Curriculum._fields:
            class_record = self.env['school.class'].browse(class_id)
            grade_id = getattr(class_record, 'grade_id', False)
            domain.append(('grade_id', '=', grade_id.id if grade_id else class_id))
        curriculum = Curriculum.search(domain, limit=1)
        return curriculum.grading_policy_id or self.env['school.grading.policy']._default_policy()

    @api.model
    def _calculate_values(self, student, enrollment, class_record, subject, term):
        policy = self._policy_for(class_record.id, subject.id)
        marks = self.env['school.mark'].search([
            ('student_id', '=', student.id),
            ('class_id', '=', class_record.id),
            ('subject_id', '=', subject.id),
            ('term_id', '=', term.id),
            ('assessment_id', '!=', False),
            ('assessment_id.state', 'in', APPROVED_ASSESSMENT_STATES),
            ('mark_status', 'in', RESULT_MARK_STATUSES),
        ])
        contributing = marks.filtered(
            lambda mark: mark.assessment_id.weight > 0 and mark.max_score > 0
        )
        total_weight = sum(contributing.mapped('assessment_id.weight'))
        if not contributing or not total_weight:
            return {
                'student_id': student.id,
                'enrollment_id': enrollment.id,
                'class_id': class_record.id,
                'subject_id': subject.id,
                'term_id': term.id,
                'grading_policy_id': policy.id,
                'percentage': 0.0,
                'grade': False,
                'passed': False,
                'result_status': 'incomplete',
                'weight_total': 0.0,
                'assessment_count': 0,
                'generated_at': fields.Datetime.now(),
            }
        percentage = sum(
            mark.percentage * mark.assessment_id.weight for mark in contributing
        ) / total_weight
        passed = percentage >= policy.pass_percentage
        return {
            'student_id': student.id,
            'enrollment_id': enrollment.id,
            'class_id': class_record.id,
            'subject_id': subject.id,
            'term_id': term.id,
            'grading_policy_id': policy.id,
            'percentage': percentage,
            'grade': policy.get_grade(percentage),
            'passed': passed,
            'result_status': 'pass' if passed else 'fail',
            'weight_total': total_weight,
            'assessment_count': len(contributing),
            'generated_at': fields.Datetime.now(),
        }

    @api.model
    def generate_for_subject(self, student, enrollment, class_record, subject, term):
        values = self._calculate_values(student, enrollment, class_record, subject, term)
        result = self.search([
            ('student_id', '=', student.id),
            ('enrollment_id', '=', enrollment.id),
            ('subject_id', '=', subject.id),
            ('term_id', '=', term.id),
        ], limit=1)
        if result:
            result.write(values)
            return result
        return self.create(values)

    def action_recalculate(self):
        for result in self:
            self.generate_for_subject(
                result.student_id, result.enrollment_id, result.class_id,
                result.subject_id, result.term_id,
            )
        return True
