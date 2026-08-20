from odoo import api, fields, models
from odoo.exceptions import ValidationError

from .school_responsibility import BLOCKED_STATES


class SchoolTeacherAssignment(models.Model):
    _name = 'school.teacher.assignment'
    _description = 'Teacher Subject / Class Assignment'
    _inherit = ['mail.thread']
    _order = 'academic_year_id, term_id'

    name = fields.Char(string='Assignment', compute='_compute_name', store=True)
    weekly_periods = fields.Integer(string='Periods per Week', default=1, required=True)
    start_date = fields.Date(string='Start Date', required=True)
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
    teaching_role = fields.Selection([
        ('lead', 'Lead Teacher'), ('assistant', 'Assistant Teacher'),
        ('substitute', 'Substitute Teacher'), ('examiner', 'Examiner'),
    ], default='lead', required=True)
    state = fields.Selection([
        ('draft', 'Draft'), ('active', 'Active'), ('ended', 'Ended'),
        ('cancelled', 'Cancelled'),
    ], default='active', required=True, tracking=True)
    active = fields.Boolean(string='Active', default=True)

    @api.onchange('class_id')
    def _onchange_class_id(self):
        for rec in self:
            if rec.term_id and rec.term_id.academic_year_id != rec.class_id.academic_year_id:
                rec.term_id = False
            if rec.subject_id and rec.class_id and not self.env['school.grade.subject'].search_count([
                    ('class_id', '=', rec.class_id.id),
                    ('subject_id', '=', rec.subject_id.id),
                    ('active', '=', True)]):
                rec.subject_id = False

    @api.onchange('term_id')
    def _onchange_term_id(self):
        for rec in self.filtered('term_id'):
            if rec.class_id and rec.term_id.academic_year_id != rec.class_id.academic_year_id:
                rec.term_id = False
                continue
            # The term is the user's single source of truth for this period.
            # Keep effective dates for history/security checks without asking
            # users to enter the same range twice.
            rec.start_date = rec.term_id.date_start
            rec.end_date = rec.term_id.date_end

    @api.constrains('subject_id', 'class_id', 'academic_year_id', 'term_id',
                    'state', 'active', 'start_date', 'end_date')
    def _check_single_teacher_per_subject_class_term(self):
        """Brief section 6: one active teacher per subject/class/section for a given academic period."""
        for rec in self.filtered(lambda r: r.active and r.state == 'active'):
            clash = self.search([
                ('id', '!=', rec.id),
                ('subject_id', '=', rec.subject_id.id),
                ('class_id', '=', rec.class_id.id),
                ('academic_year_id', '=', rec.academic_year_id.id),
                ('term_id', '=', rec.term_id.id),
                ('state', '=', 'active'),
                ('active', '=', True),
                ('start_date', '<=', rec.end_date or fields.Date.to_date('9999-12-31')),
                ('|', ('end_date', '=', False), ('end_date', '>=', rec.start_date)),
            ], limit=1)
            if clash:
                raise ValidationError(
                    f'{rec.class_id.display_name} already has {clash.teacher_id.name} teaching '
                    f'{rec.subject_id.name} for {rec.academic_year_id.name} {rec.term_id.name}.'
                )

    @api.constrains('responsibility', 'class_id', 'academic_year_id', 'term_id',
                    'state', 'active', 'start_date', 'end_date')
    def _check_single_homeroom_per_class(self):
        """Brief section 6: one active homeroom teacher per class/section and period."""
        for rec in self.filtered(
                lambda r: r.responsibility == 'homeroom' and r.active and r.state == 'active'):
            clash = self.search([
                ('id', '!=', rec.id),
                ('responsibility', '=', 'homeroom'),
                ('class_id', '=', rec.class_id.id),
                ('academic_year_id', '=', rec.academic_year_id.id),
                ('term_id', '=', rec.term_id.id),
                ('state', '=', 'active'), ('active', '=', True),
                ('start_date', '<=', rec.end_date or fields.Date.to_date('9999-12-31')),
                ('|', ('end_date', '=', False), ('end_date', '>=', rec.start_date)),
            ], limit=1)
            if clash:
                raise ValidationError(
                    f'{rec.class_id.display_name} already has {clash.teacher_id.name} as '
                    f'homeroom teacher for {rec.academic_year_id.name} {rec.term_id.name}.'
                )

    @api.constrains('teacher_id')
    def _check_staff_can_take_work(self):
        """Brief section 4: suspended or inactive staff take no new assignments.

        Control status and employment status are separate fields on purpose, and
        each blocks work on its own: Suspend sets state, while a resignation is
        recorded as an employment_status. Checking only one of them let a
        suspended teacher keep collecting classes.
        """
        for rec in self:
            staff = rec.teacher_id.staff_id
            if staff.state in BLOCKED_STATES:
                label = dict(staff._fields['state'].selection).get(staff.state, staff.state)
                raise ValidationError(
                    '%s is %s as a staff member and cannot receive new assignments.'
                    % (rec.teacher_id.name, label)
                )
            employment_status = staff.employment_status
            if employment_status not in ('active', 'on_leave'):
                raise ValidationError(
                    '%s is %s as a staff member and cannot receive new assignments.'
                    % (rec.teacher_id.name, employment_status)
                )
            if not staff.active:
                raise ValidationError('Inactive staff cannot receive assignments.')

    @api.constrains('teacher_id', 'subject_id', 'start_date')
    def _check_teacher_and_subject_active(self):
        today = fields.Date.context_today(self)
        for rec in self:
            if rec.start_date and rec.start_date > today:
                if rec.teacher_id.teaching_status != 'active' or not rec.teacher_id.active:
                    raise ValidationError('Cannot create a future assignment for an inactive teacher.')
            if not rec.subject_id.active:
                raise ValidationError('Cannot assign an inactive subject.')

    @api.constrains('subject_id', 'class_id')
    def _check_subject_on_curriculum(self):
        for rec in self:
            curriculum = self.env['school.grade.subject'].search_count([
                ('class_id', '=', rec.class_id.id), ('active', '=', True)])
            offered = self.env['school.grade.subject'].search_count([
                ('class_id', '=', rec.class_id.id),
                ('subject_id', '=', rec.subject_id.id),
                ('active', '=', True)])
            if curriculum and not offered:
                raise ValidationError(
                    '%s is not on the curriculum of %s.' % (
                        rec.subject_id.name, rec.class_id.display_name))

    @api.constrains('start_date', 'end_date')
    def _check_dates(self):
        for rec in self:
            if rec.end_date and rec.end_date < rec.start_date:
                raise ValidationError('End date cannot be before the start date.')

    @api.constrains('term_id', 'academic_year_id', 'start_date', 'end_date')
    def _check_period(self):
        for rec in self:
            if rec.term_id.academic_year_id != rec.academic_year_id:
                raise ValidationError('The assignment term must belong to its academic year.')
            if rec.start_date < rec.term_id.date_start:
                raise ValidationError('The assignment cannot start before its term.')
            if rec.end_date and rec.end_date > rec.term_id.date_end:
                raise ValidationError('The assignment cannot end after its term.')

    def unlink(self):
        if any(rec.state != 'draft' for rec in self):
            raise ValidationError('Teacher assignment history cannot be deleted.')
        return super().unlink()

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
        for vals in vals_list:
            if vals.get('term_id'):
                term = self.env['school.term'].browse(vals['term_id'])
                vals.setdefault('start_date', term.date_start)
                vals.setdefault('end_date', term.date_end)
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

    def write(self, vals):
        if vals.get('term_id'):
            term = self.env['school.term'].browse(vals['term_id'])
            vals = dict(vals)
            vals.setdefault('start_date', term.date_start)
            vals.setdefault('end_date', term.date_end)
        return super().write(vals)

    @api.depends('teacher_id.name', 'subject_id.name', 'class_id.name', 'term_id.name')
    def _compute_name(self):
        for rec in self:
            rec.name = '%s - %s (%s, %s)' % (
                rec.teacher_id.name or '?',
                rec.subject_id.name or '?',
                rec.class_id.name or '?',
                rec.term_id.name or ''
            )