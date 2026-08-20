import re

from odoo import api, fields, models
from odoo.exceptions import ValidationError


EMAIL_REGEX = re.compile(r'^[^@\s]+@[^@\s]+\.[^@\s]+$')
# At least 8 chars, one uppercase, one lowercase, one digit, one special character.
PASSWORD_REGEX = re.compile(r'^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^\w\s]).{8,}$')


class ResUsers(models.Model):
    _inherit = 'res.users'

    school_staff_ids = fields.One2many(
        'school.staff', 'user_id', string='School Staff Records',
    )
    school_teacher_id = fields.Many2one(
        'school.teacher', string='Teacher Profile', compute='_compute_school_scope', compute_sudo=True,
    )
    school_department = fields.Char(
        string='School Department', compute='_compute_school_scope', compute_sudo=True,
    )
    school_taught_class_ids = fields.Many2many(
        'school.class', string='Taught Classes', compute='_compute_school_scope', compute_sudo=True,
    )
    school_taught_subject_ids = fields.Many2many(
        'school.subject', string='Taught Subjects', compute='_compute_school_scope', compute_sudo=True,
    )
    school_campus_ids = fields.Many2many(
        'school.campus', string='Branches / Campuses', compute='_compute_school_scope', compute_sudo=True,
    )
    school_responsibility_list = fields.Json(
        string='School Responsibilities', compute='_compute_school_scope', compute_sudo=True,
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
            assignments = teacher.assignment_ids.filtered(
                lambda assignment: assignment.active and assignment.state == 'active'
            )
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

    def _check_strong_password(self, password):
        if not password:
            return
        if not PASSWORD_REGEX.match(password):
            raise ValidationError(
                'Password must be at least 8 characters long and include an uppercase '
                'letter, a lowercase letter, a number, and a special character.'
            )

    def _check_valid_email_format(self, email):
        if email and not EMAIL_REGEX.match(email):
            raise ValidationError('"%s" is not a valid email address.' % email)

    @api.model_create_multi
    def create(self, vals_list):
        for vals in vals_list:
            self._check_strong_password(vals.get('password'))
            self._check_valid_email_format(vals.get('email'))
        return super().create(vals_list)

    def write(self, vals):
        self._check_strong_password(vals.get('password'))
        if 'email' in vals:
            self._check_valid_email_format(vals.get('email'))
        return super().write(vals)