from odoo import api, fields, models
from odoo.exceptions import AccessError, ValidationError


REPORT_INPUT_STATES = ('approved', 'locked', 'published')


class SchoolReportCard(models.Model):
    _name = 'school.report.card'
    _description = 'Student Report Card'
    _inherit = ['mail.thread']
    _order = 'academic_year_id desc, term_id, class_id, student_id'

    name = fields.Char(string='Report Card', compute='_compute_name', store=True)
    student_id = fields.Many2one(
        'school.student', string='Student', required=True, ondelete='restrict', index=True,
    )
    enrollment_id = fields.Many2one(
        'school.enrollment', string='Enrollment', required=True, ondelete='restrict', index=True,
    )
    class_id = fields.Many2one(
        'school.class', string='Grade / Class', required=True, ondelete='restrict', index=True,
    )
    academic_year_id = fields.Many2one(
        related='class_id.academic_year_id', string='Academic Year', store=True, index=True,
    )
    term_id = fields.Many2one(
        'school.term', string='Term', required=True, ondelete='restrict', index=True,
    )
    state = fields.Selection([
        ('draft', 'Draft'),
        ('generated', 'Generated'),
        ('approved', 'Approved'),
        ('published', 'Published'),
    ], string='Status', required=True, default='draft', tracking=True)
    line_ids = fields.One2many(
        'school.report.card.line', 'report_card_id', string='Subject Results', copy=True,
    )
    overall_percentage = fields.Float(string='Overall Percentage', digits=(16, 2), readonly=True)
    overall_grade = fields.Char(string='Overall Grade', readonly=True)
    result_status = fields.Selection([
        ('incomplete', 'Incomplete'),
        ('pass', 'Pass'),
        ('fail', 'Fail'),
    ], string='Overall Result', required=True, default='incomplete', readonly=True)
    complete = fields.Boolean(string='Complete', readonly=True)
    class_rank = fields.Integer(string='Class Rank', readonly=True)
    attendance_present = fields.Integer(string='Present', readonly=True)
    attendance_late = fields.Integer(string='Late', readonly=True)
    attendance_absent = fields.Integer(string='Absent', readonly=True)
    attendance_not_recorded = fields.Integer(string='Not Recorded', readonly=True)
    attendance_total = fields.Integer(string='Attendance Records', readonly=True)
    attendance_percentage = fields.Float(string='Attendance Percentage', digits=(16, 2), readonly=True)
    promotion_decision = fields.Selection([
        ('pending', 'Pending'),
        ('promote', 'Promote'),
        ('repeat', 'Repeat'),
        ('conditional', 'Conditional Promotion'),
        ('withheld', 'Withheld'),
    ], string='Promotion Decision', required=True, default='pending', tracking=True)
    generated_at = fields.Datetime(string='Generated At', readonly=True)
    approved_at = fields.Datetime(string='Approved At', readonly=True)
    published_at = fields.Datetime(string='Published At', readonly=True)

    _sql_constraints = [
        ('student_enrollment_term_unique',
         'unique(student_id, enrollment_id, term_id)',
         'A student can have only one report card per enrollment and term.'),
        ('class_matches_enrollment',
         'CHECK(class_id IS NOT NULL)',
         'A report card must retain its historical class.'),
    ]

    @api.depends('student_id.name', 'class_id.name', 'term_id.name')
    def _compute_name(self):
        for rec in self:
            rec.name = '%s - %s - %s' % (
                rec.student_id.name or '?', rec.class_id.display_name or '?',
                rec.term_id.name or '?',
            )

    @api.onchange('enrollment_id')
    def _onchange_enrollment_id(self):
        if self.enrollment_id:
            self.student_id = self.enrollment_id.student_id
            self.class_id = self.enrollment_id.class_id

    @api.onchange('student_id')
    def _onchange_student_id(self):
        if self.student_id and not self.enrollment_id:
            active_enrollment = self.env['school.enrollment'].search([
                ('student_id', '=', self.student_id.id),
                ('state', 'in', ('active', 'enrolled')),
            ], limit=1)
            if active_enrollment:
                self.enrollment_id = active_enrollment
                self.class_id = active_enrollment.class_id

    @api.constrains('student_id', 'enrollment_id', 'class_id')
    def _check_enrollment_identity(self):
        for rec in self:
            if rec.enrollment_id.student_id != rec.student_id:
                raise ValidationError('The report-card student must match the enrollment student.')
            if rec.enrollment_id.class_id != rec.class_id:
                raise ValidationError('The report-card class must match the enrollment class.')

    def _require_result_officer(self):
        if self.env.su:
            return
        allowed = (
            'school_management.group_school_admin',
            'school_management.group_school_director',
            'school_management.group_school_exam_officer',
        )
        if not any(self.env.user.has_group(group) for group in allowed):
            raise AccessError('Only an administrator, director, or exam officer can manage report cards.')

    def action_open_reopen_wizard(self):
        self.ensure_one()
        self._require_result_officer()
        if self.state != 'published':
            raise ValidationError('Only published report cards can be reopened.')
        return {
            'type': 'ir.actions.act_window',
            'name': 'Reopen Report Card',
            'res_model': 'school.report.card.reopen',
            'view_mode': 'form',
            'target': 'new',
            'context': {'default_report_card_id': self.id},
        }

    @api.model_create_multi
    def create(self, vals_list):
        for vals in vals_list:
            enrollment = self.env['school.enrollment'].browse(vals.get('enrollment_id'))
            if enrollment:
                vals.setdefault('student_id', enrollment.student_id.id)
                vals.setdefault('class_id', enrollment.class_id.id)
        return super().create(vals_list)

    def write(self, vals):
        if any(rec.state == 'published' for rec in self):
            protected = {
                'student_id', 'enrollment_id', 'class_id', 'term_id', 'line_ids',
                'overall_percentage', 'overall_grade', 'result_status', 'complete',
                'class_rank', 'attendance_present', 'attendance_late',
                'attendance_absent', 'attendance_not_recorded', 'attendance_total',
                'attendance_percentage', 'generated_at', 'approved_at', 'published_at',
            }
            if protected & vals.keys() and not (
                    self.env.context.get('skip_report_rank_write') and
                    set(vals) <= {'class_rank'}):
                raise ValidationError(
                    'Published report cards are immutable. Reopen them with an audited reason.'
                )
        if 'promotion_decision' in vals:
            self._require_result_officer()
        return super().write(vals)

    def _attendance_values(self):
        self.ensure_one()
        today = fields.Date.context_today(self)
        attendance_model_name = next(
            (name for name in ('school.student.attendance', 'school.attendance')
             if name in self.env.registry.models),
            None,
        )
        if not attendance_model_name:
            return {
                'attendance_present': 0, 'attendance_late': 0,
                'attendance_absent': 0, 'attendance_not_recorded': 0,
                'attendance_total': 0, 'attendance_percentage': 0.0,
            }
        attendance_model = self.env[attendance_model_name]
        enrollment_start = fields.Date.to_date(self.enrollment_id.enrollment_date)
        enrollment_end = fields.Date.to_date(self.enrollment_id.end_date) or today
        term_start = fields.Date.to_date(getattr(self.term_id, 'start_date', False))
        term_end = fields.Date.to_date(getattr(self.term_id, 'end_date', False))
        start_date = max(filter(None, (enrollment_start, term_start)), default=enrollment_start)
        end_date = min(filter(None, (enrollment_end, term_end)), default=enrollment_end)
        if start_date and end_date and start_date > end_date:
            attendance = attendance_model.browse()
        else:
            domain = [('date', '>=', start_date), ('date', '<=', end_date)]
            if 'enrollment_id' in attendance_model._fields:
                domain.append(('enrollment_id', '=', self.enrollment_id.id))
            else:
                domain.append(('student_id', '=', self.student_id.id))
            attendance = attendance_model.search(domain)
        counts = {status: len(attendance.filtered(lambda row: row.status == status)) for status in (
            'present', 'late', 'absent', 'not_recorded',
        )}
        total = len(attendance)
        percentage = ((counts['present'] + counts['late']) / total * 100) if total else 0.0
        counts.update({
            'attendance_total': total,
            'attendance_percentage': percentage,
        })
        return {
            'attendance_present': counts['present'],
            'attendance_late': counts['late'],
            'attendance_absent': counts['absent'],
            'attendance_not_recorded': counts['not_recorded'],
            'attendance_total': counts['attendance_total'],
            'attendance_percentage': counts['attendance_percentage'],
        }

    def _generate_lines(self):
        self.ensure_one()
        subjects = self.env['school.student.subject'].search([
            ('enrollment_id', '=', self.enrollment_id.id),
            ('state', '=', 'enrolled'),
        ])
        Result = self.env['school.subject.result']
        values = []
        for student_subject in subjects:
            result = Result.generate_for_subject(
                self.student_id, self.enrollment_id, self.class_id,
                student_subject.subject_id, self.term_id,
            )
            values.append({
                'report_card_id': self.id,
                'result_id': result.id,
                'student_subject_id': student_subject.id,
                'subject_id': result.subject_id.id,
                'percentage': result.percentage,
                'grade': result.grade,
                'passed': result.passed,
                'result_status': result.result_status,
                'assessment_count': result.assessment_count,
                'weight_total': result.weight_total,
            })
        self.line_ids.unlink()
        self.env['school.report.card.line'].create(values)

    def _recompute_summary(self):
        for card in self:
            lines = card.line_ids
            complete = bool(lines) and all(line.result_status != 'incomplete' for line in lines)
            percentage = sum(lines.mapped('percentage')) / len(lines) if (complete and lines) else 0.0
            policy = lines[:1].result_id.grading_policy_id if lines else self.env['school.grading.policy']._default_policy()
            passed = complete and all(lines.mapped('passed'))
            card.write({
                'overall_percentage': percentage,
                'overall_grade': policy.get_grade(percentage) if complete else False,
                'result_status': 'pass' if passed else ('fail' if complete else 'incomplete'),
                'complete': complete,
                **card._attendance_values(),
            })

    def _recompute_rankings(self):
        groups = {}
        for card in self:
            key = (card.class_id.id, card.academic_year_id.id, card.term_id.id)
            groups.setdefault(key, self.env['school.report.card'])
            groups[key] |= card
        for group in groups.values():
            card = group[:1]
            peers = self.search([
                ('class_id', '=', card.class_id.id),
                ('academic_year_id', '=', card.academic_year_id.id),
                ('term_id', '=', card.term_id.id),
                ('state', 'in', ('generated', 'approved', 'published')),
                ('complete', '=', True),
            ], order='overall_percentage desc, student_id, id')
            rank = 0
            previous_percentage = None
            for index, peer in enumerate(peers, start=1):
                if previous_percentage != peer.overall_percentage:
                    rank = index
                    previous_percentage = peer.overall_percentage
                peer.with_context(skip_report_rank_write=True).write({'class_rank': rank})

    def action_generate(self):
        for card in self:
            if card.state not in ('draft', 'generated'):
                raise ValidationError('Only draft or generated report cards can be generated.')
            card._generate_lines()
            card._recompute_summary()
            card.write({'state': 'generated', 'generated_at': fields.Datetime.now()})
        self._recompute_rankings()
        return True

    def action_approve(self):
        self._require_result_officer()
        for card in self:
            if card.state != 'generated':
                raise ValidationError('Only generated report cards can be approved.')
            if not card.complete:
                raise ValidationError('Incomplete report cards cannot be approved.')
            card.write({'state': 'approved', 'approved_at': fields.Datetime.now()})
        return True

    def action_publish(self):
        self._require_result_officer()
        for card in self:
            if card.state != 'approved':
                raise ValidationError('Only approved report cards can be published.')
            card.write({'state': 'published', 'published_at': fields.Datetime.now()})
        return True

    def action_reopen(self, reason):
        self._require_result_officer()
        if not reason or not reason.strip():
            raise ValidationError('A reason is required to reopen a report card.')
        for card in self:
            if card.state != 'published':
                raise ValidationError('Only published report cards can be reopened.')
            card.message_post(body='Report card reopened for correction: %s' % reason)
            card.with_context(skip_report_rank_write=True).write({'state': 'generated'})
        return True


class SchoolReportCardLine(models.Model):
    _name = 'school.report.card.line'
    _description = 'Report Card Subject Result'
    _order = 'subject_id'

    report_card_id = fields.Many2one(
        'school.report.card', string='Report Card', required=True, ondelete='cascade', index=True,
    )
    result_id = fields.Many2one(
        'school.subject.result', string='Source Result', required=True, ondelete='restrict',
    )
    student_subject_id = fields.Many2one(
        'school.student.subject', string='Student Subject', required=True, ondelete='restrict',
    )
    subject_id = fields.Many2one(
        'school.subject', string='Subject', required=True, ondelete='restrict',
    )
    percentage = fields.Float(string='Percentage', digits=(16, 2), readonly=True)
    grade = fields.Char(string='Grade', readonly=True)
    passed = fields.Boolean(string='Passed', readonly=True)
    result_status = fields.Selection([
        ('incomplete', 'Incomplete'),
        ('pass', 'Pass'),
        ('fail', 'Fail'),
    ], string='Result Status', required=True, readonly=True)
    assessment_count = fields.Integer(string='Approved Assessments', readonly=True)
    weight_total = fields.Float(string='Contributing Weight', readonly=True)

    _sql_constraints = [
        ('report_card_subject_unique', 'unique(report_card_id, subject_id)',
         'A report card cannot contain the same subject twice.'),
    ]

    def write(self, vals):
        if any(line.report_card_id.state == 'published' for line in self):
            raise ValidationError('Published report-card lines are immutable.')
        return super().write(vals)


class ReportSchoolReportCard(models.AbstractModel):
    _name = 'report.school_management.report_school_report_card'
    _description = 'Published School Report Card PDF'

    @api.model
    def _get_report_values(self, docids, data=None):
        docs = self.env['school.report.card'].browse(docids)
        if any(card.state not in ('approved', 'published') for card in docs):
            raise ValidationError('Only approved or published report cards can be printed.')
        return {'doc_ids': docs.ids, 'doc_model': 'school.report.card', 'docs': docs}