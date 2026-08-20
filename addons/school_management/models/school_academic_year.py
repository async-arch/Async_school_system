from odoo import api, fields, models
from odoo.exceptions import AccessError, ValidationError


class SchoolAcademicYear(models.Model):
    _name = 'school.academic.year'
    _description = 'Academic Year'
    _inherit = ['mail.thread', 'mail.activity.mixin']
    # Newest first: the year people are working in is the one they want at the top.
    _order = 'name desc'

    name = fields.Char(string='Academic Year', required=True, help="For example 2026/2027.")
    date_start = fields.Date(string='Starts On', required=True)
    date_end = fields.Date(string='Ends On', required=True)
    # SRS 4.1: draft = not yet in use, open = active for enrollment and attendance,
    # closed = finished but still readable, archived = locked history.
    state = fields.Selection([
        ('draft', 'Draft'),
        ('open', 'Open'),
        ('closed', 'Closed'),
        ('archived', 'Archived'),
    ], string='Status', default='draft', required=True, tracking=True)
    is_current = fields.Boolean(
        string='Current',
        help='The year offered by default on new classes. Only one year holds it.',
    )
    class_ids = fields.One2many('school.class', 'academic_year_id', string='Classes')
    class_count = fields.Integer(string='Class Count', compute='_compute_class_count')
    active = fields.Boolean(string='Active', default=True)

    _name_unique = models.Constraint(
        'unique(name)',
        'That academic year already exists.',
    )
    _date_order = models.Constraint(
        'CHECK(date_end IS NULL OR date_start IS NULL OR date_end > date_start)',
        'The end date must be after the start date.',
    )

    @api.depends('class_ids')
    def _compute_class_count(self):
        counts = dict(self.env['school.class']._read_group(
            [('academic_year_id', 'in', self.ids)], ['academic_year_id'], ['__count'],
        ))
        for rec in self:
            rec.class_count = counts.get(rec, 0)

    @api.constrains('is_current')
    def _check_single_current_year(self):
        for rec in self.filtered('is_current'):
            clash = self.search(
                [('is_current', '=', True), ('id', '!=', rec.id)], limit=1,
            )
            if clash:
                raise ValidationError(
                    '%s is already the current academic year. Clear it there first.' % clash.name
                )
    def action_open(self):
        self.write({'state': 'open'})

    def action_close(self):
        self.write({'state': 'closed'})

    def action_archive_year(self):
        self.write({'state': 'archived', 'active': False})
    @api.model
    def _default_year(self):
        """The year new classes start on: whichever is flagged current, else the
        newest on record. Returns an empty recordset when none exist yet."""
        return self.search([('is_current', '=', True)], limit=1) or self.search([], limit=1)

    def write(self, vals):
        protected = set(vals) - {'state', 'is_current', 'active'}
        if protected and any(year.state in ('closed', 'archived') for year in self):
            authorized = (
                self.env.context.get('authorized_academic_correction')
                and (self.env.su or self.env.user.has_group(
                    'school_management.group_school_director'))
            )
            if not authorized:
                raise ValidationError(
                    'Closed academic years are read-only. Use an authorized correction workflow.')
        if vals.get('state') == 'open':
            other_current = self.search([
                ('is_current', '=', True), ('id', 'not in', self.ids),
            ])
            if other_current:
                other_current.write({'is_current': False})
            vals.setdefault('is_current', True)
        if vals.get('state') in ('closed', 'archived'):
            vals.setdefault('is_current', False)
        return super().write(vals)

    def action_open(self):
        for year in self:
            if year.state != 'draft':
                raise ValidationError('Only a draft academic year can be opened.')
            year.write({'state': 'open'})

    def action_close(self):
        for year in self:
            if year.state != 'open':
                raise ValidationError('Only an open academic year can be closed.')
            year.write({'state': 'closed'})

    def action_archive_year(self):
        for year in self:
            if year.state != 'closed':
                raise ValidationError('Only a closed academic year can be archived.')
            year.write({'state': 'archived', 'active': False})

    def action_view_classes(self):
        self.ensure_one()
        return {
            'type': 'ir.actions.act_window',
            'name': 'Classes',
            'res_model': 'school.class',
            'view_mode': 'list,form',
            'domain': [('academic_year_id', '=', self.id)],
            'context': {'default_academic_year_id': self.id},
        }


class SchoolAcademicYearCorrection(models.TransientModel):
    _name = 'school.academic.year.correction'
    _description = 'Authorized Academic Year Correction'

    academic_year_id = fields.Many2one(
        'school.academic.year', required=True,
        domain=[('state', 'in', ('closed', 'archived'))])
    name = fields.Char(required=True)
    date_start = fields.Date(required=True)
    date_end = fields.Date(required=True)
    reason = fields.Text(required=True)

    def action_confirm(self):
        self.ensure_one()
        if not self.env.su and not self.env.user.has_group(
                'school_management.group_school_director'):
            raise AccessError('Only a Principal or School Administrator can correct closed years.')
        self.academic_year_id.with_context(authorized_academic_correction=True).write({
            'name': self.name, 'date_start': self.date_start, 'date_end': self.date_end,
        })
        self.academic_year_id.message_post(
            body='Authorized correction: %s' % self.reason)
