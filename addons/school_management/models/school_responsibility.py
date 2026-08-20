from odoo import api, fields, models
from odoo.exceptions import ValidationError

# Brief section 3: Registrar, Academic Director, Department Head, Teacher,
# Homeroom Teacher, Librarian, or Finance Staff.
RESPONSIBILITIES = [
    ('registrar', 'Registrar'),
    ('academic_director', 'Academic Director'),
    ('department_head', 'Department Head'),
    ('coordinator', 'Academic Coordinator'),
    ('teacher', 'Teacher'),
    ('homeroom', 'Homeroom Teacher'),
    ('librarian', 'Librarian'),
    ('finance', 'Finance Staff'),
    ('other', 'Other'),
]

DEPARTMENTS = [
    ('administration', 'Administration'),
    ('academic', 'Academic'),
    ('finance', 'Finance'),
    ('it', 'IT'),
    ('library', 'Library'),
    ('facilities', 'Facilities'),
    ('counseling', 'Counseling'),
    ('sports', 'Sports'),
]

# A staff member in one of these control states must not pick up new work.
BLOCKED_STATES = ('draft', 'suspended', 'inactive', 'archived')


class SchoolCampus(models.Model):
    _name = 'school.campus'
    _description = 'Branch / Campus'
    _order = 'name'

    name = fields.Char(string='Branch / Campus', required=True)
    code = fields.Char(string='Code')
    address = fields.Text(string='Address')
    active = fields.Boolean(string='Active', default=True)

    _campus_name_unique = models.Constraint(
        'unique(name)',
        'This branch or campus already exists.',
    )


class SchoolJobTitleResponsibility(models.Model):
    _inherit = 'school.job.title'

    responsibility = fields.Selection(
        RESPONSIBILITIES, string='Grants Responsibility',
        help='Primary responsibility seeded on staff who hold this job title.',
    )


class SchoolStaffResponsibility(models.Model):
    _name = 'school.staff.responsibility'
    _description = 'Staff Responsibility Assignment'
    _inherit = ['mail.thread']
    _order = 'is_primary desc, start_date desc'

    staff_id = fields.Many2one(
        'school.staff', string='Staff Member', required=True,
        ondelete='cascade', tracking=True,
    )
    responsibility = fields.Selection(
        RESPONSIBILITIES, string='Responsibility', required=True, tracking=True,
    )
    is_primary = fields.Boolean(
        string='Primary', default=False, tracking=True,
        help='Each staff member has at most one primary responsibility.',
    )
    department = fields.Selection(DEPARTMENTS, string='Department')
    campus_id = fields.Many2one('school.campus', string='Branch / Campus', ondelete='restrict')
    manager_id = fields.Many2one(
        'school.staff', string='Reporting Manager', ondelete='set null',
    )

    start_date = fields.Date(
        string='Effective From', required=True,
        default=lambda self: fields.Date.context_today(self), tracking=True,
    )
    end_date = fields.Date(string='Effective To', tracking=True)
    active = fields.Boolean(string='Active', default=True)

    _responsibility_unique = models.Constraint(
        'unique(staff_id, responsibility, department, start_date)',
        'This staff member already holds that responsibility from the same date.',
    )
    _responsibility_dates_valid = models.Constraint(
        'CHECK(end_date IS NULL OR end_date >= start_date)',
        'The effective-to date cannot be before the effective-from date.',
    )

    @api.depends('staff_id', 'responsibility')
    def _compute_display_name(self):
        labels = dict(RESPONSIBILITIES)
        for rec in self:
            rec.display_name = (
                f'{rec.staff_id.name} - {labels.get(rec.responsibility, "")}'
                if rec.staff_id else labels.get(rec.responsibility, '')
            )

    @api.constrains('is_primary', 'staff_id')
    def _check_single_primary(self):
        for rec in self.filtered('is_primary'):
            clash = self.search_count([
                ('id', '!=', rec.id),
                ('staff_id', '=', rec.staff_id.id),
                ('is_primary', '=', True),
            ])
            if clash:
                raise ValidationError(
                    f'{rec.staff_id.name} already has a primary responsibility. '
                    'Clear the other one first.'
                )

    @api.constrains('manager_id', 'staff_id')
    def _check_manager_is_not_self(self):
        for rec in self:
            if rec.manager_id and rec.manager_id == rec.staff_id:
                raise ValidationError('A staff member cannot report to themselves.')


class SchoolStaffResponsibilityLink(models.Model):
    """Brief section 4: responsibility, reporting manager, branch/campus, and a
    control status separate from employment status. mail.thread is mixed in so the
    status and responsibility history the brief asks for is recorded."""
    _name = 'school.staff'
    _inherit = ['school.staff', 'mail.thread']

    campus_id = fields.Many2one('school.campus', string='Branch / Campus', ondelete='restrict')
    manager_id = fields.Many2one('school.staff', string='Reporting Manager', ondelete='set null')
    responsibility_ids = fields.One2many(
        'school.staff.responsibility', 'staff_id', string='Responsibilities',
    )
    primary_responsibility = fields.Selection(
        RESPONSIBILITIES, string='Primary Responsibility',
        compute='_compute_primary_responsibility', store=True,
    )
    responsibility_count = fields.Integer(
        string='Responsibility Count', compute='_compute_related_counts',
    )
    teacher_count = fields.Integer(string='Teacher Profiles', compute='_compute_related_counts')
    program_count = fields.Integer(string='Programs Organised', compute='_compute_related_counts')
    announcement_count = fields.Integer(string='Announcements', compute='_compute_related_counts')

    # Control status from the brief, kept separate from employment_status so existing
    # employment data is not reinterpreted.
    state = fields.Selection([
        ('draft', 'Draft'),
        ('active', 'Active'),
        ('suspended', 'Suspended'),
        ('inactive', 'Inactive'),
        ('archived', 'Archived'),
    ], string='Status', default='draft', required=True, tracking=True)
    missing_to_activate = fields.Char(
        string='Still Missing', compute='_compute_missing_to_activate',
    )

    @api.onchange('job_title_id')
    def _onchange_job_title_id(self):
        if not self.job_title_id.responsibility or self.responsibility_ids.filtered('active'):
            return
        self.responsibility_ids = [(0, 0, {
            'responsibility': self.job_title_id.responsibility,
            'is_primary': True,
            'department': self.department,
            'start_date': fields.Date.context_today(self),
        })]

    @api.depends('responsibility_ids.is_primary', 'responsibility_ids.responsibility',
                 'responsibility_ids.active')
    def _compute_primary_responsibility(self):
        for rec in self:
            primary = rec.responsibility_ids.filtered(lambda r: r.is_primary and r.active)
            rec.primary_responsibility = primary[:1].responsibility or False

    @api.depends('responsibility_ids')
    def _compute_related_counts(self):
        """Only the responsibility count can be tracked by a dependency; the other
        three are searches on models that do not point back here, so they are
        recomputed whenever the form is reloaded."""
        for rec in self:
            rec.responsibility_count = len(rec.responsibility_ids)
            rec.teacher_count = self.env['school.teacher'].search_count([('staff_id', '=', rec.id)])
            rec.program_count = self.env['school.program'].search_count([('organizer_id', '=', rec.id)])
            rec.announcement_count = self.env['school.announcement'].search_count([
                '|', ('staff_ids', 'in', rec.ids), ('audience_type', '=', 'all_staff'),
            ])

    def _missing_registration_fields(self):
        self.ensure_one()
        checks = (
            (self.first_name, 'First Name'),
            (self.last_name, 'Last Name'),
            # Without this, the minimum-age rule only applies to whoever chooses to
            # fill the field, and a staff member can be activated with no age ever
            # checked. Only the roles that may read a birth date can activate staff,
            # so requiring it here does not ask anyone for a field they cannot see.
            (self.date_of_birth, 'Date of Birth'),
            (self.phone, 'Primary Phone'),
            (self.department, 'Department'),
            (self.job_title_id, 'Job Title'),
            (self.employment_status, 'Employment Status'),
            (self.responsibility_ids.filtered('active'), 'at least one active Responsibility'),
        )
        return [label for value, label in checks if not value]

    @api.depends('first_name', 'last_name', 'date_of_birth', 'phone', 'department',
                 'job_title_id', 'employment_status', 'responsibility_ids',
                 'responsibility_ids.active')
    def _compute_missing_to_activate(self):
        for rec in self:
            rec.missing_to_activate = ', '.join(rec._missing_registration_fields())

    @api.constrains('first_name', 'last_name', 'date_of_birth', 'phone', 'department',
                    'job_title_id', 'employment_status', 'state', 'responsibility_ids')
    def _check_required_registration_fields(self):
        """Enforced as a constraint rather than required=True so the column stays
        nullable and the upgrade does not fail on rows that predate the rule."""
        for rec in self:
            if rec.state == 'draft':
                continue
            missing = rec._missing_registration_fields()
            if missing:
                raise ValidationError(
                    'Cannot leave Draft while the following are missing: %s'
                    % ', '.join(missing)
                )

    @api.constrains('manager_id')
    def _check_manager_is_not_self(self):
        for rec in self:
            if rec.manager_id and rec.manager_id == rec:
                raise ValidationError('A staff member cannot report to themselves.')

    def action_activate(self):
        for rec in self:
            if not rec.staff_id:
                rec.staff_id = self.env['ir.sequence'].next_by_code('school.staff') or 'New'
        self._ensure_employee()
        self.write({'state': 'active'})
        teachers = self.env['school.teacher'].search([('staff_id', 'in', self.ids)])
        if teachers:
            teachers.write({'teaching_status': 'active'})

    def action_suspend(self):
        self.write({'state': 'suspended'})
        teachers = self.env['school.teacher'].search([('staff_id', 'in', self.ids)])
        if teachers:
            teachers.write({'teaching_status': 'inactive'})

    def action_deactivate(self):
        """Brief section 4: deactivating a staff member with a linked Odoo user must
        follow a documented rule. Here the Odoo login is archived with the record so
        access cannot outlive the employment."""
        for rec in self:
            if rec.user_id:
                login = rec.user_id.login
                rec.user_id.sudo().active = False
                rec.message_post(
                    body=f'Linked Odoo user {login} was deactivated with this staff record.'
                )
        self.write({'state': 'inactive'})
        teachers = self.env['school.teacher'].search([('staff_id', 'in', self.ids)])
        if teachers:
            teachers.write({'teaching_status': 'inactive'})

    def action_reset_draft(self):
        self.write({'state': 'draft'})
        teachers = self.env['school.teacher'].search([('staff_id', 'in', self.ids)])
        if teachers:
            teachers.write({'teaching_status': 'inactive'})

    def action_open_responsibilities(self):
        self.ensure_one()
        return {
            'type': 'ir.actions.act_window',
            'name': 'Responsibilities',
            'res_model': 'school.staff.responsibility',
            'view_mode': 'list,form',
            'domain': [('staff_id', '=', self.id)],
            'context': {'default_staff_id': self.id},
        }
