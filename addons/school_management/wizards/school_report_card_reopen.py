from odoo import fields, models


class SchoolReportCardReopen(models.TransientModel):
    _name = 'school.report.card.reopen'
    _description = 'Reopen Report Card for Correction'

    report_card_id = fields.Many2one(
        'school.report.card', string='Report Card', required=True,
        domain=[('state', '=', 'published')], ondelete='cascade',
    )
    reason = fields.Text(string='Reason', required=True)

    def action_confirm(self):
        self.ensure_one()
        self.report_card_id.action_reopen(self.reason)
        return {'type': 'ir.actions.act_window_close'}
