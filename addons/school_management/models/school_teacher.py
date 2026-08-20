from odoo import models, fields, api
from odoo.exceptions import UserError, ValidationError


class SchoolTeacher(models.Model):
    _name = 'school.teacher'
    _description = 'Teacher Profile'
    _order = 'name'

    teacher_id = fields.Char(
        string='Teacher ID', 
        required=True, 
        copy=False, 
        readonly=True, 
        default='New'
    )
    
    name = fields.Char(
        string='Full Name', 
        compute='_compute_name',
        store=True, 
        readonly=True,
    )

    staff_id = fields.Many2one('school.staff', string='Staff Record', required=True, ondelete='restrict',
                                domain="[('active', '=', True), ('state', '=', 'active'), ('employment_status', '=', 'active'), '|', ('department', '=', 'academic'), ('primary_responsibility', 'in', ['teacher', 'homeroom', 'department_head', 'coordinator'])]",
                                help='Link to the official staff master record.')

    department = fields.Selection(
        related='staff_id.department', string='Department', store=True, readonly=True,
    )
    primary_responsibility = fields.Selection(
        related='staff_id.primary_responsibility', string='Primary Responsibility', store=True, readonly=True,
    )

    qualification = fields.Char(string='Highest Qualification')
    specialization = fields.Char(string='Specialization')
    years_of_experience = fields.Integer(string='Years of Experience')
    hire_date = fields.Date(
        string='Hire / Start Date', compute='_compute_hire_date',
        store=True, readonly=False,
        help='Taken from the staff record when the profile is created. It can be '
             'changed here for a teacher who started teaching later than they were '
             'hired.',
    )

    @api.depends('staff_id')
    def _compute_hire_date(self):
        """The date is already on the staff record, so asking for it again is a
        second chance to disagree. It stays editable rather than related, because
        a teacher can start teaching later than the date they were employed — and
        because an existing profile must keep the date it already carries."""
        for rec in self:
            rec.hire_date = rec.hire_date or rec.staff_id.hire_date

    teaching_status = fields.Selection([
        ('active', 'Active'),
        ('inactive', 'Inactive'),
    ], string='Teaching Status', default='active', required=True)

    max_weekly_workload = fields.Integer(string='Maximum Weekly Periods')
    available_days = fields.Char(
        string='Available Days', 
        help='e.g. Mon-Fri, or specific days'
    )

    assignment_ids = fields.One2many(
        'school.teacher.assignment', 
        'teacher_id', 
        string='Assignments'
    )
    user_id = fields.Many2one(
        'res.users', 
        string='Teacher Login', 
        copy=False, 
        readonly=True
    )

    login_password = fields.Char(
        string='Login Password', store=False, copy=False,
        compute='_compute_login_password', inverse='_inverse_login_password',
        help='Password for the teacher login. Leave empty to email a set-password '
             'link instead. Never stored on the teacher record.',
    )

    active = fields.Boolean(string='Active', default=True)

    def _compute_login_password(self):
        self.login_password = False

    def _inverse_login_password(self):
        """The field is not stored, so the typed value only exists during this save.
        A teacher who has no login yet must therefore get one here — reading the
        field back from action_create_login_user returns the computed False, which
        is how a typed password used to be dropped in favour of a reset email.
        """
        for rec in self:
            if not rec.login_password:
                continue
            if rec.user_id:
                rec.user_id.sudo().password = rec.login_password
            else:
                rec._create_teacher_user(password=rec.login_password)

    # =========================================================================
    # TEACHER DASHBOARD KPI COMPUTED FIELDS
    # =========================================================================
    assigned_class_count = fields.Integer(
        string='Classes Count', 
        compute='_compute_dashboard_kpis'
    )
    assigned_subject_count = fields.Integer(
        string='Subjects Count', 
        compute='_compute_dashboard_kpis'
    )
    total_student_count = fields.Integer(
        string='Total Students', 
        compute='_compute_dashboard_kpis'
    )
    current_weekly_periods = fields.Integer(
        string='Current Weekly Periods', 
        compute='_compute_dashboard_kpis'
    )

    _teacher_id_unique = models.Constraint(
        'unique(teacher_id)',
        'Teacher ID must be unique.',
    )
    _staff_id_unique = models.Constraint(
        'unique(staff_id)',
        'This staff member already has a teacher profile.',
    )

    # =========================================================================
    # COMPUTE METHODS
    # =========================================================================
    @api.depends('staff_id.name')
    def _compute_name(self):
        for rec in self.sudo():
            rec.name = rec.staff_id.name if rec.staff_id else ''

    @api.depends_context('assignment_academic_year', 'assignment_term')
    def _compute_display_name(self):
        """Brief section 6: flag an occupied teacher, with why, right in the picker.
        Only kicks in when the calling view passes assignment_academic_year/assignment_term
        in context (see teacher_id's context on the Teacher Assignment form).

        depends_context is required, not decoration: without it display_name caches
        one value per record and the '— Occupied' suffix computed for the picker
        leaks into every other view in the same transaction."""
        super()._compute_display_name()
        academic_year_id = self.env.context.get('assignment_academic_year')
        term_id = self.env.context.get('assignment_term')
        if not (academic_year_id and term_id):
            return
        Assignment = self.env['school.teacher.assignment'].sudo()
        for rec in self:
            others = Assignment.search([
                ('teacher_id', '=', rec.id),
                ('academic_year_id', '=', academic_year_id),
                ('term_id', '=', term_id),
                ('active', '=', True),
            ])
            if not others:
                continue
            reasons = ['already teaching %s' % ', '.join(others.mapped('subject_id.name'))]
            total_periods = sum(others.mapped('weekly_periods'))
            if rec.max_weekly_workload and total_periods >= rec.max_weekly_workload:
                reasons.append('at max workload %d/%d periods' % (total_periods, rec.max_weekly_workload))
            rec.display_name = '%s — Occupied (%s)' % (rec.display_name, '; '.join(reasons))

    @api.depends('assignment_ids', 'assignment_ids.active', 'assignment_ids.class_id', 'assignment_ids.subject_id', 'assignment_ids.weekly_periods')
    def _compute_dashboard_kpis(self):
        for rec in self:
            active_assignments = rec.assignment_ids.filtered(lambda a: a.active)
            classes = active_assignments.mapped('class_id')
            subjects = active_assignments.mapped('subject_id')
            
            rec.assigned_class_count = len(classes)
            rec.assigned_subject_count = len(subjects)
            rec.current_weekly_periods = sum(active_assignments.mapped('weekly_periods'))
            
            if classes:
                students = self.env['school.student'].search([
                    ('class_id', 'in', classes.ids),
                    ('active', '=', True)
                ])
                rec.total_student_count = len(students)
            else:
                rec.total_student_count = 0

    # =========================================================================
    # DASHBOARD ACTION & STAT BUTTONS
    # =========================================================================
    @api.model
    def action_open_my_dashboard(self):
        user = self.env.user
        teacher = self.env['school.teacher'].sudo().search([('user_id', '=', user.id)], limit=1)
        
        if not teacher:
            raise UserError("No teacher record is associated with your current user account.")

        dashboard_view = self.env.ref('school_management.view_school_teacher_dashboard_form')
        return {
            'type': 'ir.actions.act_window',
            'name': 'My Dashboard',
            'res_model': 'school.teacher',
            'res_id': teacher.id,
            'view_mode': 'form',
            'views': [(dashboard_view.id, 'form')],
            'target': 'current',
            'flags': {'mode': 'readonly'},
            'context': {
                'create': False, 
                'edit': False, 
                'delete': False,
                'form_view_initial_mode': 'view',
            },
        }

    def action_view_my_students(self):
        self.ensure_one()
        class_ids = self.assignment_ids.filtered(lambda a: a.active).mapped('class_id').ids
        return {
            'type': 'ir.actions.act_window',
            'name': 'My Students',
            'res_model': 'school.student',
            'view_mode': 'list,form,kanban',
            'domain': [('class_id', 'in', class_ids)],
        }

    def action_view_my_schedule(self):
        self.ensure_one()
        return {
            'type': 'ir.actions.act_window',
            'name': 'My Class Schedule',
            'res_model': 'school.class.schedule',
            'view_mode': 'calendar,list,form',
            'domain': [('teacher_id', '=', self.id)],
        }

    def action_view_my_attendance(self):
        self.ensure_one()
        class_ids = self.assignment_ids.filtered(lambda a: a.active).mapped('class_id').ids
        return {
            'type': 'ir.actions.act_window',
            'name': 'Class Attendance',
            'res_model': 'school.attendance',
            'view_mode': 'list,form',
            'domain': [('class_id', 'in', class_ids)],
        }

    def action_view_my_marks(self):
        self.ensure_one()
        class_ids = self.assignment_ids.filtered(lambda a: a.active).mapped('class_id').ids
        subject_ids = self.assignment_ids.filtered(lambda a: a.active).mapped('subject_id').ids
        return {
            'type': 'ir.actions.act_window',
            'name': 'Mark List Analysis',
            'res_model': 'school.mark',
            'view_mode': 'list,form,graph,pivot',
            'domain': [('class_id', 'in', class_ids), ('subject_id', 'in', subject_ids)],
        }

    @api.constrains('staff_id')
    def _check_staff_active(self):
        for rec in self:
            if rec.staff_id:
                if (not rec.staff_id.active or rec.staff_id.state != 'active' or
                    rec.staff_id.employment_status != 'active'):
                    raise ValidationError('A teacher profile must be linked to an active staff record.')
                if rec.staff_id.department != 'academic' and rec.staff_id.primary_responsibility not in ('teacher', 'homeroom', 'department_head', 'coordinator'):
                    raise ValidationError('Selected staff member must be a teacher or academic staff member.')

    # =========================================================================
    # ORM OVERRIDES & USER CREATION
    # =========================================================================
    @api.model_create_multi
    def create(self, vals_list):
        for vals in vals_list:
            if vals.get('teacher_id', 'New') == 'New':
                vals['teacher_id'] = self.env['ir.sequence'].next_by_code('school.teacher') or 'New'
        passwords = [vals.pop('login_password', None) for vals in vals_list]
        teachers = super().create(vals_list)
        for teacher, password in zip(teachers, passwords):
            teacher._create_teacher_user(password=password)
        return teachers

    def _create_teacher_user(self, password=None):
        self.ensure_one()
        if self.user_id:
            return
        if not self.staff_id.email:
            raise ValidationError(
                'The linked staff record needs an email address before a login can be created for %s.'
                % self.name
            )
        Users = self.env['res.users'].sudo()
        teacher_group = self.env.ref('school_management.group_school_teacher', raise_if_not_found=False)
        internal_group = self.env.ref('base.group_user')
        groups = [(4, internal_group.id)]
        if teacher_group:
            groups.append((4, teacher_group.id))
        user_vals = {
            'name': self.name,
            'login': self.staff_id.email,
            'email': self.staff_id.email,
            'group_ids': groups,
        }
        if password:
            user_vals['password'] = password
        user = Users.create(user_vals)
        if not password:
            user.action_reset_password()
        self.user_id = user.id
        if not self.staff_id.user_id:
            self.staff_id.user_id = user.id

    def action_create_login_user(self):
        """Clicking the button saves the form first, so a typed password has already
        been applied by _inverse_login_password and the login already exists. Reading
        login_password here would only ever return the computed False."""
        for teacher in self:
            teacher._create_teacher_user()