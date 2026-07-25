from odoo import api, fields, models


class SchoolClass(models.Model):
    _name = 'school.class'
    _description = 'School Grade / Class'
    _order = 'name, section, academic_year'

    name = fields.Char(string='Grade / Class', required=True)
    section = fields.Char(string='Section')
    academic_year = fields.Char(string='Academic Year', required=True)
    student_ids = fields.One2many('school.student', 'class_id', string='Students')

    education_level = fields.Selection([
        ('kindergarten', 'Kindergarten'),
        ('primary', 'Primary'),
        ('secondary', 'Secondary'),
        ('high_school', 'High School'),
    ], string='Education Level')

    is_entry_level = fields.Boolean(
        string='Entry Level (no previous school expected)',
        help='Check this for the very first class a student can join (e.g. KG1). '
             'Students in this class will not be required to upload a previous-grade document.'
    )

    min_age = fields.Integer(string='Minimum Age')
    max_age = fields.Integer(string='Maximum Age')

    _sql_constraints = [
        ('class_section_year_unique', 'unique(name, section, academic_year)',
         'This class/section already exists for this academic year.'),
        ('age_range_valid', 'CHECK(min_age <= max_age OR min_age = 0 OR max_age = 0)',
         'Minimum age cannot be greater than maximum age.'),
    ]