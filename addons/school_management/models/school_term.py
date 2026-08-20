from odoo import api, fields, models
from odoo.exceptions import ValidationError


class SchoolTerm(models.Model):
    _name = 'school.term'
    _description = 'Academic Term'
    # Dependent models order on term_id and resolve through this, so keep it the
    # natural teaching order rather than alphabetical.
    _order = 'sequence, name'

    name = fields.Char(string='Term', required=True)
    sequence = fields.Integer(string='Sequence', default=10)
    start_date = fields.Date(string='Start Date')
    end_date = fields.Date(string='End Date')
    active = fields.Boolean(string='Active', default=True)

    _sql_constraints = [
        ('name_unique', 'unique(name)', 'That term already exists.'),
    ]

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

    _sql_constraints = [
        ('name_unique', 'unique(name)', 'That section already exists.'),
    ]
