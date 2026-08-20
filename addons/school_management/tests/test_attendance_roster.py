import base64
from datetime import timedelta

from odoo import fields
from odoo.exceptions import ValidationError
from odoo.tests.common import TransactionCase

DUMMY_FILE = base64.b64encode(b'fictional test document')


class TestAttendanceRoster(TransactionCase):
    """Attendance hangs off enrollments: rosters generate from active
    enrollments within their effective dates, transfers keep history."""

    def setUp(self):
        super().setUp()
        self.today = fields.Date.context_today(self.env['school.attendance'])
        self.yesterday = self.today - timedelta(days=1)
        self.tomorrow = self.today + timedelta(days=1)
        self.year = self.env['school.academic.year'].create({
            'name': '2092/2093',
            'date_start': self.today - timedelta(days=180),
            'date_end': self.today + timedelta(days=180)})
        # Attendance is only recorded on teaching days, so the year needs a term
        # covering the dates these tests use.
        self.env['school.term'].create({
            'name': 'ATT Term', 'academic_year_id': self.year.id,
            'date_start': self.today - timedelta(days=180),
            'date_end': self.today + timedelta(days=180)})
        self.class_a = self.env['school.class'].create({
            'name': 'ATT Grade 1',
            'academic_year_id': self.year.id,
            'is_entry_level': True,
        })
        # Deliberately not entry-level: transfers must not re-demand
        # registration documents.
        self.class_b = self.env['school.class'].create({
            'name': 'ATT Grade 2',
            'academic_year_id': self.year.id,
        })

    def _approved(self, name, registration_date=None):
        student = self.env['school.student'].create({
            'name': name,
            'date_of_birth': '2087-01-01',
            'guardian_name': 'Guardian of %s' % name,
            'guardian_phone': '+251911440001',
            'class_id': self.class_a.id,
            'academic_year_id': self.year.id,
            'birth_certificate': DUMMY_FILE,
            'registration_date': registration_date or self.today,
        })
        student.action_mark_submitted()
        student.action_mark_approved()
        return student

    def _generate(self, klass, date):
        wizard = self.env['school.attendance.roster'].create({
            'class_id': klass.id, 'date': date,
        })
        wizard.action_generate()
        return self.env['school.attendance'].search([
            ('class_id', '=', klass.id), ('date', '=', date),
        ])

    def test_roster_generation_is_idempotent(self):
        self._approved('ATT Student One')
        self._approved('ATT Student Two')
        rows = self._generate(self.class_a, self.today)
        self.assertEqual(len(rows), 2)
        self.assertEqual(set(rows.mapped('status')), {'not_recorded'})
        rows.write({'status': 'present'})
        again = self._generate(self.class_a, self.today)
        self.assertEqual(len(again), 2)
        self.assertEqual(set(again.mapped('status')), {'present'})

    def test_roster_respects_enrollment_date(self):
        self._approved('ATT Late Joiner')
        rows = self._generate(self.class_a, self.yesterday)
        self.assertFalse(rows)

    def test_attendance_before_enrollment_refused(self):
        student = self._approved('ATT Student One')
        with self.assertRaises(ValidationError):
            self.env['school.attendance'].create({
                'student_id': student.id,
                'date': self.yesterday,
            })

    def test_attendance_requires_active_enrollment(self):
        loner = self.env['school.student'].create({
            'name': 'ATT No Enrollment',
            'date_of_birth': '2087-01-01',
            'guardian_name': 'Guardian',
            'guardian_phone': '+251911440002',
            'class_id': self.class_a.id,
            'academic_year_id': self.year.id,
            'birth_certificate': DUMMY_FILE,
            'registration_status': 'approved',
        })
        with self.assertRaises(ValidationError):
            self.env['school.attendance'].create({
                'student_id': loner.id,
                'date': self.today,
            })

    def test_transfer_preserves_history_and_moves_rosters(self):
        student = self._approved('ATT Transfer Student',
                                 registration_date=self.yesterday)
        history = self._generate(self.class_a, self.yesterday)
        self.assertEqual(len(history), 1)

        old = student.enrollment_ids
        wizard = self.env['school.enrollment.transfer'].create({
            'enrollment_id': old.id,
            'new_class_id': self.class_b.id,
            'effective_date': self.today,
            'reason': 'Balance sections',
        })
        wizard.action_confirm()

        self.assertEqual(old.state, 'active')
        self.assertFalse(old.end_date)
        self.assertEqual(len(student.enrollment_ids), 1)
        self.assertEqual(len(old.placement_ids), 2)
        self.assertEqual(old.class_id, self.class_b)
        self.assertEqual(student.class_id, self.class_b)
        self.assertEqual(history.class_id, self.class_a)

        self.assertFalse(self._generate(self.class_a, self.tomorrow))
        moved = self._generate(self.class_b, self.tomorrow)
        self.assertEqual(moved.student_id, student)

    def test_past_attendance_undeletable_for_non_admin(self):
        registrar = self.env['res.users'].create({
            'name': 'ATT Registrar',
            'login': 'att_registrar',
            'group_ids': [
                (4, self.env.ref('base.group_user').id),
                (4, self.env.ref('school_management.group_school_registrar').id),
            ],
        })
        student = self._approved('ATT Student One',
                                 registration_date=self.yesterday)
        old_row = self.env['school.attendance'].create({
            'student_id': student.id, 'date': self.yesterday,
        })
        today_row = self.env['school.attendance'].create({
            'student_id': student.id, 'date': self.today,
        })
        with self.assertRaises(ValidationError):
            old_row.with_user(registrar).unlink()
        today_row.with_user(registrar).unlink()
        self.assertTrue(old_row.exists())
