from odoo import api, fields, models
from odoo.exceptions import ValidationError


class SchoolGradeSubject(models.Model):
    """What a class studies (SRS §7.2): the curriculum row that student
    subject enrollments are derived from — nobody hand-builds subject rosters.
    """
    # ponytail: keyed on school.class (grade+section+year), like every other
    # model here. Sections of the same grade repeat the config; introduce a
    # grade entity if that ever hurts.
    _name = 'school.grade.subject'
    _description = 'Class Subject (Curriculum)'
    _order = 'class_id, subject_id'

    class_id = fields.Many2one(
        'school.class', string='Grade / Class', required=True, index=True,
        ondelete='cascade',
    )
    grade_id = fields.Many2one(
        related='class_id.grade_id', store=True, index=True)
    class_grade_level = fields.Selection(
        related='class_id.grade_id.level', string='Grade Level', readonly=True,
    )
    stream_id = fields.Many2one('school.stream', ondelete='restrict')
    subject_id = fields.Many2one(
        'school.subject', string='Subject', required=True, index=True,
        ondelete='restrict',
    )
    academic_year_id = fields.Many2one(
        related='class_id.academic_year_id', string='Academic Year', store=True,
    )
    subject_type = fields.Selection([
        ('compulsory', 'Compulsory'),
        ('optional', 'Optional'),
        ('stream', 'Stream'),
        ('elective', 'Elective'),
        ('non_graded', 'Non-Graded'),
    ], string='Type', required=True, default='compulsory')
    grading_policy_id = fields.Many2one(
        'school.grading.policy', string='Grading Policy', ondelete='restrict',
        help='Optional subject-specific grading policy. The default policy is used when empty.',
    )
    maximum_mark = fields.Float(default=100.0, required=True)
    pass_mark = fields.Float(default=50.0, required=True)
    optional_selection_limit = fields.Integer(default=0)
    active = fields.Boolean(string='Active', default=True)

    _class_subject_unique = models.Constraint(
        'unique(class_id, subject_id)',
        'This subject is already on the curriculum of this class.',
    )
    _grade_subject_marks_valid = models.Constraint(
        'CHECK(maximum_mark > 0 AND pass_mark >= 0 AND pass_mark <= maximum_mark)',
        'Pass mark must be between zero and the maximum mark.',
    )

    @api.constrains('class_id', 'stream_id')
    def _check_stream_grade(self):
        for rec in self.filtered('stream_id'):
            if not rec.class_id.grade_id \
                    or rec.class_id.grade_id.level not in ('11', '12'):
                raise ValidationError(
                    'Stream-specific curriculum is only available for Grades 11 and 12.')
            if rec.class_id.stream_id and rec.stream_id != rec.class_id.stream_id:
                raise ValidationError(
                    'The curriculum stream must match the selected class stream.')

    def name_get(self):
        return [(rec.id, '%s — %s' % (rec.class_id.display_name, rec.subject_id.name))
                for rec in self]

    @api.model_create_multi
    def create(self, vals_list):
        self._check_matches_context_class(vals_list)
        records = super().create(vals_list)
        records._backfill_active_enrollments()
        return records

    @api.model
    def _check_matches_context_class(self, vals_list):
        expected_id = self.env.context.get('default_class_id')
        if not expected_id:
            return
        for vals in vals_list:
            chosen_id = vals.get('class_id')
            if chosen_id and chosen_id != expected_id:
                expected, chosen = self.env['school.class'].browse([expected_id, chosen_id])
                raise ValidationError(
                    'You are adding this subject under %s but picked %s. Add it under '
                    '%s instead, or open %s and use its Subjects tab.'
                    % (expected.display_name, chosen.display_name,
                       chosen.display_name, chosen.display_name)
                )

    def write(self, vals):
        res = super().write(vals)
        if {'subject_type', 'active', 'class_id'} & vals.keys():
            self._backfill_active_enrollments()
        return res

    def _backfill_active_enrollments(self):
        """A compulsory subject added mid-year reaches students already
        enrolled — curriculum drives rosters, not the other way around."""
        for rec in self.filtered(lambda r: r.active and r.subject_type == 'compulsory'):
            self.env['school.enrollment'].search([
                ('class_id', '=', rec.class_id.id),
                ('state', '=', 'active'),
            ])._derive_subject_enrollments()