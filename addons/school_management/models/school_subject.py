from odoo import fields, models


class SchoolSubject(models.Model):
    _name = 'school.subject'
    _description = 'School Subject'
    _order = 'name'

    name = fields.Char(string='Subject Name', required=True)
    code = fields.Char(string='Subject Code')
    short_name = fields.Char()
    subject_type = fields.Selection([
        ('compulsory', 'Compulsory'), ('optional', 'Optional'),
        ('stream', 'Stream'), ('elective', 'Elective'), ('non_graded', 'Non-Graded'),
    ], default='compulsory', required=True)
    active = fields.Boolean(string='Active', default=True)
    grade_subject_ids = fields.One2many(
        'school.grade.subject', 'subject_id', string='Curriculum Offerings')

    _subject_name_unique = models.Constraint(
        'unique(name)',
        'A subject with that name already exists.',
    )
