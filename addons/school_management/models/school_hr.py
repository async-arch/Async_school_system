from odoo import api, fields, models
from odoo.exceptions import ValidationError


class SchoolStaffEmployment(models.Model):
    _name = 'school.staff.employment'
    _description = 'Effective-Dated Staff Employment'
    _inherit = ['mail.thread']
    _order = 'date_start desc, id desc'

    staff_id = fields.Many2one('school.staff', required=True, ondelete='restrict', index=True)
    employee_id = fields.Many2one(related='staff_id.employee_id', store=True, index=True)
    department = fields.Selection(related='staff_id.department', store=True)
    job_title_id = fields.Many2one('school.job.title', required=True, ondelete='restrict')
    responsibility = fields.Selection([
        ('teacher', 'Teacher'), ('homeroom', 'Homeroom Teacher'),
        ('department_head', 'Department Head'), ('coordinator', 'Academic Coordinator'),
        ('registrar', 'Registrar'), ('exam_officer', 'Examination Officer'),
        ('hr', 'HR Officer'), ('finance', 'Finance Officer'),
        ('frontoffice', 'Front Office'), ('support', 'Nurse / Support'),
    ], required=True)
    manager_id = fields.Many2one('school.staff', ondelete='restrict')
    campus_id = fields.Many2one('school.campus', ondelete='restrict')
    date_start = fields.Date(required=True)
    date_end = fields.Date()
    reason = fields.Text()

    _staff_employment_date_order = models.Constraint(
        'CHECK(date_end IS NULL OR date_end >= date_start)',
        'Employment end date cannot be before its start date.',
    )

    @api.constrains('staff_id', 'date_start', 'date_end', 'manager_id')
    def _check_employment(self):
        for rec in self:
            if rec.manager_id == rec.staff_id:
                raise ValidationError('A staff member cannot report to themselves.')
            overlap = self.search([
                ('id', '!=', rec.id), ('staff_id', '=', rec.staff_id.id),
                ('date_start', '<=', rec.date_end or fields.Date.to_date('9999-12-31')),
                '|', ('date_end', '=', False), ('date_end', '>=', rec.date_start),
            ], limit=1)
            if overlap:
                raise ValidationError('Employment periods for a staff member cannot overlap.')

    def unlink(self):
        raise ValidationError('Employment history cannot be deleted.')


class SchoolStaffDailyStatus(models.Model):
    _name = 'school.staff.daily.status'
    _description = 'Staff Daily Status'
    _order = 'date desc, staff_id'

    staff_id = fields.Many2one('school.staff', required=True, ondelete='restrict', index=True)
    employee_id = fields.Many2one(related='staff_id.employee_id', store=True, index=True)
    date = fields.Date(required=True, index=True)
    status = fields.Selection([
        ('present', 'Present'), ('absent', 'Absent'), ('late', 'Late'),
        ('annual_leave', 'Annual Leave'), ('sick_leave', 'Sick Leave'),
        ('official_duty', 'Official Duty'), ('training', 'Training'),
        ('half_day', 'Half Day'), ('not_recorded', 'Not Recorded'),
    ], required=True, default='not_recorded')
    check_in = fields.Datetime()
    check_out = fields.Datetime()
    worked_hours = fields.Float()
    attendance_id = fields.Many2one('hr.attendance', ondelete='restrict')
    leave_id = fields.Many2one('hr.leave', ondelete='restrict')

    _staff_daily_status_unique = models.Constraint(
        'unique(staff_id, date)',
        'A staff member may only have one daily status.',
    )

    @api.model
    def cron_generate_daily_status(self):
        today = fields.Date.context_today(self)
        staff_records = self.env['school.staff'].search([
            ('state', '=', 'active'), ('hire_date', '<=', today),
            '|', ('end_date', '=', False), ('end_date', '>=', today),
        ])
        existing = self.search([('date', '=', today), ('staff_id', 'in', staff_records.ids)])
        existing_staff = set(existing.staff_id.ids)
        for staff in staff_records.filtered(lambda rec: rec.id not in existing_staff):
            attendance = self.env['hr.attendance'].search([
                ('employee_id', '=', staff.employee_id.id),
                ('check_in', '>=', fields.Datetime.to_string(today)),
            ], order='check_in desc', limit=1) if staff.employee_id else False
            self.create({
                'staff_id': staff.id,
                'date': today,
                'status': 'present' if attendance else 'not_recorded',
                'attendance_id': attendance.id,
                'check_in': attendance.check_in,
                'check_out': attendance.check_out,
                'worked_hours': attendance.worked_hours,
            })


class SchoolStaffHrLink(models.Model):
    _inherit = 'school.staff'

    employee_id = fields.Many2one('hr.employee', string='Employee', ondelete='restrict', copy=False)
    employment_ids = fields.One2many(
        'school.staff.employment', 'staff_id', string='Employment History')
    # Teaching credentials (qualification, specialization, years of experience) live
    # on school.teacher, which is where demo data, the seed and the form all put
    # them. The duplicates that used to sit here were never written or displayed,
    # so they only offered a second place for the same answer to disagree.

    def _ensure_employee(self):
        for rec in self:
            if not rec.employee_id:
                rec.employee_id = self.env['hr.employee'].sudo().create({
                    'name': rec.name,
                    'work_email': rec.email,
                    'work_phone': rec.phone,
                    'user_id': rec.user_id.id,
                    'company_id': self.env.company.id,
                })

    @api.model
    def cron_deactivate_ended_staff(self):
        today = fields.Date.context_today(self)
        ended = self.search([
            ('state', '=', 'active'), ('end_date', '!=', False), ('end_date', '<=', today),
        ])
        ended.action_deactivate()
        ended.write({'employment_status': 'terminated', 'active': False})
