import base64

from odoo.exceptions import ValidationError
from odoo.tests.common import TransactionCase

DUMMY_FILE = base64.b64encode(b'fictional test document')


class TestEnrollment(TransactionCase):
    """The enrollment spine: approval creates it, capacity guards it,
    rolls stay unique, history cannot be deleted."""

    def setUp(self):
        super().setUp()
        self.year = self.env['school.academic.year'].create({
            'name': '2098/2099',
            'date_start': '2098-09-01', 'date_end': '2099-06-30'})
        self.klass = self.env['school.class'].create({
            'name': 'ENR Grade 1',
            'academic_year_id': self.year.id,
            'is_entry_level': True,
            'capacity': 2,
        })

    def _student(self, name):
        return self.env['school.student'].create({
            'name': name,
            'date_of_birth': '2091-01-01',
            'guardian_name': 'Guardian of %s' % name,
            'guardian_phone': '+251911223344',
            'class_id': self.klass.id,
            'academic_year_id': self.year.id,
            'birth_certificate': DUMMY_FILE,
            # The registration constraint re-validates on any class change of an
            # approved student, and the transfer target below is not entry-level.
            'previous_grade_document': DUMMY_FILE,
        })

    def _approved(self, name):
        student = self._student(name)
        student.action_mark_submitted()
        student.action_mark_approved()
        return student

    def test_approval_creates_active_enrollment(self):
        student = self._approved('ENR Student One')
        enrollment = student.enrollment_ids
        self.assertEqual(len(enrollment), 1)
        self.assertEqual(enrollment.state, 'active')
        self.assertEqual(enrollment.class_id, self.klass)
        self.assertEqual(enrollment.academic_year_id, self.year)
        self.assertEqual(enrollment.roll_number, 1)
        self.assertTrue(enrollment.name.startswith('ENR-'))

    def test_registration_class_must_belong_to_selected_year(self):
        other_year = self.env['school.academic.year'].create({
            'name': '2099/2100',
            'date_start': '2099-09-01', 'date_end': '2100-06-30'})
        with self.assertRaisesRegex(ValidationError, 'selected academic year'):
            self.env['school.student'].create({
                'name': 'ENR Wrong Year',
                'date_of_birth': '2091-01-01',
                'guardian_name': 'Guardian',
                'guardian_phone': '+251911223399',
                'class_id': self.klass.id,
                'academic_year_id': other_year.id,
                'birth_certificate': DUMMY_FILE,
            })

    def test_rolls_are_sequential_per_class(self):
        first = self._approved('ENR Student One')
        second = self._approved('ENR Student Two')
        self.assertEqual(first.enrollment_ids.roll_number, 1)
        self.assertEqual(second.enrollment_ids.roll_number, 2)

    def test_capacity_blocks_activation(self):
        self._approved('ENR Student One')
        self._approved('ENR Student Two')
        with self.assertRaises(ValidationError):
            self._approved('ENR Student Three')

    def test_duplicate_active_enrollment_blocked(self):
        student = self._approved('ENR Student One')
        with self.assertRaises(ValidationError):
            self.env['school.enrollment'].create({
                'student_id': student.id,
                'class_id': self.klass.id,
                'state': 'active',
            })

    def test_duplicate_roll_blocked(self):
        student = self._approved('ENR Student One')
        other = self._approved('ENR Student Two')
        with self.assertRaises(ValidationError):
            other.enrollment_ids.roll_number = student.enrollment_ids.roll_number

    def test_active_enrollment_syncs_student_class(self):
        student = self._approved('ENR Student One')
        new_class = self.env['school.class'].create({
            'name': 'ENR Grade 2',
            'academic_year_id': self.year.id,
        })
        student.enrollment_ids.class_id = new_class
        self.assertEqual(student.class_id, new_class)

    def test_history_cannot_be_deleted(self):
        student = self._approved('ENR Student One')
        with self.assertRaises(ValidationError):
            student.enrollment_ids.unlink()

    def test_withdraw_sets_end_date(self):
        student = self._approved('ENR Student One')
        enrollment = student.enrollment_ids
        enrollment.action_withdraw()
        self.assertEqual(enrollment.state, 'withdrawn')
        self.assertTrue(enrollment.end_date)
