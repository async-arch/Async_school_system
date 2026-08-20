from odoo import api, fields, models


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
    ], string='Type', required=True, default='compulsory')
    grading_policy_id = fields.Many2one(
        'school.grading.policy', string='Grading Policy', ondelete='restrict',
        help='Optional subject-specific grading policy. The default policy is used when empty.',
    )
    active = fields.Boolean(string='Active', default=True)

    _sql_constraints = [
        ('class_subject_unique', 'unique(class_id, subject_id)',
         'This subject is already on the curriculum of this class.'),
    ]

    def name_get(self):
        return [(rec.id, '%s — %s' % (rec.class_id.display_name, rec.subject_id.name))
                for rec in self]

    @api.model_create_multi
    def create(self, vals_list):
        records = super().create(vals_list)
        records._backfill_active_enrollments()
        return records

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
