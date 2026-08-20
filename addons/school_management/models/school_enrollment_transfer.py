from odoo import fields, models
from odoo.exceptions import ValidationError


class SchoolEnrollmentTransfer(models.TransientModel):
    """Section transfer creates a new effective placement inside the same
    yearly enrollment, preserving the one-enrollment-per-year invariant."""
    _name = 'school.enrollment.transfer'
    _description = 'Section Transfer'

    enrollment_id = fields.Many2one(
        'school.enrollment', string='Current Enrollment', required=True,
        domain=[('state', '=', 'active')],
    )
    new_class_id = fields.Many2one(
        'school.class', string='New Grade / Class', required=True,
        domain="[('academic_year_id', '=', academic_year_id), ('active', '=', True)]",
    )
    academic_year_id = fields.Many2one(
        related='enrollment_id.academic_year_id', readonly=True)
    effective_date = fields.Date(
        string='Effective Date', required=True,
        default=lambda self: fields.Date.context_today(self),
    )
    reason = fields.Text(required=True)

    def action_confirm(self):
        self.ensure_one()
        old = self.enrollment_id
        if old.state != 'active':
            raise ValidationError('Only active enrollments can be transferred.')
        if self.new_class_id == old.class_id:
            raise ValidationError('The student is already in %s.'
                                  % old.class_id.display_name)
        if self.effective_date < old.enrollment_date:
            raise ValidationError('The transfer cannot take effect before the '
                                  'current enrollment started (%s).'
                                  % old.enrollment_date)
        if self.new_class_id.academic_year_id != old.academic_year_id:
            raise ValidationError('Section transfers must remain in the same academic year.')
        capacity = self.new_class_id.capacity
        if capacity:
            taken = self.env['school.enrollment.placement'].search_count([
                ('class_id', '=', self.new_class_id.id),
                ('date_start', '<=', self.effective_date),
                '|', ('date_end', '=', False), ('date_end', '>=', self.effective_date),
            ])
            authorized = old.override_ids.filtered(
                lambda override: override.active and override.operation == 'capacity')
            if taken >= capacity and not authorized:
                raise ValidationError(
                    '%s is full on the transfer date.' % self.new_class_id.display_name)
        previous = old.placement_ids.filtered(lambda p: not p.date_end)
        if previous and self.effective_date < previous.date_start:
            raise ValidationError(
                'The transfer cannot take effect before the current placement in '
                '%s started (%s).' % (previous.class_id.display_name, previous.date_start))
        last_placement = self.env['school.enrollment.placement'].search([
            ('class_id', '=', self.new_class_id.id),
        ], order='roll_number desc', limit=1)
        roll = (last_placement.roll_number or 0) + 1
        values = {
            'class_id': self.new_class_id.id,
            'shift_id': self.new_class_id.shift_id.id,
            'stream_id': self.new_class_id.stream_id.id,
            'roll_number': roll,
            'transfer_reason': self.reason,
        }
        if previous and self.effective_date == previous.date_start:
            # Same-day move: the student never attended the old class, so correct
            # the placement instead of leaving a zero-length one behind.
            previous.write(values)
        else:
            if previous:
                previous.write({
                    'date_end': fields.Date.subtract(self.effective_date, days=1)})
            self.env['school.enrollment.placement'].create(
                dict(values, enrollment_id=old.id, date_start=self.effective_date))
        old.invalidate_recordset(['placement_ids'])
        old.with_context(placement_effective_date=fields.Date.subtract(
            self.effective_date, days=1)).write({
                'class_id': self.new_class_id.id, 'roll_number': roll})
        old._derive_subject_enrollments()
        return {
            'type': 'ir.actions.act_window',
            'res_model': 'school.enrollment',
            'view_mode': 'form',
            'res_id': old.id,
        }
