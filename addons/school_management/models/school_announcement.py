from odoo import api, fields, models # type: ignore
from odoo.exceptions import ValidationError # type: ignore

from .school_program import AUDIENCE_TYPES, AUDIENCE_VALUE_FIELDS
from .school_responsibility import DEPARTMENTS, RESPONSIBILITIES


class SchoolAnnouncement(models.Model):
    _name = 'school.announcement'
    _description = 'Targeted Staff Announcement'
    _inherit = ['mail.thread']
    _order = 'priority desc, publish_datetime desc'

    name = fields.Char(string='Title', required=True, tracking=True)
    message = fields.Html(string='Message', required=True)
    category = fields.Selection([
        ('general', 'General'),
        ('academic', 'Academic'),
        ('schedule_change', 'Schedule Change'),
        ('meeting', 'Meeting'),
        ('examination', 'Examination'),
        ('training', 'Training'),
        ('emergency', 'Emergency'),
        ('other', 'Other'),
    ], string='Category', required=True, default='general')

    # Audience codes match school.program so both models share one targeting rule.
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
    recipient_user_ids = fields.Many2many(
        'res.users', 'school_announcement_recipient_rel',
        'announcement_id', 'user_id', string='Resolved Recipients', readonly=True,
    )
    visibility_active = fields.Boolean(
        string='Visible to Recipients', readonly=True, index=True, copy=False,
        help='Stored publication window used by record rules and refreshed by the scheduler.',
    )

    state = fields.Selection([
        ('draft', 'Draft'),
        ('published', 'Published'),
        ('archived', 'Archived'),
    ], string='Publication', default='draft', required=True, tracking=True)
    publish_datetime = fields.Datetime(
        string='Publish On', default=lambda self: fields.Datetime.now(), tracking=True,
    )
    expiry_datetime = fields.Datetime(string='Expires On', tracking=True)
    priority = fields.Selection([
        ('0', 'Normal'),
        ('1', 'Important'),
        ('2', 'Urgent'),
    ], string='Priority', default='0', required=True, tracking=True)

    link = fields.Char(string='Link', help='Optional URL for further detail.')
    attachment_ids = fields.Many2many('ir.attachment', string='Attachments')
    author_id = fields.Many2one(
        'res.users', string='Author', default=lambda self: self.env.user, readonly=True,
    )

    # Schedule-change announcements point at what actually changed.
    program_id = fields.Many2one('school.program', string='Related Program')
    class_schedule_id = fields.Many2one('school.class.schedule', string='Related Class Schedule')

    is_live = fields.Boolean(
        string='Live', compute='_compute_is_live', search='_search_is_live',
        help='Published, past its publish time, and not yet expired.',
    )
    is_for_me = fields.Boolean(
        string='For Me', compute='_compute_is_for_me', search='_search_is_for_me',
        help='The current user falls inside this announcement audience.',
    )
    active = fields.Boolean(string='Active', default=True)

    _expiry_after_publish = models.Constraint(
        'CHECK(expiry_datetime IS NULL OR publish_datetime IS NULL OR expiry_datetime > publish_datetime)',
        'The expiry time must be after the publish time.',
    )

    @api.depends('state', 'publish_datetime', 'expiry_datetime')
    def _compute_is_live(self):
        now = fields.Datetime.now()
        for rec in self:
            rec.is_live = (
                rec.state == 'published'
                and (not rec.publish_datetime or rec.publish_datetime <= now)
                and (not rec.expiry_datetime or rec.expiry_datetime > now)
            )

    def _audience_branches(self, user):
        """One domain branch per audience type, each pairing the type with the match it
        needs. Scope is resolved server-side from exact active assignments and staff
        links so record-rule searches cannot depend on a stale client/user cache."""
        staff = self.env['school.staff'].sudo().search([('user_id', '=', user.id)])
        teachers = self.env['school.teacher'].sudo().search([('staff_id', 'in', staff.ids)])
        assignments = self.env['school.teacher.assignment'].sudo().search([
            ('teacher_id', 'in', teachers.ids), ('state', '=', 'active'),
        ])
        responsibilities = staff.mapped('responsibility_ids').filtered('active')
        responsibility_codes = sorted(set(
            assignments.mapped('responsibility') + responsibilities.mapped('responsibility')
        ))
        campuses = staff.mapped('campus_id') | responsibilities.mapped('campus_id')
        return [
            [('audience_type', '=', 'all_staff')],
            ['&', ('audience_type', '=', 'department'),
                  ('department', 'in', staff.mapped('department'))],
            ['&', ('audience_type', '=', 'responsibility'),
                  ('responsibility', 'in', responsibility_codes)],
            ['&', ('audience_type', '=', 'teacher_group'),
                  ('teacher_ids', 'in', teachers.ids)],
            ['&', ('audience_type', '=', 'subject_group'),
                  ('subject_ids', 'in', assignments.mapped('subject_id').ids)],
            ['&', ('audience_type', '=', 'class_section'),
                  ('class_ids', 'in', assignments.mapped('class_id').ids)],
            ['&', ('audience_type', '=', 'branch_campus'),
                  ('campus_ids', 'in', campuses.ids)],
            ['&', ('audience_type', '=', 'selected_staff'),
                  ('staff_ids', 'in', staff.ids)],
        ]

    @api.depends_context('uid')
    def _compute_is_for_me(self):
        user = self.env.user
        for rec in self:
            rec.is_for_me = bool(rec.filtered_domain(
                ['|'] * 7 + [leaf for branch in rec._audience_branches(user) for leaf in branch]
            ))

    @api.model
    def _positive_search(self, operator, value):
        """Odoo rewrites ('field', '=', True) into ('field', 'in', [True]) before it
        reaches a search method, so both forms have to be understood."""
        if operator in ('in', 'not in'):
            wanted = any(value) if isinstance(value, (list, tuple, set)) else bool(value)
            return (operator == 'in') == wanted
        return (operator == '=') == bool(value)

    def _search_is_for_me(self, operator, value):
        mine = ['|'] * 7 + [
            leaf for branch in self._audience_branches(self.env.user) for leaf in branch
        ]
        if self._positive_search(operator, value):
            return mine
        return ['!', *mine]

    def _search_is_live(self, operator, value):
        now = fields.Datetime.now()
        live = [
            ('state', '=', 'published'),
            '|', ('publish_datetime', '=', False), ('publish_datetime', '<=', now),
            '|', ('expiry_datetime', '=', False), ('expiry_datetime', '>', now),
        ]
        if self._positive_search(operator, value):
            return live
        return ['!', *live]

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
        now = fields.Datetime.now()
        for rec in self:
            if not rec.publish_datetime:
                rec.publish_datetime = now
            candidates = self.env['res.users'].sudo().search([
                ('active', '=', True), ('share', '=', False),
            ])
            recipients = candidates.filtered(
                lambda user: bool(rec.sudo().filtered_domain(
                    ['|'] * 7 + [
                        leaf for branch in rec._audience_branches(user) for leaf in branch
                    ]
                ))
            )
            rec.sudo().write({
                'state': 'published',
                'recipient_user_ids': [(6, 0, recipients.ids)],
                'visibility_active': (
                    rec.publish_datetime <= now
                    and (not rec.expiry_datetime or rec.expiry_datetime > now)
                ),
            })

    def action_archive_announcement(self):
        self.write({'state': 'archived', 'visibility_active': False})

    def action_reset_draft(self):
        self.write({'state': 'draft', 'visibility_active': False})

    @api.model
    def cron_refresh_visibility(self):
        """Refresh stored publication windows without evaluating Python in record rules."""
        now = fields.Datetime.now()
        should_show = self.sudo().search([
            ('state', '=', 'published'),
            ('publish_datetime', '<=', now),
            '|', ('expiry_datetime', '=', False), ('expiry_datetime', '>', now),
            ('visibility_active', '=', False),
        ])
        should_hide = self.sudo().search([
            ('visibility_active', '=', True),
            '|', ('state', '!=', 'published'),
            '|', ('publish_datetime', '>', now),
            '&', ('expiry_datetime', '!=', False), ('expiry_datetime', '<=', now),
        ])
        if should_show:
            should_show.write({'visibility_active': True})
        if should_hide:
            should_hide.write({'visibility_active': False})
