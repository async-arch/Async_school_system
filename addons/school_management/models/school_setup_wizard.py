from datetime import timedelta

from odoo import api, fields, models
from odoo.exceptions import ValidationError


class SchoolClassSubjectWizard(models.TransientModel):
    _name = 'school.class.subject.wizard'
    _description = 'Set Class Subjects'

    class_id = fields.Many2one(
        'school.class', string='Grade / Class', required=True, ondelete='cascade',
        default=lambda self: self.env.context.get('active_id'),
    )
    subject_ids = fields.Many2many('school.subject', string='Subjects')
    subject_type = fields.Selection([
        ('compulsory', 'Compulsory'),
        ('optional', 'Optional'),
        ('stream', 'Stream'),
        ('elective', 'Elective'),
        ('non_graded', 'Non-Graded'),
    ], string='Type', required=True, default='compulsory')
    maximum_mark = fields.Float(string='Maximum Mark', required=True, default=100.0)
    pass_mark = fields.Float(string='Pass Mark', required=True, default=50.0)

    @api.model
    def default_get(self, fields_list):
        values = super().default_get(fields_list)
        class_id = values.get('class_id') or self.env.context.get('active_id')
        if class_id and 'subject_ids' in fields_list:
            existing = self.env['school.grade.subject'].search([
                ('class_id', '=', class_id), ('active', '=', True),
            ])
            values['subject_ids'] = [(6, 0, existing.subject_id.ids)]
        return values

    def action_apply(self):
        self.ensure_one()
        Curriculum = self.env['school.grade.subject']
        rows = Curriculum.with_context(active_test=False).search([
            ('class_id', '=', self.class_id.id),
        ])
        keep = rows.filtered(lambda row: row.subject_id in self.subject_ids)
        keep.filtered(lambda row: not row.active).write({'active': True})
        rows.filtered(lambda row: row.subject_id not in self.subject_ids).write({'active': False})
        for subject in self.subject_ids - keep.subject_id:
            Curriculum.create({
                'class_id': self.class_id.id,
                'subject_id': subject.id,
                'subject_type': self.subject_type,
                'maximum_mark': self.maximum_mark,
                'pass_mark': self.pass_mark,
            })
        return {
            'type': 'ir.actions.act_window',
            'name': '%s - Curriculum' % self.class_id.name,
            'res_model': 'school.grade.subject',
            'view_mode': 'list,form',
            'domain': [('class_id', '=', self.class_id.id)],
            'context': {'default_class_id': self.class_id.id},
        }


class SchoolGradeSectionWizard(models.TransientModel):
    _name = 'school.grade.section.wizard'
    _description = 'Add Sections to a Grade'

    grade_id = fields.Many2one(
        'school.grade', string='Grade', required=True, ondelete='cascade',
        default=lambda self: self.env.context.get('active_id'),
    )
    academic_year_id = fields.Many2one(
        'school.academic.year', string='Academic Year', required=True,
        default=lambda self: self.env['school.academic.year']._default_year(),
    )
    section_ids = fields.Many2many('school.section', string='Sections')
    new_section_names = fields.Char(
        string='New Sections',
        help='Comma separated names to create on the fly. For example C, D.',
    )
    existing_class_ids = fields.Many2many(
        'school.class', string='Already Exists', compute='_compute_existing_class_ids')

    @api.depends('grade_id', 'academic_year_id')
    def _compute_existing_class_ids(self):
        for wizard in self:
            wizard.existing_class_ids = self.env['school.class'].search([
                ('grade_id', '=', wizard.grade_id.id),
                ('academic_year_id', '=', wizard.academic_year_id.id),
            ])

    @api.model
    def default_get(self, fields_list):
        values = super().default_get(fields_list)
        grade_id = values.get('grade_id') or self.env.context.get('active_id')
        year_id = values.get('academic_year_id')
        if grade_id and year_id and 'section_ids' in fields_list:
            existing = self.env['school.class'].search([
                ('grade_id', '=', grade_id), ('academic_year_id', '=', year_id),
            ])
            values['section_ids'] = [(6, 0, existing.section_id.ids)]
        return values

    def action_confirm(self):
        self.ensure_one()
        names = [name.strip() for name in (self.new_section_names or '').split(',')]
        names = self.section_ids.mapped('name') + [name for name in names if name]
        if not names:
            raise ValidationError('Pick at least one section, or type a new one.')
        classes = self.env['school.class']._ensure_sections(
            self.grade_id, self.academic_year_id, names)
        return {
            'type': 'ir.actions.act_window',
            'name': '%s - Sections' % self.grade_id.name,
            'res_model': 'school.class',
            'view_mode': 'list,form',
            'domain': [('id', 'in', classes.ids)],
            'context': {'create': False},
        }


class SchoolSetupWizard(models.TransientModel):
    _name = 'school.setup.wizard'
    _description = 'School Setup'

    year_name = fields.Char(string='Academic Year', required=True, help='For example 2026/2027.')
    date_start = fields.Date(string='Starts On', required=True)
    date_end = fields.Date(string='Ends On', required=True)
    is_current = fields.Boolean(string='Make Current', default=True)
    term_count = fields.Selection([
        ('1', 'One term'), ('2', 'Two semesters'), ('3', 'Three terms'), ('4', 'Four quarters'),
    ], string='Terms', required=True, default='3')
    grade_ids = fields.Many2many(
        'school.grade', string='Grades', required=True,
        default=lambda self: self.env['school.grade'].search([('active', '=', True)]),
    )
    section_names = fields.Char(
        string='Sections', default='A',
        help='Comma separated, one class per grade and section. For example A, B.',
    )

    @api.constrains('date_start', 'date_end')
    def _check_dates(self):
        for rec in self:
            if rec.date_end <= rec.date_start:
                raise ValidationError('The academic year must end after it starts.')

    def _sections(self):
        names = [name.strip() for name in (self.section_names or '').split(',')]
        return [name for name in names if name] or ['']

    def _prepare_terms(self, year):
        count = int(self.term_count)
        span = (self.date_end - self.date_start).days // count
        labels = {'1': 'Term', '2': 'Semester', '3': 'Term', '4': 'Quarter'}
        terms = []
        for index in range(count):
            start = self.date_start + timedelta(days=span * index)
            end = (self.date_start + timedelta(days=span * (index + 1) - 1)
                   if index < count - 1 else self.date_end)
            terms.append({
                'name': '%s %d' % (labels[self.term_count], index + 1),
                'academic_year_id': year.id,
                'date_start': start,
                'date_end': end,
                'sequence': (index + 1) * 10,
            })
        return terms

    def action_apply(self):
        self.ensure_one()
        Year = self.env['school.academic.year']
        year = Year.search([('name', '=', self.year_name)], limit=1)
        if year:
            year.write({'date_start': self.date_start, 'date_end': self.date_end})
        else:
            year = Year.create({
                'name': self.year_name,
                'date_start': self.date_start,
                'date_end': self.date_end,
                'state': 'open',
            })
        if self.is_current and not year.is_current:
            Year.search([('is_current', '=', True)]).write({'is_current': False})
            year.is_current = True

        Term = self.env['school.term']
        for values in self._prepare_terms(year):
            if not Term.search_count([
                    ('academic_year_id', '=', year.id), ('name', '=', values['name'])]):
                Term.create(values)

        classes = self.env['school.class'].browse()
        for grade in self.grade_ids:
            classes |= self.env['school.class']._ensure_sections(
                grade, year, self._sections())
        return {
            'type': 'ir.actions.act_window',
            'name': '%s - Classes' % year.name,
            'res_model': 'school.class',
            'view_mode': 'list,form',
            'domain': [('id', 'in', classes.ids)],
            'context': {'create': False},
        }
