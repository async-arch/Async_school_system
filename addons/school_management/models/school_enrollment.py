from odoo import api, fields, models
from odoo.exceptions import ValidationError


class SchoolEnrollment(models.Model):
    """A student's academic placement for one year (SRS §5.4).

    The student record stays the permanent identity; this row is the thing
    rosters, attendance, and mark lists will hang off. One active row per
    student per academic year.
    """
    _name = 'school.enrollment'
    _description = 'Academic-Year Enrollment'
    _inherit = ['mail.thread']
    _order = 'enrollment_date desc, name desc'

    name = fields.Char(string='Enrollment ID', required=True, copy=False,
                       readonly=True, default='New')
    student_id = fields.Many2one(
        'school.student', string='Student', required=True, index=True,
        ondelete='restrict', tracking=True,
        domain="[('registration_status', '=', 'approved')]",
    )
    class_id = fields.Many2one(
        'school.class', string='Grade / Class', required=True, index=True,
        ondelete='restrict', tracking=True,
    )
    academic_year_id = fields.Many2one(
        related='class_id.academic_year_id', string='Academic Year',
        store=True, index=True,
    )
    roll_number = fields.Integer(
        string='Roll Number', copy=False,
        help='Assigned automatically on activation when left at 0.',
    )
    admission_type = fields.Selection([
        ('new', 'New'),
        ('transfer', 'Transfer'),
        ('returning', 'Returning'),
        ('readmitted', 'Re-admitted'),
    ], string='Admission Type', required=True, default='new')
    enrollment_date = fields.Date(
        string='Enrollment Date', required=True,
        default=lambda self: fields.Date.context_today(self),
    )
    end_date = fields.Date(string='End Date', copy=False)
    state = fields.Selection([
        ('draft', 'Draft'),
        ('active', 'Active'),
        ('transferred', 'Transferred'),
        ('withdrawn', 'Withdrawn'),
        ('completed', 'Completed'),
    ], string='Status', default='draft', required=True, tracking=True)
    active = fields.Boolean(string='Active', default=True)
    subject_ids = fields.One2many(
        'school.student.subject', 'enrollment_id', string='Subjects',
    )
    placement_ids = fields.One2many(
        'school.enrollment.placement', 'enrollment_id', string='Placement History')
    override_ids = fields.One2many(
        'school.enrollment.override', 'enrollment_id', string='Authorized Overrides')

    _roll_not_negative = models.Constraint(
        'CHECK(roll_number >= 0)',
        'Roll number cannot be negative.',
    )
    _end_after_start = models.Constraint(
        'CHECK(end_date IS NULL OR end_date >= enrollment_date)',
        'The end date cannot be before the enrollment date.',
    )

    @api.constrains('student_id', 'class_id')
    def _check_one_enrollment_per_year(self):
        for rec in self:
            clash = self.search([
                ('id', '!=', rec.id), ('student_id', '=', rec.student_id.id),
                ('academic_year_id', '=', rec.academic_year_id.id),
            ], limit=1)
            if clash:
                raise ValidationError(
                    '%s already has enrollment %s for %s.' % (
                        rec.student_id.name, clash.name, rec.academic_year_id.name))

    @api.constrains('class_id', 'roll_number', 'state')
    def _check_roll_unique(self):
        for rec in self:
            if not rec.roll_number or rec.state == 'draft':
                continue
            clash = self.search([
                ('id', '!=', rec.id),
                ('class_id', '=', rec.class_id.id),
                ('roll_number', '=', rec.roll_number),
                ('state', '!=', 'draft'),
            ], limit=1)
            if clash:
                raise ValidationError(
                    'Roll number %s is already taken in %s by %s.'
                    % (rec.roll_number, rec.class_id.display_name, clash.student_id.name)
                )

    @api.model_create_multi
    def create(self, vals_list):
        for vals in vals_list:
            if vals.get('name', 'New') == 'New':
                vals['name'] = self.env['ir.sequence'].next_by_code('school.enrollment') or 'New'
        return super().create(vals_list)

    def write(self, vals):
        previous_classes = {rec.id: rec.class_id for rec in self}
        res = super().write(vals)
        if 'class_id' in vals or 'state' in vals:
            self._sync_student_class()
        if 'class_id' in vals:
            for rec in self:
                if previous_classes[rec.id] != rec.class_id:
                    drop_date = fields.Date.to_date(
                        self.env.context.get('placement_effective_date')
                        or fields.Date.context_today(rec))
                    for line in rec.subject_ids.filtered(
                            lambda line: line.state == 'enrolled'
                            and line.grade_subject_id.class_id == previous_classes[rec.id]):
                        line.write({
                            'state': 'dropped',
                            'date_end': max(drop_date, line.date_start),
                            'drop_reason': 'Placement changed to %s' % rec.class_id.display_name,
                        })
        return res

    def _sync_student_class(self):
        for rec in self.filtered(lambda r: r.state == 'active'):
            values = {
                'class_id': rec.class_id.id,
                'academic_year_id': rec.academic_year_id.id,
                'section_id': rec.class_id.section_id.id,
            }
            if rec.class_id.education_level:
                values['education_level'] = rec.class_id.education_level
            if rec.class_id.stream_id:
                values['stream_id'] = rec.class_id.stream_id.id
            rec.student_id.with_context(
                skip_registration_completeness=True
            ).write(values)

    def _next_roll_number(self):
        self.ensure_one()
        last = self.search([
            ('class_id', '=', self.class_id.id),
            ('state', '!=', 'draft'),
        ], order='roll_number desc', limit=1)
        return (last.roll_number or 0) + 1

    def _check_capacity(self):
        for rec in self:
            capacity = rec.class_id.capacity
            if not capacity:
                continue
            taken = self.search_count([
                ('class_id', '=', rec.class_id.id),
                ('state', '=', 'active'),
                ('id', '!=', rec.id),
            ])
            if taken >= capacity:
                authorized = rec.override_ids.filtered(
                    lambda override: override.active and override.operation == 'capacity')
                if authorized:
                    continue
                raise ValidationError(
                    '%s is full (%s of %s seats taken). Pick another class or '
                    'raise its capacity.'
                    % (rec.class_id.display_name, taken, capacity)
                )

    def action_activate(self):
        for rec in self:
            if rec.state != 'draft':
                raise ValidationError('Only draft enrollments can be activated.')
            if rec.student_id.registration_status != 'approved':
                raise ValidationError(
                    'Approve the registration of %s before enrolling them.'
                    % rec.student_id.name
                )
            rec._check_capacity()
            if not rec.roll_number:
                rec.roll_number = rec._next_roll_number()
            rec.state = 'active'
            if not rec.placement_ids:
                self.env['school.enrollment.placement'].create({
                    'enrollment_id': rec.id,
                    'class_id': rec.class_id.id,
                    'shift_id': rec.class_id.shift_id.id,
                    'stream_id': rec.class_id.stream_id.id,
                    'roll_number': rec.roll_number,
                    'date_start': rec.enrollment_date,
                })
                rec.invalidate_recordset(['placement_ids'])
        self._sync_student_class()
        self._derive_subject_enrollments()

    def _derive_subject_enrollments(self):
        StudentSubject = self.env['school.student.subject']
        GradeSubject = self.env['school.grade.subject']
        for rec in self.filtered(lambda r: r.state == 'active'):
            wanted = GradeSubject.search([
                ('class_id', '=', rec.class_id.id),
                ('subject_type', '=', 'compulsory'),
            ])
            existing = StudentSubject.search([
                ('enrollment_id', '=', rec.id),
                ('state', '=', 'enrolled'),
            ]).grade_subject_id
            for gs in wanted - existing:
                prior = StudentSubject.search([
                    ('enrollment_id', '=', rec.id), ('grade_subject_id', '=', gs.id),
                    ('state', '=', 'dropped'),
                ], limit=1)
                if prior:
                    prior.write({
                        'state': 'enrolled', 'date_start': fields.Date.context_today(rec),
                        'date_end': False, 'drop_reason': False,
                    })
                else:
                    StudentSubject.create({
                        'enrollment_id': rec.id, 'grade_subject_id': gs.id,
                        'date_start': rec.enrollment_date,
                    })

    def action_withdraw(self):
        for rec in self:
            if rec.state != 'active':
                raise ValidationError('Only active enrollments can be withdrawn.')
            rec.write({
                'state': 'withdrawn',
                'end_date': rec.end_date or fields.Date.context_today(rec),
            })
            rec.placement_ids.filtered(lambda p: not p.date_end).write({
                'date_end': rec.end_date,
            })
            rec.student_id.lifecycle_status = 'withdrawn'

    def action_complete(self):
        for rec in self:
            if rec.state != 'active':
                raise ValidationError('Only active enrollments can be completed.')
            end_date = rec.end_date or rec.academic_year_id.date_end or fields.Date.context_today(rec)
            rec.write({'state': 'completed', 'end_date': end_date})
            rec.placement_ids.filtered(lambda p: not p.date_end).write({'date_end': end_date})

    def action_graduate(self):
        self.action_complete()
        self.mapped('student_id').write({'lifecycle_status': 'graduated'})

    def unlink(self):
        if any(rec.state != 'draft' for rec in self):
            raise ValidationError(
                'Enrollments past draft are history and cannot be deleted. '
                'Withdraw them instead.'
            )
        return super().unlink()

    def action_open_student_dashboard(self):
        self.ensure_one()
        return {
            'type': 'ir.actions.act_window',
            'res_model': 'school.student',
            'res_id': self.student_id.id,
            'view_mode': 'form',
            'view_id': self.env.ref('school_management.view_school_student_dashboard_form').id,
            'target': 'current',
        }
