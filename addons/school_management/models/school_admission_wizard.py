from odoo import models

class SchoolAdmissionWizard(models.TransientModel):
    _name = 'school.admission.wizard'
    _description = 'Student Registration Wizard'

    def action_new(self):
        return {
            'type': 'ir.actions.act_window',
            'res_model': 'school.student',
            'view_mode': 'form',
            'target': 'current',
            'context': {'default_admission_type': 'new'}
        }

    def action_transfer(self):
        return {
            'type': 'ir.actions.act_window',
            'res_model': 'school.student',
            'view_mode': 'form',
            'target': 'current',
            'context': {'default_admission_type': 'transfer'}
        }

    def action_returning(self):
        return {
            'type': 'ir.actions.act_window',
            'res_model': 'school.enrollment',
            'view_mode': 'form',
            'target': 'current',
            'context': {'default_admission_type': 'returning'}
        }

    def action_readmitted(self):
        return {
            'type': 'ir.actions.act_window',
            'res_model': 'school.enrollment',
            'view_mode': 'form',
            'target': 'current',
            'context': {'default_admission_type': 'readmitted'}
        }
