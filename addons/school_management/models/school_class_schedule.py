from odoo import _, api, fields, models
from odoo.exceptions import ValidationError

DAY_OF_WEEK = [
    ('0', 'Monday'),
    ('1', 'Tuesday'),
    ('2', 'Wednesday'),
    ('3', 'Thursday'),
    ('4', 'Friday'),
    ('5', 'Saturday'),
    ('6', 'Sunday'),
]

# Resource fields checked for double booking, and the wording used in the error.
CONFLICT_RESOURCES = [
    ('teacher_id', 'teacher'),
    ('class_id', 'class/section'),
    ('room_id', 'room'),
]

# A cancelled slot frees its teacher, class, and room; every other status still occupies them.
FREE_STATES = ('cancelled',)


class SchoolClassSchedule(models.Model):
    _name = 'school.class.schedule'
    _description = 'Class Schedule'
    _inherit = ['mail.thread']
    # academic_year_id resolves through school.academic.year._order ('name desc'),
    # so it already sorts newest-first; adding desc here would invert it.
    _order = 'academic_year_id, term_id, day_of_week, start_time'

    class_id = fields.Many2one(
        'school.class', string='Grade / Class',
        required=True, ondelete='restrict', tracking=True,
    )
    section_id = fields.Many2one(
        'school.section', related='class_id.section_id', string='Section', readonly=True,
    )
    academic_year_id = fields.Many2one(
        'school.academic.year', related='class_id.academic_year_id',
        string='Academic Year', store=True, readonly=True,
    )
    term_id = fields.Many2one(
        'school.term', string='Term', required=True,
        ondelete='restrict', index=True, tracking=True,
    )

    teacher_assignment_id = fields.Many2one(
        'school.teacher.assignment', string='Teacher Assignment',
        ondelete='restrict', index=True,
        domain="[('class_id', '=', class_id), ('subject_id', '=', subject_id), ('term_id', '=', term_id), ('state', '=', 'active')]",
    )

    subject_id = fields.Many2one(
        'school.subject', string='Subject',
        required=True, ondelete='restrict', tracking=True,
    )
    teacher_id = fields.Many2one(
        'school.teacher', string='Teacher',
        required=True, ondelete='restrict', tracking=True,
    )

    day_of_week = fields.Selection(
        DAY_OF_WEEK, string='Day of Week', required=True, tracking=True,
        help='The weekday this class repeats on for the whole term.',
    )
    start_time = fields.Float(string='Start Time', required=True, tracking=True)
    end_time = fields.Float(string='End Time', required=True, tracking=True)

    room_id = fields.Many2one('school.room', string='Room', ondelete='restrict', tracking=True)
    schedule_type = fields.Selection([
        ('regular', 'Regular Class'),
        ('tutorial', 'Tutorial'),
        ('laboratory', 'Laboratory'),
        ('examination', 'Examination'),
        ('makeup', 'Makeup Class'),
        ('other', 'Other'),
    ], string='Schedule Type', default='regular', required=True)

    state = fields.Selection([
        ('draft', 'Draft'),
        ('published', 'Published'),
        ('cancelled', 'Cancelled'),
        ('completed', 'Completed'),
        ('rescheduled', 'Rescheduled'),
    ], string='Status', default='draft', required=True, tracking=True)
    notes = fields.Text(string='Notes')
    reschedule_reason = fields.Text(string='Reschedule Reason', tracking=True)
    active = fields.Boolean(string='Active', default=True)

    @api.onchange('class_id')
    def _onchange_class_id(self):
        for rec in self:
            if rec.term_id and rec.term_id.academic_year_id != rec.class_id.academic_year_id:
                rec.term_id = False
            if rec.subject_id and rec.class_id and not self.env['school.grade.subject'].search_count([
                    ('class_id', '=', rec.class_id.id),
                    ('subject_id', '=', rec.subject_id.id), ('active', '=', True)]):
                rec.subject_id = False
            rec.teacher_assignment_id = False
            rec.teacher_id = False

    @api.onchange('subject_id', 'term_id')
    def _onchange_schedule_scope(self):
        self.teacher_assignment_id = False
        self.teacher_id = False
        assignments = self._matching_assignments()
        if len(assignments) == 1:
            self.teacher_assignment_id = assignments
            self.teacher_id = assignments.teacher_id

    def _matching_assignments(self):
        self.ensure_one()
        if not (self.class_id and self.subject_id and self.term_id):
            return self.env['school.teacher.assignment']
        return self.env['school.teacher.assignment'].search([
            ('class_id', '=', self.class_id.id),
            ('subject_id', '=', self.subject_id.id),
            ('term_id', '=', self.term_id.id),
            ('state', '=', 'active'),
        ])

    @api.onchange('teacher_assignment_id')
    def _onchange_teacher_assignment_id(self):
        for rec in self.filtered('teacher_assignment_id'):
            rec.class_id = rec.teacher_assignment_id.class_id
            rec.subject_id = rec.teacher_assignment_id.subject_id
            rec.term_id = rec.teacher_assignment_id.term_id
            rec.teacher_id = rec.teacher_assignment_id.teacher_id

    _schedule_end_after_start = models.Constraint(
        'CHECK(end_time > start_time)',
        'End time must be after the start time.',
    )
    _schedule_time_within_day = models.Constraint(
        'CHECK(start_time >= 0 AND end_time <= 24)',
        'Times must fall between 00:00 and 24:00.',
    )

    @api.depends('subject_id', 'class_id', 'day_of_week', 'start_time')
    def _compute_display_name(self):
        days = dict(DAY_OF_WEEK)
        for rec in self:
            if not rec.subject_id or not rec.class_id:
                rec.display_name = _('New')
                continue
            when = days.get(rec.day_of_week, '')
            hours, minutes = divmod(round(rec.start_time * 60), 60)
            rec.display_name = (
                f'{rec.subject_id.name} - {rec.class_id.display_name} '
                f'({when} {hours:02d}:{minutes:02d})'
            )

    @api.constrains('teacher_assignment_id', 'teacher_id', 'subject_id', 'class_id',
                    'term_id', 'academic_year_id')
    def _check_teacher_assignment(self):
        for rec in self:
            assignment = rec.teacher_assignment_id
            if assignment.teacher_id != rec.teacher_id \
                    or assignment.subject_id != rec.subject_id \
                    or assignment.class_id != rec.class_id \
                    or assignment.academic_year_id != rec.academic_year_id \
                    or assignment.term_id != rec.term_id \
                    or assignment.state != 'active':
                raise ValidationError(
                    'The schedule must use one exact active teacher assignment.'
                )

    @api.model_create_multi
    def create(self, vals_list):
        for vals in vals_list:
            if not vals.get('teacher_assignment_id') and all(
                    vals.get(field) for field in ('teacher_id', 'subject_id', 'class_id', 'term_id')):
                assignment = self.env['school.teacher.assignment'].search([
                    ('teacher_id', '=', vals['teacher_id']),
                    ('subject_id', '=', vals['subject_id']),
                    ('class_id', '=', vals['class_id']),
                    ('term_id', '=', vals['term_id']),
                    ('state', '=', 'active'),
                ], limit=1)
                if assignment:
                    vals['teacher_assignment_id'] = assignment.id
            if not vals.get('teacher_assignment_id'):
                raise ValidationError(
                    'Select the exact active teacher assignment for this schedule.')
        return super().create(vals_list)

    @api.constrains('state', 'teacher_id', 'subject_id', 'class_id')
    def _check_published_records_are_active(self):
        for rec in self:
            if rec.state != 'published':
                continue
            if not rec.teacher_id.active or rec.teacher_id.teaching_status != 'active':
                raise ValidationError('An inactive teacher cannot be used for a published schedule.')
            if not rec.subject_id.active:
                raise ValidationError('An inactive subject cannot be used for a published schedule.')
            if not rec.class_id.active:
                raise ValidationError('An archived class cannot be used for a published schedule.')

    @api.constrains('state', 'reschedule_reason')
    def _check_reschedule_reason(self):
        for rec in self:
            if rec.state == 'rescheduled' and not rec.reschedule_reason:
                raise ValidationError(
                    'Give a reschedule reason. The previous day, date, and times stay in the log.'
                )

    @api.constrains('teacher_id', 'class_id', 'room_id', 'day_of_week',
                    'start_time', 'end_time', 'state', 'term_id', 'academic_year_id')
    def _check_no_double_booking(self):
        for rec in self:
            if rec.state in FREE_STATES:
                continue
            for field, label in CONFLICT_RESOURCES:
                resource = rec[field]
                # Room control is "enabled" per record: no room set, nothing to reserve.
                if not resource:
                    continue
                clash = self.search(rec._same_slot_domain() + [(field, '=', resource.id)], limit=1)
                if clash:
                    raise ValidationError(
                        f'{resource.display_name} is already booked at this time by '
                        f'"{clash.display_name}". Change the {label}, the time, or the room.'
                    )

    def _same_slot_domain(self):
        """Records that share this record's calendar slot and overlap it in time."""
        self.ensure_one()
        domain = [
            ('id', '!=', self.id),
            ('state', 'not in', FREE_STATES),
            ('start_time', '<', self.end_time),
            ('end_time', '>', self.start_time),
        ]
        return domain + [
            ('day_of_week', '=', self.day_of_week),
            ('academic_year_id', '=', self.academic_year_id.id),
            ('term_id', '=', self.term_id.id),
        ]

    def _conflicting_ids(self):
        """Ids of live slots that share a teacher, class, or room with another slot.
        The create/write constraint blocks new clashes, so this only ever surfaces rows
        that predate the constraint or were loaded around it.
        ponytail: O(n) searches over live slots; fine at school scale."""
        conflicting = set()
        for rec in self.search([('state', 'not in', FREE_STATES)]):
            for field, _label in CONFLICT_RESOURCES:
                resource = rec[field]
                if resource and self.search_count(
                    rec._same_slot_domain() + [(field, '=', resource.id)]
                ):
                    conflicting.add(rec.id)
                    break
        return sorted(conflicting)

    def action_publish(self):
        self.write({'state': 'published'})

    def action_cancel(self):
        self.write({'state': 'cancelled'})

    def action_complete(self):
        self.write({'state': 'completed'})

    def action_reset_draft(self):
        self.write({'state': 'draft'})
