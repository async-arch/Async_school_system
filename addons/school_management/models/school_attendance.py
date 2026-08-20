from odoo import api, fields, models
from odoo.exceptions import ValidationError


class SchoolAttendance(models.Model):
    """Daily class attendance, anchored to the enrollment (SRS §8.2).

    The enrollment is what makes a student attendable: no active enrollment,
    no attendance row (BR-07), and no row outside the enrollment's effective
    dates (BR-09). student_id and class_id are snapshotted from the
    enrollment — the old related class_id followed the student's *current*
    class and silently rewrote history on every class change.
    """
    _name = "school.attendance"
    _description = "Student Attendance"
    _order = "date desc"

    enrollment_id = fields.Many2one(
        "school.enrollment",
        string="Enrollment",
        required=True,
        index=True,
        ondelete="restrict",
        help="Derived from the student's active enrollment when left empty."
    )
    placement_id = fields.Many2one(
        'school.enrollment.placement', required=True, index=True, ondelete='restrict')

    student_id = fields.Many2one(
        "school.student",
        string="Student",
        required=True,
        index=True,
        domain="[('registration_status', '=', 'approved'), ('enrollment_ids.state', '=', 'active')]",
    )

    class_id = fields.Many2one(
        "school.class",
        string="Class",
        index=True
    )

    date = fields.Date(
        string="Date",
        required=True,
        default=fields.Date.context_today
    )
    attendance_type = fields.Selection([
        ('daily', 'Daily Class Attendance'), ('subject', 'Subject / Period Attendance'),
    ], default='daily', required=True, index=True)
    teacher_assignment_id = fields.Many2one(
        'school.teacher.assignment', ondelete='restrict', index=True)
    student_subject_id = fields.Many2one(
        'school.student.subject', ondelete='restrict', index=True)
    period = fields.Char()

    status = fields.Selection(
        [
            ("not_recorded", "Not Recorded"),
            ("present", "Present"),
            ("absent", "Absent"),
            ("late", "Late"),
            ("excused", "Excused"),
            ("sick", "Sick"),
            ("official_duty", "Official Duty"),
            ("half_day", "Half Day"),
        ],
        string="Status",
        required=True,
        default="present"
    )

    note = fields.Text(
        string="Remarks"
    )
    arrival_time = fields.Float()
    recorded_by_id = fields.Many2one(
        'res.users', required=True, readonly=True, default=lambda self: self.env.user)
    recorded_at = fields.Datetime(required=True, readonly=True, default=fields.Datetime.now)

    _daily_or_subject_identity_unique = models.Constraint(
        'unique(student_id, date, attendance_type, teacher_assignment_id, period)',
        'Attendance already exists for this student in that session.',
    )

    @api.model_create_multi
    def create(self, vals_list):
        for vals in vals_list:
            self._complete_from_enrollment(vals)
        return super().create(vals_list)

    def write(self, vals):
        if {'enrollment_id', 'student_id', 'date', 'attendance_type',
                'teacher_assignment_id', 'student_subject_id'} & vals.keys():
            self._complete_from_enrollment(vals)
        return super().write(vals)

    def _complete_from_enrollment(self, vals):
        """The enrollment is the source of truth: fill it from the student's
        active enrollment when absent, then snapshot student and class."""
        Enrollment = self.env['school.enrollment']
        if not vals.get('enrollment_id'):
            student_id = vals.get('student_id') or (len(self) == 1 and self.student_id.id)
            enrollment = Enrollment.search([
                ('student_id', '=', student_id),
                ('state', '=', 'active'),
            ], limit=1)
            if not enrollment:
                student = self.env['school.student'].browse(student_id)
                raise ValidationError(
                    '%s has no active enrollment, so attendance cannot be '
                    'recorded. Enroll the student first.' % (student.name or 'The student')
                )
            vals['enrollment_id'] = enrollment.id
        else:
            enrollment = Enrollment.browse(vals['enrollment_id'])
        date = fields.Date.to_date(vals.get('date') or (
            len(self) == 1 and self.date) or fields.Date.context_today(self))
        placement = enrollment.placement_ids.placement_on(date)
        if not placement:
            raise ValidationError(
                '%s has no effective placement on %s.' % (enrollment.student_id.name, date))
        vals['placement_id'] = placement.id
        vals['student_id'] = enrollment.student_id.id
        vals['class_id'] = placement.class_id.id
        if not vals.get('teacher_assignment_id'):
            assignment = self.env['school.teacher.assignment'].search([
                ('class_id', '=', placement.class_id.id),
                ('state', '=', 'active'), ('start_date', '<=', date),
                '|', ('end_date', '=', False), ('end_date', '>=', date),
            ], limit=1)
            if assignment:
                vals['teacher_assignment_id'] = assignment.id
        if vals.get('attendance_type', len(self) == 1 and self.attendance_type) == 'subject':
            if not self.env.company.school_subject_attendance:
                raise ValidationError('Subject attendance is disabled in School Settings.')
            assignment = self.env['school.teacher.assignment'].browse(
                vals.get('teacher_assignment_id') or (
                    len(self) == 1 and self.teacher_assignment_id.id))
            student_subject = self.env['school.student.subject'].browse(
                vals.get('student_subject_id') or (
                    len(self) == 1 and self.student_subject_id.id))
            if not assignment or assignment.class_id != placement.class_id:
                raise ValidationError('Subject attendance requires an exact class assignment.')
            if assignment.subject_id != student_subject.subject_id:
                raise ValidationError('The student is not enrolled in the assigned subject.')
            if student_subject.student_id != enrollment.student_id \
                    or student_subject.enrollment_id != enrollment \
                    or student_subject.state != 'enrolled' \
                    or student_subject.date_start > date \
                    or (student_subject.date_end and student_subject.date_end < date):
                raise ValidationError(
                    'The subject enrollment must belong to this student and be effective on the attendance date.')
            if assignment.start_date > date or (assignment.end_date and assignment.end_date < date):
                raise ValidationError('The teacher assignment is not effective on this date.')

    @api.onchange('student_id', 'date')
    def _onchange_student_id(self):
        if not self.student_id:
            return
        vals = {'student_id': self.student_id.id, 'date': self.date}
        self._complete_from_enrollment(vals)
        self.enrollment_id = vals['enrollment_id']
        self.placement_id = vals['placement_id']
        self.class_id = vals['class_id']

    @api.constrains('date', 'class_id')
    def _check_date_within_term(self):
        for rec in self:
            year = rec.class_id.academic_year_id
            terms = self.env['school.term'].search([('academic_year_id', '=', year.id)])
            if not terms:
                raise ValidationError(
                    '%s has no terms, so attendance cannot be recorded for %s.'
                    % (year.display_name, rec.class_id.display_name))
            if not terms.filtered(lambda t: t.date_start <= rec.date <= t.date_end):
                raise ValidationError(
                    '%s is outside every term of %s (%s). Attendance is only '
                    'recorded on teaching days.'
                    % (rec.date, year.display_name,
                       ', '.join('%s %s to %s' % (t.name, t.date_start, t.date_end)
                                 for t in terms)))

    @api.constrains('enrollment_id', 'placement_id', 'student_id', 'class_id', 'date')
    def _check_date_within_enrollment(self):
        for rec in self:
            placement = rec.enrollment_id.placement_ids.placement_on(rec.date)
            if rec.student_id != rec.enrollment_id.student_id \
                    or not placement or rec.placement_id != placement \
                    or rec.class_id != placement.class_id:
                raise ValidationError(
                    'Attendance student and class must match the effective enrollment placement.')
            if rec.date < rec.enrollment_id.enrollment_date:
                raise ValidationError(
                    'Attendance on %s is before the enrollment of %s started (%s).'
                    % (rec.date, rec.student_id.name, rec.enrollment_id.enrollment_date)
                )

    @api.constrains('student_id', 'date', 'attendance_type',
                    'teacher_assignment_id', 'period')
    def _check_attendance_unique(self):
        for rec in self:
            domain = [('id', '!=', rec.id), ('student_id', '=', rec.student_id.id),
                      ('date', '=', rec.date), ('attendance_type', '=', rec.attendance_type)]
            if rec.attendance_type == 'subject':
                domain += [('teacher_assignment_id', '=', rec.teacher_assignment_id.id),
                           ('period', '=', rec.period)]
            if self.search_count(domain):
                raise ValidationError('Attendance already exists for this student and session.')
            end = rec.enrollment_id.end_date
            if end and rec.date > end:
                raise ValidationError(
                    'Attendance on %s is after the enrollment of %s ended (%s).'
                    % (rec.date, rec.student_id.name, end)
                )

    def unlink(self):
        if self.env.user.has_group('school_management.group_school_admin'):
            return super().unlink()
        today = fields.Date.context_today(self)
        if any(rec.date != today for rec in self):
            raise ValidationError(
                'Past attendance is history and cannot be deleted. '
                'Ask an administrator for corrections.'
            )
        return super().unlink()


class SchoolAttendanceRoster(models.TransientModel):
    """Take attendance for one class and date: generates the roster from
    active enrollments effective on that date, then opens it for marking."""
    _name = 'school.attendance.roster'
    _description = 'Take Attendance'

    class_id = fields.Many2one('school.class', string='Grade / Class', required=True)
    date = fields.Date(
        string='Date', required=True,
        default=lambda self: self._default_date(),
    )

    @api.model
    def _default_date(self):
        """Today when school is in session, otherwise the start of the nearest term,
        so the roster never opens on a date attendance cannot be recorded for."""
        today = fields.Date.context_today(self)
        Term = self.env['school.term']
        if Term.search_count([('date_start', '<=', today), ('date_end', '>=', today)]):
            return today
        upcoming = Term.search([('date_start', '>', today)], order='date_start', limit=1)
        if upcoming:
            return upcoming.date_start
        previous = Term.search([('date_end', '<', today)], order='date_end desc', limit=1)
        return previous.date_end or today

    def action_generate(self):
        self.ensure_one()
        Attendance = self.env['school.attendance']
        placements = self.env['school.enrollment.placement'].search([
            ('class_id', '=', self.class_id.id),
            ('date_start', '<=', self.date),
            '|', ('date_end', '=', False), ('date_end', '>=', self.date),
            ('enrollment_id.state', '!=', 'draft'),
            ('enrollment_id.enrollment_date', '<=', self.date),
            '|', ('enrollment_id.end_date', '=', False),
                 ('enrollment_id.end_date', '>=', self.date),
        ])
        enrollments = placements.enrollment_id
        enrollments = enrollments.filtered_domain([
            ('state', '=', 'active'),
        ])
        # Filter on the student, not the enrollment: on a transfer day the
        # student already has a row under the old class.
        recorded_students = Attendance.search([
            ('date', '=', self.date),
            ('student_id', 'in', enrollments.student_id.ids),
        ]).student_id
        Attendance.create([
            {'enrollment_id': enrollment.id, 'date': self.date, 'status': 'not_recorded'}
            for enrollment in enrollments
            if enrollment.student_id not in recorded_students
        ])
        return {
            'type': 'ir.actions.act_window',
            'name': '%s — %s' % (self.class_id.display_name, self.date),
            'res_model': 'school.attendance',
            'view_mode': 'list',
            'domain': [('class_id', '=', self.class_id.id), ('date', '=', self.date)],
            'context': {'default_date': self.date},
        }
