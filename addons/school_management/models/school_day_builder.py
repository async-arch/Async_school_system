from odoo import api, fields, models
from odoo.exceptions import ValidationError

from .school_class_schedule import DAY_OF_WEEK


class SchoolDayBuilder(models.TransientModel):
    _name = 'school.day.builder'
    _description = 'Build a Day of Class Periods'

    class_id = fields.Many2one(
        'school.class', string='Grade / Class', required=True, ondelete='cascade',
        default=lambda self: self.env.context.get('default_class_id')
        or self.env.context.get('active_id'),
    )
    term_id = fields.Many2one(
        'school.term', string='Term', required=True, ondelete='cascade',
        domain="[('academic_year_id', '=', academic_year_id)]",
    )
    academic_year_id = fields.Many2one(
        'school.academic.year', related='class_id.academic_year_id', readonly=True)
    day_of_week = fields.Selection(DAY_OF_WEEK, string='Day', required=True, default='0')
    repeat_day_ids = fields.Many2many(
        'school.weekday', string='Also Copy To',
        help='The same periods are created on these days as well.')
    first_start_time = fields.Float(string='First Period Starts', default=8.0)
    period_minutes = fields.Integer(string='Period Length (minutes)', default=45)
    break_minutes = fields.Integer(string='Break Between Periods (minutes)', default=0)
    default_room_id = fields.Many2one('school.room', string='Default Room')
    state = fields.Selection([
        ('draft', 'Draft'), ('published', 'Published'),
    ], string='Create As', default='published', required=True)
    line_ids = fields.One2many('school.day.builder.line', 'builder_id', string='Periods')

    setup_warning = fields.Char(compute='_compute_setup_warning')
    schedulable_subject_ids = fields.Many2many(
        'school.subject', compute='_compute_schedulable_subject_ids',
        help='Subjects on this class curriculum that also have an active teacher '
             'assignment for the selected term.')

    @api.depends('class_id', 'term_id')
    def _compute_schedulable_subject_ids(self):
        for wizard in self:
            curriculum = self.env['school.grade.subject'].search([
                ('class_id', '=', wizard.class_id.id), ('active', '=', True)])
            assigned = self.env['school.teacher.assignment'].search([
                ('class_id', '=', wizard.class_id.id),
                ('term_id', '=', wizard.term_id.id),
                ('state', '=', 'active')]).subject_id
            wizard.schedulable_subject_ids = curriculum.subject_id & assigned

    @api.depends('class_id', 'term_id')
    def _compute_setup_warning(self):
        for wizard in self:
            wizard.setup_warning = False
            if not wizard.class_id:
                continue
            curriculum = self.env['school.grade.subject'].search([
                ('class_id', '=', wizard.class_id.id), ('active', '=', True)])
            if not curriculum:
                wizard.setup_warning = (
                    '%s has no subjects yet. Open the class and add them on the '
                    'Subjects tab before building a day.' % wizard.class_id.display_name)
                continue
            if not wizard.term_id:
                continue
            assigned = self.env['school.teacher.assignment'].search([
                ('class_id', '=', wizard.class_id.id),
                ('term_id', '=', wizard.term_id.id),
                ('state', '=', 'active')]).subject_id
            missing = curriculum.subject_id - assigned
            if missing:
                wizard.setup_warning = (
                    'No teacher is assigned for %s in %s. Those periods cannot be '
                    'created until you add the assignment.'
                    % (', '.join(missing.mapped('name')), wizard.term_id.name))

    @api.onchange('class_id')
    def _onchange_class_id(self):
        if self.term_id.academic_year_id != self.academic_year_id:
            self.term_id = self.env['school.term'].search([
                ('academic_year_id', '=', self.academic_year_id.id)], limit=1)

    @api.onchange('first_start_time', 'period_minutes', 'break_minutes', 'line_ids')
    def _onchange_times(self):
        self._chain_times()

    def _chain_times(self):
        start = self.first_start_time
        step = self.period_minutes / 60.0
        gap = self.break_minutes / 60.0
        for line in self.line_ids.sorted('sequence'):
            line.start_time = start
            line.end_time = start + step
            start = line.end_time + gap

    def _days(self):
        return sorted({self.day_of_week} | set(self.repeat_day_ids.mapped('code')))

    def action_build(self):
        self.ensure_one()
        if not self.line_ids:
            raise ValidationError('Add at least one period.')
        self._chain_times()
        Schedule = self.env['school.class.schedule']
        created = Schedule.browse()
        for day in self._days():
            for line in self.line_ids.sorted('sequence'):
                assignment = line._assignment()
                if not assignment:
                    raise ValidationError(
                        '%s has no active teacher assignment for %s in %s. Create the '
                        'assignment first, or drop that period.'
                        % (line.subject_id.name, self.class_id.display_name, self.term_id.name))
                created |= Schedule.create({
                    'class_id': self.class_id.id,
                    'term_id': self.term_id.id,
                    'subject_id': line.subject_id.id,
                    'teacher_id': assignment.teacher_id.id,
                    'teacher_assignment_id': assignment.id,
                    'room_id': (line.room_id or self.default_room_id).id,
                    'schedule_type': line.schedule_type,
                    'day_of_week': day,
                    'start_time': line.start_time,
                    'end_time': line.end_time,
                    'state': self.state,
                })
        return self.class_id.action_open_timetable()


class SchoolDayBuilderLine(models.TransientModel):
    _name = 'school.day.builder.line'
    _description = 'Day Builder Period'
    _order = 'sequence, id'

    builder_id = fields.Many2one('school.day.builder', required=True, ondelete='cascade')
    sequence = fields.Integer(default=10)
    subject_id = fields.Many2one(
        'school.subject', string='Subject', required=True, ondelete='cascade')
    teacher_id = fields.Many2one(
        'school.teacher', string='Teacher', compute='_compute_teacher_id')
    start_time = fields.Float(string='Start')
    end_time = fields.Float(string='End')
    room_id = fields.Many2one('school.room', string='Room')
    schedule_type = fields.Selection([
        ('regular', 'Regular Class'),
        ('tutorial', 'Tutorial'),
        ('laboratory', 'Laboratory'),
        ('examination', 'Examination'),
        ('makeup', 'Makeup Class'),
        ('other', 'Other'),
    ], string='Type', default='regular', required=True)

    @api.depends('subject_id', 'builder_id.class_id', 'builder_id.term_id')
    def _compute_teacher_id(self):
        for line in self:
            line.teacher_id = line._assignment().teacher_id

    def _assignment(self):
        self.ensure_one()
        builder = self.builder_id
        if not (self.subject_id and builder.class_id and builder.term_id):
            return self.env['school.teacher.assignment']
        return self.env['school.teacher.assignment'].search([
            ('class_id', '=', builder.class_id.id),
            ('subject_id', '=', self.subject_id.id),
            ('term_id', '=', builder.term_id.id),
            ('state', '=', 'active'),
        ], limit=1)


class SchoolWeekday(models.Model):
    _name = 'school.weekday'
    _description = 'Weekday'
    _order = 'code'

    name = fields.Char(required=True)
    code = fields.Char(required=True)

    _weekday_code_unique = models.Constraint('unique(code)', 'That weekday already exists.')
