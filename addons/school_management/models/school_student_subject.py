from odoo import api, fields, models
from odoo.exceptions import ValidationError


class SchoolStudentSubject(models.Model):
    """A student's participation in one subject for one enrollment (SRS §7.4).

    Derived from the class curriculum when the enrollment activates;
    optional subjects are added here by the registrar. Mark lists will be
    generated from these rows.
    """
    _name = 'school.student.subject'
    _description = 'Student Subject Enrollment'
    _order = 'enrollment_id, subject_id'
    _rec_name = 'subject_id'

    enrollment_id = fields.Many2one(
        'school.enrollment', string='Enrollment', required=True, index=True,
        ondelete='cascade',
    )
    grade_subject_id = fields.Many2one(
        'school.grade.subject', string='Curriculum Subject', required=True,
        index=True, ondelete='restrict',
    )
    student_id = fields.Many2one(
        related='enrollment_id.student_id', string='Student', store=True,
    )
    subject_id = fields.Many2one(
        related='grade_subject_id.subject_id', string='Subject', store=True,
    )
    class_id = fields.Many2one(
        related='enrollment_id.class_id', string='Grade / Class', store=True,
    )
    subject_type = fields.Selection(
        related='grade_subject_id.subject_type', string='Type',
    )
    state = fields.Selection([
        ('enrolled', 'Enrolled'),
        ('dropped', 'Dropped'),
    ], string='Status', required=True, default='enrolled')
    date_start = fields.Date(required=True, default=lambda self: fields.Date.context_today(self))
    date_end = fields.Date()
    exception_reason = fields.Text()
    drop_reason = fields.Text()

    _enrollment_subject_unique = models.Constraint(
        'unique(enrollment_id, grade_subject_id)',
        'The student is already enrolled in this subject.',
    )
    _student_subject_date_order = models.Constraint(
        'CHECK(date_end IS NULL OR date_end >= date_start)',
        'Subject end date cannot be before its start date.',
    )

    @api.constrains('enrollment_id', 'grade_subject_id')
    def _check_subject_offered_for_class(self):
        for rec in self:
            if rec.grade_subject_id.class_id != rec.enrollment_id.class_id:
                raise ValidationError(
                    '%s is not on the curriculum of %s.'
                    % (rec.grade_subject_id.subject_id.name,
                       rec.enrollment_id.class_id.display_name)
                )

    @api.constrains('state', 'date_end', 'drop_reason')
    def _check_drop_reason(self):
        for rec in self:
            if rec.state == 'dropped' and (not rec.date_end or not rec.drop_reason):
                raise ValidationError('Dropping a subject requires an end date and reason.')

    def unlink(self):
        if any(rec.enrollment_id.state != 'draft' for rec in self):
            raise ValidationError('Student subject history cannot be deleted after activation.')
        return super().unlink()
