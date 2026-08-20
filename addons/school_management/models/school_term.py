from odoo import api, fields, models
from odoo.exceptions import ValidationError


class SchoolTerm(models.Model):
    _name = 'school.term'
    _description = 'Academic Term'
    # Dependent models order on term_id and resolve through this, so keep it the
    # natural teaching order rather than alphabetical.
    _order = 'sequence, name'

    name = fields.Char(string='Term', required=True)
    academic_year_id = fields.Many2one(
        'school.academic.year', required=True, ondelete='cascade', index=True,
        default=lambda self: self.env['school.academic.year']._default_year(),
    )
    date_start = fields.Date(required=True)
    date_end = fields.Date(required=True)
    sequence = fields.Integer(string='Sequence', default=10)
    start_date = fields.Date(string='Start Date')
    end_date = fields.Date(string='End Date')
    active = fields.Boolean(string='Active', default=True)

    _name_year_unique = models.Constraint(
        'unique(name, academic_year_id)',
        'That term already exists in this academic year.',
    )
    _term_date_order = models.Constraint(
        'CHECK(date_end >= date_start)',
        'The term end date must not be before its start date.',
    )

    @api.constrains('academic_year_id', 'date_start', 'date_end')
    def _check_within_academic_year(self):
        for rec in self:
            year = rec.academic_year_id
            if year.date_start and rec.date_start < year.date_start:
                raise ValidationError('The term cannot start before its academic year.')
            if year.date_end and rec.date_end > year.date_end:
                raise ValidationError('The term cannot end after its academic year.')

    @api.constrains('start_date', 'end_date')
    def _check_dates(self):
        for rec in self:
            if rec.start_date and rec.end_date and rec.end_date < rec.start_date:
                raise ValidationError('Term end date cannot be before its start date.')


class SchoolSection(models.Model):
    _name = 'school.section'
    _description = 'Class Section'
    _order = 'sequence, name'

    name = fields.Char(string='Section', required=True, help='For example A, B, or C.')
    sequence = fields.Integer(string='Sequence', default=10)
    active = fields.Boolean(string='Active', default=True)
    class_ids = fields.One2many('school.class', 'section_id', string='Classes')
    class_count = fields.Integer(string='Classes', compute='_compute_class_count')

    @api.depends('class_ids')
    def _compute_class_count(self):
        for rec in self:
            rec.class_count = len(rec.class_ids)

    def action_open_classes(self):
        self.ensure_one()
        return {
            'type': 'ir.actions.act_window',
            'name': 'Section %s - Classes' % self.name,
            'res_model': 'school.class',
            'view_mode': 'list,form',
            'domain': [('section_id', '=', self.id)],
            'context': {'create': False},
        }

    _name_unique = models.Constraint(
        'unique(name)',
        'That section already exists.',
    )
