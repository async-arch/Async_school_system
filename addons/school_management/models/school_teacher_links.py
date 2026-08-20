from odoo import fields, models


class SchoolTeacherLinks(models.Model):
    """Brief sections 5 and 10: the teacher record surfaces its own schedule,
    attendance, marks, and announcements instead of making the user go hunting."""
    _name = 'school.teacher'
    _inherit = ['school.teacher', 'mail.thread']

    schedule_count = fields.Integer(string='Class Periods', compute='_compute_link_counts')
    attendance_count = fields.Integer(string='Attendance Records', compute='_compute_link_counts')
    mark_count = fields.Integer(string='Marks', compute='_compute_link_counts')
    announcement_count = fields.Integer(string='Announcements', compute='_compute_link_counts')

    def _compute_link_counts(self):
        for rec in self:
            classes = rec.assignment_ids.mapped('class_id')
            subjects = rec.assignment_ids.mapped('subject_id')
            rec.schedule_count = self.env['school.class.schedule'].search_count([
                ('teacher_id', '=', rec.id),
            ])
            rec.attendance_count = self.env['school.attendance'].search_count([
                ('class_id', 'in', classes.ids),
            ]) if classes else 0
            rec.mark_count = self.env['school.mark'].search_count([
                ('class_id', 'in', classes.ids), ('subject_id', 'in', subjects.ids),
            ]) if classes and subjects else 0
            rec.announcement_count = self.env['school.announcement'].search_count([
                ('is_live', '=', True),
            ])

    def _open(self, name, model, domain, context=None):
        return {
            'type': 'ir.actions.act_window',
            'name': name,
            'res_model': model,
            'view_mode': 'list,form',
            'domain': domain,
            'context': context or {},
        }

    def action_open_schedule(self):
        self.ensure_one()
        return self._open(
            f'{self.name} - Timetable', 'school.class.schedule',
            [('teacher_id', '=', self.id)],
            {'default_teacher_id': self.id, 'group_by': ['day_of_week']},
        )

    def action_open_attendance(self):
        self.ensure_one()
        return self._open(
            f'{self.name} - Attendance', 'school.attendance',
            [('class_id', 'in', self.assignment_ids.mapped('class_id').ids)],
            {'search_default_group_class': 1},
        )

    def action_open_marks(self):
        self.ensure_one()
        return self._open(
            f'{self.name} - Marks', 'school.mark',
            [('class_id', 'in', self.assignment_ids.mapped('class_id').ids),
             ('subject_id', 'in', self.assignment_ids.mapped('subject_id').ids)],
            {'search_default_group_subject': 1},
        )

    def action_open_announcements(self):
        self.ensure_one()
        return self._open(
            'Announcements', 'school.announcement', [('is_live', '=', True)],
        )
