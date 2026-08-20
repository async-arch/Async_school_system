from odoo import fields, models


class SchoolRoom(models.Model):
    _name = 'school.room'
    _description = 'Room / Location'
    _order = 'name'

    name = fields.Char(string='Room', required=True)
    code = fields.Char(string='Room Code')
    room_type = fields.Selection([
        ('classroom', 'Classroom'),
        ('laboratory', 'Laboratory'),
        ('hall', 'Hall'),
        ('library', 'Library'),
        ('office', 'Office'),
        ('other', 'Other'),
    ], string='Room Type', default='classroom')
    capacity = fields.Integer(string='Capacity')
    active = fields.Boolean(string='Active', default=True)

    _room_name_unique = models.Constraint(
        'unique(name)',
        'This room already exists.',
    )
    _capacity_positive = models.Constraint(
        'CHECK(capacity >= 0)',
        'Capacity cannot be negative.',
    )
