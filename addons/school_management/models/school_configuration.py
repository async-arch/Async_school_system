from odoo import api, fields, models
from odoo.exceptions import ValidationError


GRADE_LEVELS = [(str(level), 'Grade %s' % level) for level in range(1, 13)]


class SchoolGrade(models.Model):
    _name = 'school.grade'
    _description = 'Grade'
    _order = 'sequence, name'

    name = fields.Char(required=True, translate=True)
    code = fields.Char(required=True)
    level = fields.Selection(GRADE_LEVELS, required=True)
    sequence = fields.Integer(default=10)
    active = fields.Boolean(default=True)

    _school_grade_code_unique = models.Constraint(
        'unique(code)',
        'The grade code must be unique.',
    )
    _school_grade_level_unique = models.Constraint(
        'unique(level)',
        'The grade level must be unique.',
    )

    @api.model
    def ensure_standard_academic_structure(self):
        """Idempotently seed grades/streams and repair legacy class links."""
        xmlids = self.env['ir.model.data'].sudo()
        grades = {}
        for level in range(1, 13):
            key = str(level)
            grade = self.search([('level', '=', key)], limit=1)
            if not grade:
                grade = self.create({
                    'name': 'Grade %s' % level, 'code': 'G%s' % level,
                    'level': key, 'sequence': level * 10,
                })
            grades[key] = grade
            xmlid_name = 'grade_%s' % level
            if not self.env.ref('school_management.%s' % xmlid_name,
                                raise_if_not_found=False):
                xmlids.create({
                    'module': 'school_management', 'name': xmlid_name,
                    'model': 'school.grade', 'res_id': grade.id, 'noupdate': True,
                })

        Stream = self.env['school.stream']
        for xmlid_name, name, code, aliases in (
                ('stream_natural_science', 'Natural Science', 'NATURAL', ('nat', 'natural')),
                ('stream_social_science', 'Social Science', 'SOCIAL', ('soc', 'social'))):
            stream = Stream.search([('code', 'in', (code, *aliases))], limit=1)
            if not stream:
                stream = Stream.create({'name': name, 'code': code})
            else:
                stream.write({'name': name, 'code': code})
            if not self.env.ref('school_management.%s' % xmlid_name,
                                raise_if_not_found=False):
                xmlids.create({
                    'module': 'school_management', 'name': xmlid_name,
                    'model': 'school.stream', 'res_id': stream.id, 'noupdate': True,
                })

        Class = self.env['school.class']
        for level, grade in grades.items():
            Class.search([
                ('grade_id', '=', False), ('name', '=ilike', 'Grade %s' % level),
            ]).write({'grade_id': grade.id})

        invalid_classes = Class.search([
            ('stream_id', '!=', False),
            '|', ('grade_id', '=', False), ('grade_id.level', 'not in', ('11', '12')),
        ])
        if invalid_classes:
            self.env['school.student'].search([
                ('class_id', 'in', invalid_classes.ids),
            ]).write({'stream_id': False})
            self.env['school.grade.subject'].search([
                ('class_id', 'in', invalid_classes.ids),
            ]).write({'stream_id': False})
            self.env['school.enrollment.placement'].search([
                ('class_id', 'in', invalid_classes.ids),
            ]).write({'stream_id': False})
            invalid_classes.write({'stream_id': False})
        return True


class SchoolShift(models.Model):
    _name = 'school.shift'
    _description = 'School Shift'
    _order = 'sequence, name'

    name = fields.Char(required=True, translate=True)
    code = fields.Char(required=True)
    sequence = fields.Integer(default=10)
    time_start = fields.Float(string='Starts At')
    time_end = fields.Float(string='Ends At')
    active = fields.Boolean(default=True)

    _school_shift_code_unique = models.Constraint(
        'unique(code)',
        'The shift code must be unique.',
    )
    _school_shift_time_order = models.Constraint(
        'CHECK(time_end = 0 OR time_end > time_start)',
        'The shift end time must be after its start time.',
    )


class SchoolStream(models.Model):
    _name = 'school.stream'
    _description = 'Academic Stream'
    _order = 'sequence, name'

    name = fields.Char(required=True, translate=True)
    code = fields.Char(required=True)
    sequence = fields.Integer(default=10)
    active = fields.Boolean(default=True)

    _school_stream_code_unique = models.Constraint(
        'unique(code)',
        'The stream code must be unique.',
    )


class ResCompany(models.Model):
    _inherit = 'res.company'

    school_timezone = fields.Selection(
        selection=lambda self: self._tz_get(), default='Africa/Addis_Ababa', required=True,
        string='School Timezone',
    )
    school_subject_attendance = fields.Boolean(string='Enable Subject Attendance')
    school_ranking = fields.Boolean(string='Enable Student Ranking')
    school_approval_required = fields.Boolean(default=True)
    school_capacity_override = fields.Boolean(string='Allow Capacity Overrides')
    school_grading_configured = fields.Boolean(string='Grading Policy Configured')

    @api.model
    def _tz_get(self):
        return self.env['res.users']._fields['tz'].selection(self.env['res.users'])


class ResConfigSettings(models.TransientModel):
    _inherit = 'res.config.settings'

    school_timezone = fields.Selection(related='company_id.school_timezone', readonly=False)
    school_subject_attendance = fields.Boolean(
        related='company_id.school_subject_attendance', readonly=False)
    school_ranking = fields.Boolean(related='company_id.school_ranking', readonly=False)
    school_approval_required = fields.Boolean(
        related='company_id.school_approval_required', readonly=False)
    school_capacity_override = fields.Boolean(
        related='company_id.school_capacity_override', readonly=False)
    school_grading_configured = fields.Boolean(
        related='company_id.school_grading_configured', readonly=False)
    school_grading_scheme_id = fields.Many2one(
        related='company_id.school_grading_scheme_id', readonly=False)
    school_student_sequence_format = fields.Char(
        config_parameter='school_management.student_sequence_format',
        default='STU/%(year)s/',
    )
    school_staff_sequence_format = fields.Char(
        config_parameter='school_management.staff_sequence_format',
        default='STF/%(year)s/',
    )


class SchoolRegistrationQuestion(models.Model):
    _name = 'school.registration.question'
    _description = 'Registration Question'
    _order = 'sequence, id'

    name = fields.Char(string='Question', required=True, translate=True)
    code = fields.Char(required=True)
    sequence = fields.Integer(default=10)
    answer_type = fields.Selection([
        ('text', 'Text'), ('boolean', 'Yes / No'), ('selection', 'Selection'),
        ('date', 'Date'), ('integer', 'Number'),
    ], required=True, default='text')
    option_ids = fields.One2many(
        'school.registration.question.option', 'question_id', string='Options')
    grade_from = fields.Integer(default=1)
    grade_to = fields.Integer(default=12)
    admission_type = fields.Selection([
        ('all', 'All'), ('new', 'New'), ('transfer', 'Transfer'),
        ('returning', 'Returning'), ('readmitted', 'Re-admitted'),
    ], default='all', required=True)
    stream_id = fields.Many2one('school.stream', ondelete='restrict')
    support_need_only = fields.Boolean()
    required = fields.Boolean()
    active = fields.Boolean(default=True)

    _school_registration_question_code_unique = models.Constraint(
        'unique(code)',
        'Question codes must be unique.',
    )
    _school_registration_question_grade_range = models.Constraint(
        'CHECK(grade_from >= 1 AND grade_to <= 12 AND grade_from <= grade_to)',
        'Question grade ranges must be between Grade 1 and Grade 12.',
    )


class SchoolRegistrationQuestionOption(models.Model):
    _name = 'school.registration.question.option'
    _description = 'Registration Question Option'
    _order = 'sequence, name'

    question_id = fields.Many2one(
        'school.registration.question', required=True, ondelete='cascade')
    name = fields.Char(required=True, translate=True)
    value = fields.Char(required=True)
    sequence = fields.Integer(default=10)


class SchoolRegistrationAnswer(models.Model):
    _name = 'school.registration.answer'
    _description = 'Registration Answer'
    _order = 'question_id'

    student_id = fields.Many2one('school.student', required=True, ondelete='cascade', index=True)
    question_id = fields.Many2one(
        'school.registration.question', required=True, ondelete='restrict')
    value_text = fields.Text(string='Answer')
    option_id = fields.Many2one(
        'school.registration.question.option', ondelete='restrict')

    _school_registration_answer_unique = models.Constraint(
        'unique(student_id, question_id)',
        'A registration question may only be answered once.',
    )

    @api.constrains('question_id', 'option_id')
    def _check_option_question(self):
        for rec in self:
            if rec.option_id and rec.option_id.question_id != rec.question_id:
                raise ValidationError('The selected answer does not belong to this question.')
