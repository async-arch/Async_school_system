from markupsafe import Markup

from odoo import api, fields, models
from odoo.exceptions import AccessError, ValidationError


class SchoolGradingScheme(models.Model):
    _name = 'school.grading.scheme'
    _description = 'Grading Scheme'
    _order = 'company_id, name'

    name = fields.Char(required=True, translate=True)
    company_id = fields.Many2one(
        'res.company', required=True, default=lambda self: self.env.company,
        ondelete='cascade')
    pass_percentage = fields.Float(default=50.0, required=True)
    band_ids = fields.One2many('school.grading.band', 'scheme_id', string='Bands')
    active = fields.Boolean(default=True)
    is_company_scheme = fields.Boolean(
        string='Used for Report Cards', compute='_compute_is_company_scheme')

    _grading_name_company_unique = models.Constraint(
        'unique(name, company_id)', 'Grading scheme names must be unique per school.')
    _grading_pass_range = models.Constraint(
        'CHECK(pass_percentage >= 0 AND pass_percentage <= 100)',
        'Pass percentage must be between 0 and 100.')

    def grade_for(self, percentage):
        self.ensure_one()
        return self.band_ids.filtered(
            lambda band: band.minimum_percentage <= percentage <= band.maximum_percentage
        ).sorted('minimum_percentage', reverse=True)[:1]

    @api.depends('company_id.school_grading_scheme_id')
    def _compute_is_company_scheme(self):
        for scheme in self:
            scheme.is_company_scheme = (
                scheme.company_id.school_grading_scheme_id == scheme)

    def action_use_for_report_cards(self):
        self.ensure_one()
        if not (self.env.su or self.env.user.has_group(
                'school_management.group_school_admin')):
            raise AccessError(
                'Only a School Administrator can select the active grading scheme.')
        if not self.active:
            raise ValidationError('Activate this grading scheme before using it.')
        bands = self.band_ids.sorted('minimum_percentage')
        complete = bool(bands) and bands[0].minimum_percentage == 0 \
            and bands[-1].maximum_percentage == 100
        for previous, current in zip(bands, bands[1:]):
            if abs(current.minimum_percentage - previous.maximum_percentage) > 0.011:
                complete = False
                break
        if not complete:
            raise ValidationError(
                'Grading bands must cover every percentage from 0 through 100 '
                'without gaps before this scheme can be used for report cards.')
        self.company_id.write({
            'school_grading_scheme_id': self.id,
            'school_grading_configured': True,
        })
        return True


class SchoolGradingBand(models.Model):
    _name = 'school.grading.band'
    _description = 'Grading Band'
    _order = 'minimum_percentage desc'

    scheme_id = fields.Many2one(
        'school.grading.scheme', required=True, ondelete='cascade')
    name = fields.Char(required=True, translate=True)
    minimum_percentage = fields.Float(required=True)
    maximum_percentage = fields.Float(required=True, default=100.0)
    remark = fields.Char(translate=True)

    _grading_band_range = models.Constraint(
        'CHECK(minimum_percentage >= 0 AND maximum_percentage <= 100 '
        'AND maximum_percentage >= minimum_percentage)',
        'Grading band percentages must form a valid range between 0 and 100.')

    @api.constrains('scheme_id', 'minimum_percentage', 'maximum_percentage')
    def _check_overlap(self):
        for band in self:
            overlap = self.search([
                ('id', '!=', band.id), ('scheme_id', '=', band.scheme_id.id),
                ('minimum_percentage', '<=', band.maximum_percentage),
                ('maximum_percentage', '>=', band.minimum_percentage),
            ], limit=1)
            if overlap:
                raise ValidationError('Grading bands cannot overlap.')


class SchoolReportCard(models.Model):
    _name = 'school.report.card'
    _description = 'Versioned Student Report Card'
    _inherit = ['mail.thread']
    _order = 'student_id, term_id, version desc'

    name = fields.Char(required=True, readonly=True, copy=False)
    student_id = fields.Many2one(
        'school.student', required=True, ondelete='restrict', index=True)
    enrollment_id = fields.Many2one(
        'school.enrollment', required=True, ondelete='restrict', index=True)
    term_id = fields.Many2one('school.term', required=True, ondelete='restrict', index=True)
    academic_year_id = fields.Many2one(
        related='enrollment_id.academic_year_id', store=True, index=True)
    class_id = fields.Many2one(related='enrollment_id.class_id', store=True)
    version = fields.Integer(required=True, readonly=True, copy=False)
    supersedes_id = fields.Many2one('school.report.card', ondelete='restrict', readonly=True)
    superseded_by_id = fields.Many2one(
        'school.report.card', ondelete='restrict', readonly=True, copy=False)
    grading_scheme_id = fields.Many2one(
        'school.grading.scheme', required=True, ondelete='restrict')
    result_snapshot = fields.Json(required=True, readonly=True, copy=False)
    attendance_summary = fields.Json(readonly=True, copy=False)
    overall_average = fields.Float(readonly=True, copy=False)
    result = fields.Selection(
        [('pass', 'Pass'), ('fail', 'Fail')], readonly=True, copy=False)
    state = fields.Selection([
        ('draft', 'Draft'), ('approved', 'Approved'),
        ('published', 'Published'), ('superseded', 'Superseded'),
    ], default='draft', required=True, tracking=True)
    approved_by_id = fields.Many2one('res.users', readonly=True, copy=False)
    approved_at = fields.Datetime(readonly=True, copy=False)
    published_at = fields.Datetime(readonly=True, copy=False)
    correction_reason = fields.Text(copy=False)
    class_rank = fields.Integer(string='Class Rank', compute='_compute_class_rank')
    class_size = fields.Integer(string='Students Ranked', compute='_compute_class_rank')
    subject_results_html = fields.Html(
        string='Subject Results', compute='_compute_snapshot_html', sanitize=False)
    attendance_html = fields.Html(
        string='Attendance', compute='_compute_snapshot_html', sanitize=False)

    @api.depends('overall_average', 'class_id', 'term_id', 'superseded_by_id')
    def _compute_class_rank(self):
        for card in self:
            if not self.env.company.school_ranking or not card.class_id:
                card.class_rank = 0
                card.class_size = 0
                continue
            latest = {}
            for peer in self.search([
                    ('class_id', '=', card.class_id.id),
                    ('term_id', '=', card.term_id.id)], order='version desc'):
                latest.setdefault(peer.student_id.id, peer)
            card.class_size = len(latest)
            card.class_rank = 1 + sum(
                1 for peer in latest.values() if peer.overall_average > card.overall_average)

    @api.depends('result_snapshot', 'attendance_summary')
    def _compute_snapshot_html(self):
        for card in self:
            card.subject_results_html = card._subject_results_table()
            card.attendance_html = card._attendance_table()

    def _subject_results_table(self):
        rows = self.result_snapshot or []
        if not rows:
            return False
        body = Markup('').join(
            Markup('<tr><td>%s</td><td class="text-end">%s</td>'
                   '<td class="text-end">%s</td><td class="text-end">%.2f%%</td>'
                   '<td>%s</td><td>%s</td></tr>') % (
                row.get('subject') or '', row.get('raw_total') or 0,
                row.get('maximum_total') or 0, row.get('percentage') or 0.0,
                row.get('grade') or '', 'Pass' if row.get('pass') else 'Fail')
            for row in rows)
        return Markup(
            '<table class="table table-sm"><thead><tr>'
            '<th>Subject</th><th class="text-end">Score</th>'
            '<th class="text-end">Out Of</th><th class="text-end">Percentage</th>'
            '<th>Grade</th><th>Result</th></tr></thead><tbody>%s</tbody></table>') % body

    def _attendance_table(self):
        summary = self.attendance_summary or {}
        if not summary:
            return False
        labels = dict(self.env['school.attendance']._fields['status'].selection)
        body = Markup('').join(
            Markup('<tr><td>%s</td><td class="text-end">%s</td></tr>') % (
                labels.get(status, status), count)
            for status, count in sorted(summary.items()))
        return Markup(
            '<table class="table table-sm"><thead><tr><th>Status</th>'
            '<th class="text-end">Days</th></tr></thead><tbody>%s</tbody>'
            '<tfoot><tr><th>Total</th><th class="text-end">%s</th></tr></tfoot>'
            '</table>') % (body, sum(summary.values()))

    _report_card_version_unique = models.Constraint(
        'unique(student_id, term_id, version)',
        'Report card versions must be unique for each student and term.')

    @api.model_create_multi
    def create(self, vals_list):
        for vals in vals_list:
            student = self.env['school.student'].browse(vals['student_id'])
            term = self.env['school.term'].browse(vals['term_id'])
            previous = self.search([
                ('student_id', '=', student.id), ('term_id', '=', term.id),
            ], order='version desc', limit=1)
            vals['version'] = previous.version + 1 if previous else 1
            vals['name'] = '%s - %s - v%s' % (student.name, term.name, vals['version'])
            vals.setdefault('supersedes_id', previous.id)
        return super().create(vals_list)

    @api.model
    def generate_for(self, student, term, correction_reason=None):
        enrollment = self.env['school.enrollment'].search([
            ('student_id', '=', student.id),
            ('academic_year_id', '=', term.academic_year_id.id),
        ], limit=1)
        if not enrollment:
            raise ValidationError('The student has no enrollment for this term.')
        scheme = self.env.company.school_grading_scheme_id
        if not scheme or not scheme.band_ids:
            raise ValidationError(
                'No active grading scheme is selected. Go to Administration → '
                'Grading Schemes, complete bands covering 0–100, then click '
                'Use for Report Cards.')
        marks = self.env['school.mark'].search([
            ('student_id', '=', student.id), ('term_id', '=', term.id),
            ('assessment_id.state', '=', 'published'),
            ('mark_status', 'in', ('recorded', 'transfer')),
        ])
        if not marks:
            raise ValidationError('No published marks are available for this report card.')
        grouped = {}
        for mark in marks:
            row = grouped.setdefault(mark.subject_id.id, {
                'subject': mark.subject_id.name, 'raw_total': 0.0,
                'maximum_total': 0.0, 'weighted_total': 0.0,
            })
            row['raw_total'] += mark.score
            row['maximum_total'] += mark.max_score
            row['weighted_total'] += mark.weighted_score
        results = []
        for values in grouped.values():
            percentage = (values['raw_total'] / values['maximum_total'] * 100.0)
            band = scheme.grade_for(percentage)
            values.update({
                'percentage': percentage, 'grade': band.name if band else False,
                'pass': percentage >= scheme.pass_percentage,
            })
            results.append(values)
        average = sum(row['percentage'] for row in results) / len(results)
        # Generation is already restricted to trusted academic roles. Read
        # only this student's term aggregate without granting Exam Officers
        # general access to sensitive attendance screens.
        attendance = self.env['school.attendance'].sudo()._read_group(
            [('student_id', '=', student.id),
             ('date', '>=', term.date_start), ('date', '<=', term.date_end)],
            ['status'], ['__count'])
        return self.create({
            'student_id': student.id, 'enrollment_id': enrollment.id,
            'term_id': term.id, 'grading_scheme_id': scheme.id,
            'result_snapshot': results,
            'attendance_summary': {status: count for status, count in attendance},
            'overall_average': average,
            'result': 'pass' if all(row['pass'] for row in results) else 'fail',
            'correction_reason': correction_reason,
        })

    def _require_exam_officer(self):
        if not self.env.su and not self.env.user.has_group(
                'school_management.group_school_exam_officer'):
            raise AccessError('Only an Exam Officer can approve or publish report cards.')

    def action_approve(self):
        self._require_exam_officer()
        self.filtered(lambda card: card.state == 'draft').write({
            'state': 'approved', 'approved_by_id': self.env.user.id,
            'approved_at': fields.Datetime.now(),
        })

    def action_publish(self):
        self._require_exam_officer()
        for card in self:
            if card.state != 'approved':
                raise ValidationError('Only approved report cards can be published.')
            previous = card.supersedes_id.filtered(lambda item: item.state == 'published')
            if previous:
                previous.write({'state': 'superseded', 'superseded_by_id': card.id})
            card.write({'state': 'published', 'published_at': fields.Datetime.now()})

    def unlink(self):
        raise AccessError('Report card versions are permanent academic records.')


class ResCompanySchoolResults(models.Model):
    _inherit = 'res.company'

    school_grading_scheme_id = fields.Many2one(
        'school.grading.scheme', string='Active Grading Scheme', ondelete='restrict')


class SchoolReportCardGenerate(models.TransientModel):
    _name = 'school.report.card.generate'
    _description = 'Generate Student Report Card'

    student_id = fields.Many2one(
        'school.student', string='Student', required=True,
        domain=[('registration_status', '=', 'approved'), ('active', '=', True)],
    )
    term_id = fields.Many2one(
        'school.term', string='Term', required=True,
        domain=[('active', '=', True)],
    )
    correction_reason = fields.Text(
        help='Required when generating a corrected version of an existing report card.')

    @api.onchange('term_id')
    def _onchange_term_id(self):
        for wizard in self.filtered('term_id'):
            if wizard.student_id and not wizard.student_id.enrollment_ids.filtered(
                    lambda enrollment: enrollment.academic_year_id ==
                    wizard.term_id.academic_year_id):
                wizard.student_id = False
            return {
                'domain': {
                    'student_id': [
                        ('registration_status', '=', 'approved'),
                        ('active', '=', True),
                        ('enrollment_ids.academic_year_id', '=',
                         wizard.term_id.academic_year_id.id),
                    ],
                },
            }

    def action_generate(self):
        self.ensure_one()
        if not (self.env.su
                or self.env.user.has_group('school_management.group_school_admin')
                or self.env.user.has_group('school_management.group_school_exam_officer')):
            raise AccessError(
                'Only a School Administrator or Examination Officer can generate report cards.')
        enrollment = self.student_id.enrollment_ids.filtered(
            lambda item: item.academic_year_id == self.term_id.academic_year_id)
        if not enrollment:
            raise ValidationError(
                '%s is not enrolled in the %s academic year.' % (
                    self.student_id.name, self.term_id.academic_year_id.name))
        previous = self.env['school.report.card'].search_count([
            ('student_id', '=', self.student_id.id),
            ('term_id', '=', self.term_id.id),
        ])
        if previous and not self.correction_reason:
            raise ValidationError(
                'Enter a correction reason before generating a new report-card version.')
        card = self.env['school.report.card'].generate_for(
            self.student_id, self.term_id,
            correction_reason=self.correction_reason or None,
        )
        return {
            'type': 'ir.actions.act_window',
            'name': card.name,
            'res_model': 'school.report.card',
            'res_id': card.id,
            'view_mode': 'form',
            'target': 'current',
        }
