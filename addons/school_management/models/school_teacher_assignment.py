from odoo import api, fields, models
from odoo.exceptions import ValidationError


class SchoolTeacherAssignment(models.Model):
    _name = 'school.teacher.assignment'
    _description = 'Teacher Subject / Class Assignment'
    _inherit = ['mail.thread']
    _order = 'academic_year_id, term_id'

    name = fields.Char(string='Assignment', compute='_compute_name', store=True)
    weekly_periods = fields.Integer(string='Periods per Week', default=1, required=True)
    start_date = fields.Date(string='Start Date', required=True, default=lambda self: fields.Date.context_today(self))
    end_date = fields.Date(string='End Date')
    teacher_id = fields.Many2one('school.teacher', string='Teacher', required=True, ondelete='cascade')
    subject_id = fields.Many2one('school.subject', string='Subject', required=True)
    class_id = fields.Many2one('school.class', string='Grade / Class', required=True)
    academic_year_id = fields.Many2one(
        'school.academic.year', related='class_id.academic_year_id',
        store=True, readonly=True, string='Academic Year')
    term_id = fields.Many2one(
        'school.term', string='Term', required=True,
        ondelete='restrict', index=True,
    )
    responsibility = fields.Selection([
        ('teacher', 'Teacher'),
        ('homeroom', 'Homeroom Teacher'),
        ('department_head', 'Department Head'),
        ('coordinator', 'Academic Coordinator'),
    ], string='Responsibility', default='teacher', required=True)
    active = fields.Boolean(string='Active', default=True)

    @api.constrains('subject_id', 'class_id', 'academic_year_id', 'term_id', 'active')
    def _check_single_teacher_per_subject_class_term(self):
        """Brief section 6: one active teacher per subject/class/section for a given academic period."""
        for rec in self.filtered(lambda r: r.active):
            clash = self.search([
                ('id', '!=', rec.id),
                ('subject_id', '=', rec.subject_id.id),
                ('class_id', '=', rec.class_id.id),
                ('academic_year_id', '=', rec.academic_year_id.id),
                ('term_id', '=', rec.term_id.id),
                ('active', '=', True),
            ], limit=1)
            if clash:
                raise ValidationError(
                    f'{rec.class_id.display_name} already has {clash.teacher_id.name} teaching '
                    f'{rec.subject_id.name} for {rec.academic_year_id.name} {rec.term_id.name}.'
                )

    @api.constrains('responsibility', 'class_id', 'academic_year_id', 'term_id', 'active')
    def _check_single_homeroom_per_class(self):
        """Brief section 6: one active homeroom teacher per class/section and period."""
        for rec in self.filtered(lambda r: r.responsibility == 'homeroom' and r.active):
            clash = self.search([
                ('id', '!=', rec.id),
                ('responsibility', '=', 'homeroom'),
                ('class_id', '=', rec.class_id.id),
                ('academic_year_id', '=', rec.academic_year_id.id),
                ('term_id', '=', rec.term_id.id),
            ], limit=1)
            if clash:
                raise ValidationError(
                    f'{rec.class_id.display_name} already has {clash.teacher_id.name} as '
                    f'homeroom teacher for {rec.academic_year_id.name} {rec.term_id.name}.'
                )

    @api.constrains('teacher_id')
    def _check_staff_can_take_work(self):
        """Only active staff take new assignments — anyone on leave, resigned,
        terminated, or retired is blocked."""
        for rec in self:
            staff = rec.teacher_id.staff_id
            status = staff.employment_status
            if staff.state != 'active' or status != 'active':
                raise ValidationError(
                    f'{rec.teacher_id.name} is not operationally active as a staff '
                    f'member ({staff.state}, {status.replace("_", " ")}) and cannot '
                    'receive new assignments.'
                )

    @api.constrains('teacher_id', 'subject_id', 'start_date')
    def _check_teacher_and_subject_active(self):
        today = fields.Date.context_today(self)
        for rec in self:
            if rec.start_date and rec.start_date > today:
                if rec.teacher_id.teaching_status != 'active' or not rec.teacher_id.active:
                    raise ValidationError('Cannot create a future assignment for an inactive teacher.')
            if not rec.subject_id.active:
                raise ValidationError('Cannot assign an inactive subject.')
    @api.constrains('start_date', 'end_date')
    def _check_dates(self):
        for rec in self:
            if rec.end_date and rec.end_date < rec.start_date:
                raise ValidationError('End date cannot be before the start date.')

    @api.constrains('weekly_periods', 'teacher_id', 'active')
    def _check_workload(self):
        for rec in self:
            if not rec.teacher_id.max_weekly_workload:
                continue
            total = sum(rec.teacher_id.assignment_ids.filtered(
                lambda a: a.active
            ).mapped('weekly_periods'))
            if total > rec.teacher_id.max_weekly_workload:
                raise ValidationError(
                    'This assignment brings %s to %s weekly periods, exceeding their maximum of %s.'
                    % (rec.teacher_id.name, total, rec.teacher_id.max_weekly_workload)
                )
    @api.model_create_multi
    def create(self, vals_list):
        records = super().create(vals_list)
        for rec in records:
            partner = rec.teacher_id.user_id.partner_id
            if partner:
                rec.message_subscribe(partner_ids=partner.ids)
                rec.message_post(
                    body=f'You have been assigned: {rec.name} for {rec.academic_year_id.name}.',
                    partner_ids=partner.ids,
                )
        return records

    @api.depends('teacher_id.name', 'subject_id.name', 'class_id.name', 'term_id.name')
    def _compute_name(self):
        for rec in self:
            rec.name = '%s - %s (%s, %s)' % (
                rec.teacher_id.name or '?',
                rec.subject_id.name or '?',
                rec.class_id.name or '?',
                rec.term_id.name or ''
            )