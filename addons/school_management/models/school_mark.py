from odoo import api, fields, models
from odoo.exceptions import ValidationError


class SchoolMark(models.Model):
    _name = 'school.mark'
    _description = 'Student Mark List Entry'

    class_id = fields.Many2one('school.class', string='Class/Grade', required=True)
    student_id = fields.Many2one(
        'school.student', string='Student', required=True,
        domain="[('class_id', '=', class_id)]"
    )

    academic_year = fields.Char(string='Academic Year', required=True)
    term = fields.Selection([
        ('term1', 'Term 1'),
        ('term2', 'Term 2'),
        ('final', 'Final'),
    ], string='Term', required=True)

    subject = fields.Char(string='Subject', required=True)
    assessment_type = fields.Selection([
        ('quiz', 'Quiz'),
        ('midterm', 'Midterm'),
        ('final', 'Final Exam'),
        ('assignment', 'Assignment'),
    ], string='Assessment Type', required=True)

    max_mark = fields.Float(string='Maximum Mark', default=100.0, required=True)
    score = fields.Float(string='Score', required=True)

    percentage = fields.Float(string='Percentage', compute='_compute_result', store=True)
    grade = fields.Char(string='Grade', compute='_compute_result', store=True)
    pass_fail = fields.Selection([
        ('pass', 'Pass'),
        ('fail', 'Fail'),
    ], string='Pass/Fail', compute='_compute_result', store=True)

    remarks = fields.Text(string='Remarks')
    teacher_id = fields.Many2one('res.users', string='Responsible Teacher')

    _sql_constraints = [
        ('unique_student_subject_term_assessment',
         'unique(student_id, subject, term, assessment_type)',
         'This student already has a result for this subject, term, and assessment type.')
    ]

    @api.constrains('score', 'max_mark')
    def _check_score(self):
        for rec in self:
            if rec.score < 0:
                raise ValidationError('Score cannot be negative.')
            if rec.score > rec.max_mark:
                raise ValidationError('Score cannot exceed the maximum mark.')

    @api.depends('score', 'max_mark')
    def _compute_result(self):
        for rec in self:
            if rec.max_mark:
                rec.percentage = rec.score / rec.max_mark if rec.max_mark else 0.0
            else:
                rec.percentage = 0.0

            if rec.percentage >= 0.9:
                rec.grade = 'A'
            elif rec.percentage >= 0.8:
                rec.grade = 'B'
            elif rec.percentage >= 0.7:
                rec.grade = 'C'
            elif rec.percentage >= 0.5:
                rec.grade = 'D'
            else:
                rec.grade = 'F'

            rec.pass_fail = 'pass' if rec.percentage >= 0.5 else 'fail'