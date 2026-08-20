from odoo import api, fields, models
from odoo.exceptions import ValidationError

from .school_responsibility import DEPARTMENTS, RESPONSIBILITIES

# Audience type -> the field that must hold at least one value for that type.
AUDIENCE_VALUE_FIELDS = {
    'department': 'department',
    'responsibility': 'responsibility',
    'teacher_group': 'teacher_ids',
    'subject_group': 'subject_ids',
    'class_section': 'class_ids',
    'branch_campus': 'campus_ids',
    'selected_staff': 'staff_ids',
}

AUDIENCE_TYPES = [
    ('all_staff', 'All Staff'),
    ('department', 'Department'),
    ('responsibility', 'Responsibility'),
    ('teacher_group', 'Teacher Group'),
    ('subject_group', 'Subject'),
    ('class_section', 'Class / Section'),
    ('branch_campus', 'Branch / Campus'),
    ('selected_staff', 'Selected Staff'),
]


class SchoolProgram(models.Model):
    _name = 'school.program'
    _description = 'Program Schedule'
    _inherit = ['mail.thread']
    _order = 'start_datetime desc'

    name = fields.Char(string='Program Title', required=True, tracking=True)
    program_type = fields.Selection([
        ('meeting', 'Meeting'),
        ('examination', 'Examination'),
        ('training', 'Training'),
        ('registration', 'Registration'),
        ('academic_event', 'Academic Event'),
        ('holiday', 'Holiday'),
        ('other', 'Other'),
    ], string='Program Type', required=True, default='meeting')

    audience_type = fields.Selection(
        AUDIENCE_TYPES, string='Audience', required=True, default='all_staff', tracking=True,
    )

    department = fields.Selection(DEPARTMENTS, string='Department')
    responsibility = fields.Selection(RESPONSIBILITIES, string='Responsibility')
    teacher_ids = fields.Many2many('school.teacher', string='Teachers')
    subject_ids = fields.Many2many('school.subject', string='Subjects')
    class_ids = fields.Many2many('school.class', string='Classes / Sections')
    campus_ids = fields.Many2many('school.campus', string='Branches / Campuses')
    staff_ids = fields.Many2many('school.staff', string='Selected Staff')

    start_datetime = fields.Datetime(
        string='Start', required=True, tracking=True,
        default=lambda self: fields.Datetime.now(),
    )
    end_datetime = fields.Datetime(string='End', required=True, tracking=True)
    location = fields.Char(
        string='Location',
        help='Room, hall, campus, online link, or address.',
    )
    organizer_id = fields.Many2one('school.staff', string='Organizer', ondelete='restrict')

    state = fields.Selection([
        ('draft', 'Draft'),
        ('published', 'Published'),
        ('cancelled', 'Cancelled'),
        ('completed', 'Completed'),
    ], string='Status', default='draft', required=True, tracking=True)
    description = fields.Html(string='Description')
    active = fields.Boolean(string='Active', default=True)

    _program_end_after_start = models.Constraint(
        'CHECK(end_datetime > start_datetime)',
        'Program end must be after the start.',
    )

    @api.constrains('audience_type', 'department', 'responsibility',
                    'teacher_ids', 'subject_ids', 'class_ids', 'campus_ids', 'staff_ids')
    def _check_audience_values(self):
        for rec in self:
            field = AUDIENCE_VALUE_FIELDS.get(rec.audience_type)
            if field and not rec[field]:
                raise ValidationError(
                    'Select at least one audience value for the chosen audience type.'
                )

    @api.onchange('audience_type')
    def _onchange_audience_type(self):
        """Drop audience values that no longer apply so a stale target is never published."""
        keep = AUDIENCE_VALUE_FIELDS.get(self.audience_type)
        for field in set(AUDIENCE_VALUE_FIELDS.values()) - {keep}:
            self[field] = False

    def action_publish(self):
        self.write({'state': 'published'})

    def action_cancel(self):
        self.write({'state': 'cancelled'})

    def action_complete(self):
        self.write({'state': 'completed'})

    def action_reset_draft(self):
        self.write({'state': 'draft'})
