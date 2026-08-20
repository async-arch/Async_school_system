from odoo import api, fields, models
from odoo.exceptions import ValidationError


class SchoolStudentGuardian(models.Model):
    """Links a student to a guardian contact (SRS §5.3, §17.2).

    The contact itself is a res.partner so one parent can serve several
    students and later gets portal access without a data rework. The
    student's guardian_name/guardian_phone chars stay as the registration
    intake fields; the primary link here syncs back onto them so existing
    views and reports keep reading the truth.
    """
    _name = 'school.student.guardian'
    _description = 'Student Guardian Link'
    _order = 'is_primary desc, id'

    student_id = fields.Many2one(
        'school.student', string='Student', required=True, index=True,
        ondelete='cascade',
    )
    partner_id = fields.Many2one(
        'res.partner', string='Contact', required=True, ondelete='restrict',
    )
    relationship = fields.Selection([
        ('father', 'Father'),
        ('mother', 'Mother'),
        ('guardian', 'Guardian'),
        ('other', 'Other'),
    ], string='Relationship', required=True, default='guardian')
    is_primary = fields.Boolean(string='Primary Contact')
    name = fields.Char(related='partner_id.name', string='Name')
    phone = fields.Char(related='partner_id.phone', string='Phone')

    _student_partner_unique = models.Constraint(
        'unique(student_id, partner_id)',
        'This contact is already linked to the student.',
    )

    @api.constrains('is_primary', 'student_id')
    def _check_single_primary(self):
        for rec in self.filtered('is_primary'):
            clash = self.search([
                ('id', '!=', rec.id),
                ('student_id', '=', rec.student_id.id),
                ('is_primary', '=', True),
            ], limit=1)
            if clash:
                raise ValidationError(
                    '%s already has %s as primary contact. Clear it there first.'
                    % (rec.student_id.name, clash.partner_id.name)
                )

    @api.model_create_multi
    def create(self, vals_list):
        records = super().create(vals_list)
        records._sync_primary_to_student()
        return records

    def write(self, vals):
        res = super().write(vals)
        if {'is_primary', 'partner_id'} & vals.keys():
            self._sync_primary_to_student()
        return res

    def _sync_primary_to_student(self):
        """Mirror the primary contact onto the student's intake chars so the
        pre-guardian views, domains, and reports stay correct."""
        # ponytail: edits made directly on the partner do not sync back;
        # override res.partner.write if that ever bites.
        for rec in self.filtered('is_primary'):
            student = rec.student_id
            values = {}
            if rec.partner_id.name != student.guardian_name:
                values['guardian_name'] = rec.partner_id.name
            if rec.partner_id.phone and rec.partner_id.phone != student.guardian_phone:
                values['guardian_phone'] = rec.partner_id.phone
            if values:
                student.write(values)
