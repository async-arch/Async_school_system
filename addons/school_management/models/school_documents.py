from odoo import api, fields, models
from odoo.exceptions import AccessError, ValidationError

# HR/Registrar and above. Field-level groups keep the binaries out of every other
# role's read access, including the form view and the ORM.
PRIVATE = 'school_management.group_school_registrar'


class SchoolStaffDocuments(models.Model):
    _inherit = 'school.staff'

    id_document = fields.Binary(string='ID Document', attachment=True, groups=PRIVATE)
    id_document_filename = fields.Char(string='ID Document Filename', groups=PRIVATE)
    qualification_document = fields.Binary(
        string='Qualification / Certificate', attachment=True, groups=PRIVATE,
    )
    qualification_document_filename = fields.Char(
        string='Qualification Filename', groups=PRIVATE,
    )
    employment_contract = fields.Binary(
        string='Employment Contract', attachment=True, groups=PRIVATE,
    )
    employment_contract_filename = fields.Char(
        string='Employment Contract Filename', groups=PRIVATE,
    )


class SchoolTeacherDocuments(models.Model):
    _inherit = 'school.teacher'

    qualification_document = fields.Binary(
        string='Qualification Document', attachment=True, groups=PRIVATE,
    )
    qualification_document_filename = fields.Char(
        string='Qualification Filename', groups=PRIVATE,
    )
    employment_document = fields.Binary(
        string='Employment Document', attachment=True, groups=PRIVATE,
    )
    employment_document_filename = fields.Char(
        string='Employment Document Filename', groups=PRIVATE,
    )


class SchoolDocumentType(models.Model):
    _name = 'school.document.type'
    _description = 'School Document Type'
    _order = 'name'

    name = fields.Char(required=True, translate=True)
    code = fields.Char(required=True)
    owner_type = fields.Selection([
        ('student', 'Student'), ('staff', 'Staff'), ('guardian', 'Guardian'),
    ], required=True)
    expires = fields.Boolean()
    sensitive = fields.Boolean(default=False)
    active = fields.Boolean(default=True)

    _school_document_type_code_unique = models.Constraint(
        'unique(code)',
        'Document type codes must be unique.',
    )


class SchoolDocumentRule(models.Model):
    _name = 'school.document.rule'
    _description = 'Required Document Rule'
    _order = 'sequence, id'

    document_type_id = fields.Many2one(
        'school.document.type', required=True, ondelete='cascade')
    sequence = fields.Integer(default=10)
    admission_type = fields.Selection([
        ('all', 'All'), ('new', 'New'), ('transfer', 'Transfer'),
        ('returning', 'Returning'), ('readmitted', 'Re-admitted'),
    ], default='all', required=True)
    grade_from = fields.Integer(default=1)
    grade_to = fields.Integer(default=12)
    stream_id = fields.Many2one('school.stream', ondelete='restrict')
    required = fields.Boolean(default=True)
    active = fields.Boolean(default=True)


class SchoolDocument(models.Model):
    _name = 'school.document'
    _description = 'School Document'
    _inherit = ['mail.thread', 'mail.activity.mixin']
    _order = 'expiry_date, id desc'

    name = fields.Char(required=True, tracking=True)
    document_type_id = fields.Many2one(
        'school.document.type', required=True, ondelete='restrict', index=True)
    student_id = fields.Many2one('school.student', ondelete='restrict', index=True)
    staff_id = fields.Many2one('school.staff', ondelete='restrict', index=True)
    guardian_id = fields.Many2one('res.partner', ondelete='restrict', index=True)
    attachment_id = fields.Many2one(
        'ir.attachment', required=True, ondelete='restrict', groups=PRIVATE)
    state = fields.Selection([
        ('pending', 'Pending'), ('uploaded', 'Uploaded'), ('verified', 'Verified'),
        ('rejected', 'Rejected'), ('expired', 'Expired'),
    ], default='uploaded', required=True, tracking=True)
    sensitivity = fields.Selection([
        ('standard', 'Standard'), ('confidential', 'Confidential'),
        ('medical', 'Medical / Support'),
    ], default='standard', required=True, groups=PRIVATE)
    verified_by_id = fields.Many2one('res.users', readonly=True)
    verified_at = fields.Datetime(readonly=True)
    expiry_date = fields.Date()
    rejection_reason = fields.Text()
    checksum = fields.Char(related='attachment_id.checksum', store=True, readonly=True)

    @api.constrains('student_id', 'staff_id', 'guardian_id', 'document_type_id')
    def _check_owner(self):
        for rec in self:
            owners = [rec.student_id, rec.staff_id, rec.guardian_id]
            if sum(bool(owner) for owner in owners) != 1:
                raise ValidationError('A document must have exactly one owner.')
            expected = rec.document_type_id.owner_type
            actual = 'student' if rec.student_id else 'staff' if rec.staff_id else 'guardian'
            if expected != actual:
                raise ValidationError('The document owner does not match its document type.')

    def action_verify(self):
        self.write({
            'state': 'verified', 'verified_by_id': self.env.user.id,
            'verified_at': fields.Datetime.now(), 'rejection_reason': False,
        })

    def action_reject(self):
        if any(not rec.rejection_reason for rec in self):
            raise ValidationError('A rejection reason is required.')
        self.write({'state': 'rejected'})

    @api.model
    def cron_expire_documents(self):
        today = fields.Date.context_today(self)
        expiring = self.search([
            ('state', 'in', ('uploaded', 'verified')),
            ('expiry_date', '!=', False), ('expiry_date', '<', today),
        ], limit=500)
        expiring.write({'state': 'expired'})

    def unlink(self):
        raise AccessError('Document history cannot be deleted. Archive the attachment if authorized.')
