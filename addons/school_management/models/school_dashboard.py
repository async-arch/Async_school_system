from odoo import api, fields, models


class SchoolDashboard(models.TransientModel):
    """Brief section 10: the School Administrator overview. Counts are read with sudo
    because the menu is already restricted to School Administrator, and a scoped count
    would understate the school total."""
    _name = 'school.dashboard'
    _description = 'School Administration Overview'

    active_staff_count = fields.Integer(string='Active Staff', compute='_compute_counts')
    active_teacher_count = fields.Integer(string='Active Teachers', compute='_compute_counts')
    missing_document_count = fields.Integer(
        string='Staff Missing Documents', compute='_compute_counts',
    )
    schedule_conflict_count = fields.Integer(
        string='Schedule Conflicts', compute='_compute_counts',
    )
    published_program_count = fields.Integer(
        string='Published Programs', compute='_compute_counts',
    )
    live_announcement_count = fields.Integer(
        string='Live Announcements', compute='_compute_counts',
    )
    inactive_record_count = fields.Integer(
        string='Archived Staff and Teachers', compute='_compute_counts',
    )
    draft_staff_count = fields.Integer(string='Staff in Draft', compute='_compute_counts')

    def _compute_display_name(self):
        for rec in self:
            rec.display_name = 'School Administration Overview'

    @api.model
    def action_open_overview(self):
        """Open a saved transient record. An unsaved one never triggers the compute,
        because these counts depend on other models rather than on any field of their
        own, so the client would render every tile as zero."""
        record = self.create({})
        return {
            'type': 'ir.actions.act_window',
            'name': 'Overview',
            'res_model': self._name,
            'res_id': record.id,
            'view_mode': 'form',
            'views': [(self.env.ref('school_management.view_school_dashboard_form').id, 'form')],
            'target': 'inline',
        }

    @api.depends_context('uid')
    def _compute_counts(self):
        staff = self.env['school.staff'].sudo()
        teacher = self.env['school.teacher'].sudo()
        for rec in self:
            rec.active_staff_count = staff.search_count([('state', '=', 'active')])
            rec.active_teacher_count = teacher.search_count([('teaching_status', '=', 'active')])
            rec.missing_document_count = len(staff.search([]).filtered(
                lambda s: not s.id_document or not s.employment_contract
            ))
            rec.schedule_conflict_count = len(
                self.env['school.class.schedule'].sudo()._conflicting_ids()
            )
            rec.published_program_count = self.env['school.program'].sudo().search_count([
                ('state', '=', 'published'),
            ])
            rec.live_announcement_count = self.env['school.announcement'].sudo().search_count([
                ('is_live', '=', True),
            ])
            rec.inactive_record_count = (
                staff.search_count([('active', '=', False)])
                + teacher.search_count([('active', '=', False)])
            )
            rec.draft_staff_count = staff.search_count([('state', '=', 'draft')])

    def _open(self, name, model, domain, context=None):
        return {
            'type': 'ir.actions.act_window',
            'name': name,
            'res_model': model,
            'view_mode': 'list,form',
            'domain': domain,
            'context': dict(context or {}, active_test=False),
        }

    def action_open_active_staff(self):
        return self._open('Active Staff', 'school.staff', [('state', '=', 'active')])

    def action_open_active_teachers(self):
        return self._open('Active Teachers', 'school.teacher', [('teaching_status', '=', 'active')])

    def action_open_missing_documents(self):
        staff = self.env['school.staff'].sudo().search([]).filtered(
            lambda s: not s.id_document or not s.employment_contract
        )
        return self._open('Staff Missing Documents', 'school.staff', [('id', 'in', staff.ids)])

    def action_open_schedule_conflicts(self):
        conflicts = self.env['school.class.schedule'].sudo()._conflicting_ids()
        return self._open(
            'Schedule Conflicts', 'school.class.schedule', [('id', 'in', conflicts)],
        )

    def action_open_published_programs(self):
        return self._open('Published Programs', 'school.program', [('state', '=', 'published')])

    def action_open_live_announcements(self):
        return self._open('Live Announcements', 'school.announcement', [('is_live', '=', True)])

    def action_open_inactive_staff(self):
        return self._open('Archived Staff', 'school.staff', [('active', '=', False)])

    def action_open_draft_staff(self):
        return self._open('Staff in Draft', 'school.staff', [('state', '=', 'draft')])
