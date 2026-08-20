from odoo import api, fields, models
from odoo.exceptions import AccessError, ValidationError


class SchoolEnrollmentPlacement(models.Model):
    _name = 'school.enrollment.placement'
    _description = 'Effective-Dated Enrollment Placement'
    _inherit = ['mail.thread']
    _order = 'date_start desc, id desc'

    enrollment_id = fields.Many2one(
        'school.enrollment', required=True, ondelete='restrict', index=True)
    student_id = fields.Many2one(
        related='enrollment_id.student_id', store=True, index=True)
    academic_year_id = fields.Many2one(
        related='enrollment_id.academic_year_id', store=True, index=True)
    class_id = fields.Many2one(
        'school.class', required=True, ondelete='restrict', index=True, tracking=True)
    section_id = fields.Many2one(related='class_id.section_id', store=True)
    shift_id = fields.Many2one('school.shift', ondelete='restrict')
    stream_id = fields.Many2one('school.stream', ondelete='restrict')
    roll_number = fields.Integer(required=True, tracking=True)
    date_start = fields.Date(required=True, tracking=True)
    date_end = fields.Date(tracking=True)
    transfer_reason = fields.Text()
    is_effective = fields.Boolean(compute='_compute_is_effective', search='_search_is_effective')

    _placement_roll_positive = models.Constraint(
        'CHECK(roll_number > 0)',
        'A placement roll number must be positive.',
    )
    _placement_date_order = models.Constraint(
        'CHECK(date_end IS NULL OR date_end >= date_start)',
        'Placement end date cannot be before its start date.',
    )

    @api.depends('date_start', 'date_end')
    def _compute_is_effective(self):
        today = fields.Date.context_today(self)
        for rec in self:
            rec.is_effective = rec.date_start <= today and (not rec.date_end or rec.date_end >= today)

    def _search_is_effective(self, operator, value):
        # Odoo rewrites ('field', '=', True) into ('field', 'in', [True]) before the
        # search method runs, so both forms have to be handled.
        if operator in ('in', 'not in'):
            wanted = any(value) if isinstance(value, (list, tuple, set)) else bool(value)
            is_active = (operator == 'in') == wanted
        elif operator in ('=', '!='):
            is_active = (operator == '=') == bool(value)
        else:
            raise ValidationError('Active placement only supports equality searches.')
        today = fields.Date.context_today(self)
        active_domain = [('date_start', '<=', today), '|', ('date_end', '=', False),
                         ('date_end', '>=', today)]
        return active_domain if is_active else ['!', *active_domain]

    @api.constrains('enrollment_id', 'class_id', 'date_start', 'date_end', 'roll_number')
    def _check_effective_placement(self):
        for rec in self:
            if rec.class_id.academic_year_id != rec.enrollment_id.academic_year_id:
                raise ValidationError('The placement class must belong to the enrollment year.')
            if rec.date_start < rec.enrollment_id.enrollment_date:
                raise ValidationError('A placement cannot predate its enrollment.')
            if rec.enrollment_id.end_date and (
                    not rec.date_end or rec.date_end > rec.enrollment_id.end_date):
                raise ValidationError('A placement cannot extend beyond its enrollment.')
            overlap = self.search([
                ('id', '!=', rec.id), ('enrollment_id', '=', rec.enrollment_id.id),
                ('date_start', '<=', rec.date_end or fields.Date.to_date('9999-12-31')),
                '|', ('date_end', '=', False), ('date_end', '>=', rec.date_start),
            ], limit=1)
            if overlap:
                override = rec.enrollment_id.override_ids.filtered(
                    lambda item: item.active and item.operation == 'placement')
                if not override:
                    raise ValidationError('Enrollment placements cannot overlap.')
            roll_clash = self.search([
                ('id', '!=', rec.id), ('class_id', '=', rec.class_id.id),
                ('roll_number', '=', rec.roll_number),
                ('date_start', '<=', rec.date_end or fields.Date.to_date('9999-12-31')),
                '|', ('date_end', '=', False), ('date_end', '>=', rec.date_start),
            ], limit=1)
            if roll_clash:
                override = rec.enrollment_id.override_ids.filtered(
                    lambda item: item.active and item.operation == 'roll_number')
                if not override:
                    raise ValidationError('That roll number is already used during this period.')

    def placement_on(self, date):
        return self.filtered(
            lambda p: p.date_start <= date and (not p.date_end or p.date_end >= date))[:1]

    def unlink(self):
        raise ValidationError('Placement history cannot be deleted. Correct it with effective dates.')


class SchoolEnrollmentOverride(models.Model):
    _name = 'school.enrollment.override'
    _description = 'Authorized Enrollment Override'
    _inherit = ['mail.thread']
    _order = 'create_date desc'

    enrollment_id = fields.Many2one(
        'school.enrollment', required=True, ondelete='restrict', index=True)
    operation = fields.Selection([
        ('capacity', 'Capacity'), ('roll_number', 'Roll Number'),
        ('placement', 'Placement Date'),
    ], required=True)
    reason = fields.Text(required=True)
    approved_by_id = fields.Many2one(
        'res.users', required=True, readonly=True, default=lambda self: self.env.user)
    approved_at = fields.Datetime(required=True, readonly=True, default=fields.Datetime.now)
    active = fields.Boolean(default=True)

    @api.model_create_multi
    def create(self, vals_list):
        if not self.env.su and not self.env.user.has_group(
                'school_management.group_school_director'):
            raise AccessError('Only a Principal or School Administrator can approve overrides.')
        if not self.env.company.school_capacity_override:
            raise ValidationError('Enrollment overrides are disabled in School Settings.')
        return super().create(vals_list)

    def unlink(self):
        raise ValidationError('Override approvals are audit records and cannot be deleted.')


class SchoolPromotionWizard(models.TransientModel):
    _name = 'school.promotion.wizard'
    _description = 'Promote Student'

    enrollment_id = fields.Many2one(
        'school.enrollment', required=True, domain=[('state', '=', 'active')])
    next_academic_year_id = fields.Many2one(
        'school.academic.year', string='Next Academic Year', required=True,
        default=lambda self: self._default_next_year())
    next_class_id = fields.Many2one(
        'school.class', string='Next Class', ondelete='restrict',
        help='Leave empty to move the student up one grade, keeping their section.')
    next_class_note = fields.Char(compute='_compute_next_class_note')
    current_academic_year_id = fields.Many2one(
        related='enrollment_id.academic_year_id', readonly=True)
    student_id = fields.Many2one(related='enrollment_id.student_id', readonly=True)
    current_class_id = fields.Many2one(related='enrollment_id.class_id', readonly=True)
    effective_date = fields.Date(required=True, default=lambda self: fields.Date.context_today(self))
    setup_warning = fields.Char(compute='_compute_setup_warning')

    @api.model
    def _default_next_year(self):
        current = self.env['school.academic.year']._default_year()
        later = self.env['school.academic.year'].search(
            [('date_start', '>', current.date_start or '1900-01-01')],
            order='date_start', limit=1)
        return later or self.env['school.academic.year']

    def _next_grade(self):
        self.ensure_one()
        grade = self.enrollment_id.class_id.grade_id
        if not grade or not grade.level.isdigit():
            return self.env['school.grade']
        return self.env['school.grade'].search(
            [('level', '=', str(int(grade.level) + 1))], limit=1)

    def _resolve_next_class(self):
        """The class the student moves into: the one picked, or the next grade in the
        chosen year, created with the same section if it does not exist yet."""
        self.ensure_one()
        if self.next_class_id:
            return self.next_class_id
        grade = self._next_grade()
        if not grade:
            raise ValidationError(
                '%s is in the final grade. Complete or graduate the enrollment instead.'
                % self.enrollment_id.student_id.name)
        section = self.enrollment_id.class_id.section_id.name or ''
        return self.env['school.class']._ensure_sections(
            grade, self.next_academic_year_id, [section])

    @api.depends('next_class_id', 'next_academic_year_id', 'enrollment_id')
    def _compute_next_class_note(self):
        for wizard in self:
            wizard.next_class_note = False
            if wizard.next_class_id or not wizard.enrollment_id:
                continue
            grade = wizard._next_grade()
            if not grade or not wizard.next_academic_year_id:
                continue
            section = wizard.enrollment_id.class_id.section_id.name
            name = '%s %s' % (grade.name, section) if section else grade.name
            wizard.next_class_note = (
                '%s does not exist yet in %s. It will be created with the subjects of %s.'
                % (name, wizard.next_academic_year_id.name,
                   wizard.enrollment_id.class_id.display_name))

    @api.onchange('next_academic_year_id', 'enrollment_id')
    def _onchange_next_academic_year_id(self):
        """Offer the natural destination as soon as the year is known, so the field
        is a suggestion to confirm rather than a blank to work out."""
        self.next_class_id = False
        if not (self.enrollment_id and self.next_academic_year_id):
            return
        grade = self._next_grade()
        if not grade:
            return
        section = self.enrollment_id.class_id.section_id
        existing = self.env['school.class'].search([
            ('grade_id', '=', grade.id),
            ('academic_year_id', '=', self.next_academic_year_id.id),
            ('section_id', '=', section.id or False),
            ('active', '=', True),
        ], limit=1) or self.env['school.class'].search([
            ('grade_id', '=', grade.id),
            ('academic_year_id', '=', self.next_academic_year_id.id),
            ('active', '=', True),
        ], limit=1)
        self.next_class_id = existing

    @api.depends('next_class_id', 'enrollment_id', 'next_academic_year_id')
    def _compute_setup_warning(self):
        for wizard in self:
            wizard.setup_warning = False
            if wizard.next_academic_year_id and not self.env['school.term'].search_count([
                    ('academic_year_id', '=', wizard.next_academic_year_id.id)]):
                wizard.setup_warning = (
                    '%s has no terms yet. Add them under Administration - School Setup '
                    'before recording attendance or marks in that year.'
                    % wizard.next_academic_year_id.name)

    def action_confirm(self):
        self.ensure_one()
        old = self.enrollment_id
        target = self._resolve_next_class()
        if target.academic_year_id == old.academic_year_id:
            raise ValidationError('Promotion must create an enrollment in the next academic year.')
        if self.effective_date < old.enrollment_date:
            raise ValidationError(
                'The promotion cannot take effect before the current enrollment started (%s).'
                % old.enrollment_date)
        if self.env['school.enrollment'].search_count([
                ('student_id', '=', old.student_id.id),
                ('academic_year_id', '=', target.academic_year_id.id)]):
            raise ValidationError(
                '%s is already enrolled for %s.'
                % (old.student_id.name, target.academic_year_id.name))
        self._copy_curriculum(old.class_id, target)
        old.action_complete()
        new = self.env['school.enrollment'].create({
            'student_id': old.student_id.id,
            'class_id': target.id,
            'enrollment_date': self.effective_date,
            'admission_type': 'returning',
        })
        new.action_activate()
        return {
            'type': 'ir.actions.act_window', 'res_model': 'school.enrollment',
            'view_mode': 'form', 'res_id': new.id,
        }

    @api.model
    def _copy_curriculum(self, source, target):
        """A brand new destination starts with the subjects of the class the student
        is leaving, so a promoted student never lands with an empty roster."""
        Curriculum = self.env['school.grade.subject']
        if Curriculum.search_count([('class_id', '=', target.id)]):
            return
        for row in Curriculum.search([('class_id', '=', source.id), ('active', '=', True)]):
            Curriculum.create({
                'class_id': target.id,
                'subject_id': row.subject_id.id,
                'subject_type': row.subject_type,
                'maximum_mark': row.maximum_mark,
                'pass_mark': row.pass_mark,
            })
