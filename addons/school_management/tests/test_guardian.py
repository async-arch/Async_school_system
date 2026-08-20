import base64

from odoo.exceptions import ValidationError
from odoo.tests.common import TransactionCase

DUMMY_FILE = base64.b64encode(b'fictional test document')


class TestGuardian(TransactionCase):
    """Guardians become partner-backed records on approval, contacts are
    reused across siblings, one primary per student, chars stay in sync."""

    def setUp(self):
        super().setUp()
        self.year = self.env['school.academic.year'].create({
            'name': '2096/2097',
            'date_start': '2096-09-01', 'date_end': '2097-06-30'})
        self.klass = self.env['school.class'].create({
            'name': 'GRD Grade 1',
            'academic_year_id': self.year.id,
            'is_entry_level': True,
        })

    def _student(self, name, guardian='GRD Guardian One', phone='+251911000001'):
        return self.env['school.student'].create({
            'name': name,
            'date_of_birth': '2091-01-01',
            'guardian_name': guardian,
            'guardian_phone': phone,
            'class_id': self.klass.id,
            'academic_year_id': self.year.id,
            'birth_certificate': DUMMY_FILE,
        })

    def _approved(self, name, **kwargs):
        student = self._student(name, **kwargs)
        student.action_mark_submitted()
        student.action_mark_approved()
        return student

    def test_approval_creates_primary_guardian(self):
        student = self._approved('GRD Student One')
        guardian = student.guardian_ids
        self.assertEqual(len(guardian), 1)
        self.assertTrue(guardian.is_primary)
        self.assertEqual(guardian.partner_id.name, 'GRD Guardian One')
        self.assertEqual(guardian.partner_id.phone, '+251911000001')

    def test_siblings_share_one_contact(self):
        first = self._approved('GRD Student One')
        second = self._approved('GRD Student Two')
        self.assertEqual(first.guardian_ids.partner_id, second.guardian_ids.partner_id)

    def test_second_primary_blocked(self):
        student = self._approved('GRD Student One')
        other = self.env['res.partner'].create({'name': 'GRD Uncle'})
        with self.assertRaises(ValidationError):
            self.env['school.student.guardian'].create({
                'student_id': student.id,
                'partner_id': other.id,
                'is_primary': True,
            })

    def test_duplicate_link_blocked(self):
        student = self._approved('GRD Student One')
        with self.assertRaises(Exception), self.env.cr.savepoint():
            self.env['school.student.guardian'].create({
                'student_id': student.id,
                'partner_id': student.guardian_ids.partner_id.id,
            })
            self.env['school.student.guardian'].flush_model()

    def test_primary_change_syncs_intake_chars(self):
        student = self._approved('GRD Student One')
        new_partner = self.env['res.partner'].create({
            'name': 'GRD Guardian Two',
            'phone': '+251911000002',
        })
        student.guardian_ids.partner_id = new_partner
        self.assertEqual(student.guardian_name, 'GRD Guardian Two')
        self.assertEqual(student.guardian_phone, '+251911000002')

    def test_registrar_can_approve_and_create_contact(self):
        registrar = self.env['res.users'].create({
            'name': 'GRD Registrar',
            'login': 'grd_registrar',
            'group_ids': [
                (4, self.env.ref('base.group_user').id),
                (4, self.env.ref('school_management.group_school_registrar').id),
            ],
        })
        student = self._student('GRD Student Reg', guardian='GRD Guardian Reg',
                                phone='+251911000003')
        student.with_user(registrar).action_mark_submitted()
        student.with_user(registrar).action_mark_approved()
        self.assertTrue(student.guardian_ids.partner_id)
