from odoo import api, fields, models


class ResUsers(models.Model):
    _inherit = 'res.users'

    school_staff_ids = fields.One2many(
        'school.staff', 'user_id', string='School Staff Records',
    )
    school_teacher_id = fields.Many2one(
        'school.teacher', string='Teacher Profile', compute='_compute_school_scope',
    )
    school_department = fields.Char(
        string='School Department', compute='_compute_school_scope',
    )
    school_taught_class_ids = fields.Many2many(
        'school.class', string='Taught Classes', compute='_compute_school_scope',
    )
    school_taught_subject_ids = fields.Many2many(
        'school.subject', string='Taught Subjects', compute='_compute_school_scope',
    )
    school_campus_ids = fields.Many2many(
        'school.campus', string='Branches / Campuses', compute='_compute_school_scope',
    )
    school_responsibility_list = fields.Json(
        string='School Responsibilities', compute='_compute_school_scope',
        help='Responsibility codes this user holds, from staff responsibility records '
             'and from active teaching assignments.',
    )

    @api.depends('school_staff_ids')
    def _compute_school_scope(self):
        """Flatten a user's school scope into plain fields so record-rule domains stay
        simple attribute lookups instead of method calls inside safe_eval."""
        for user in self:
            staff = user.school_staff_ids[:1]
            teacher = self.env['school.teacher'].search([('staff_id', 'in', staff.ids)], limit=1)
            assignments = teacher.assignment_ids
            responsibilities = staff.responsibility_ids.filtered('active')
            user.school_teacher_id = teacher
            user.school_department = staff.department or ''
            user.school_taught_class_ids = assignments.mapped('class_id')
            user.school_taught_subject_ids = assignments.mapped('subject_id')
            user.school_campus_ids = staff.campus_id | responsibilities.mapped('campus_id')
            # Non-teaching staff hold responsibilities only through staff records, so
            # both sources must feed the audience match.
            user.school_responsibility_list = sorted(set(
                assignments.mapped('responsibility') + responsibilities.mapped('responsibility')
            ))

    def _school_teacher_pair_domain(self):
        """Return the exact class/subject pairs assigned to this user."""
        self.ensure_one()
        assignments = self.env['school.teacher.assignment'].sudo().search([
            ('teacher_id.user_id', '=', self.id),
            ('active', '=', True),
        ])
        pairs = {(assignment.class_id.id, assignment.subject_id.id)
                 for assignment in assignments}
        if not pairs:
            return [('id', '=', 0)]
        domain = ['|'] * (len(pairs) - 1)
        for class_id, subject_id in sorted(pairs):
            domain += [
                '&', ('class_id', '=', class_id), ('subject_id', '=', subject_id),
            ]
        return domain
