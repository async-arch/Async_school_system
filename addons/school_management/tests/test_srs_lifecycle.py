from datetime import date

from odoo.exceptions import ValidationError
from odoo.tests.common import TransactionCase, tagged


@tagged('post_install', '-at_install')
class TestSrsLifecycle(TransactionCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.year = cls.env['school.academic.year'].create({
            'name': '2035/2036', 'date_start': date(2035, 9, 1),
            'date_end': date(2036, 6, 30),
        })
        cls.grade = cls.env.ref('school_management.grade_1')
        cls.section_a = cls.env['school.section'].create({'name': 'SRS-A'})
        cls.section_b = cls.env['school.section'].create({'name': 'SRS-B'})
        cls.class_a = cls.env['school.class'].create({
            'name': 'Grade 1 SRS', 'grade_id': cls.grade.id,
            'section_id': cls.section_a.id, 'academic_year_id': cls.year.id,
            'is_entry_level': True, 'capacity': 10,
        })
        cls.class_b = cls.env['school.class'].create({
            'name': 'Grade 1 SRS', 'grade_id': cls.grade.id,
            'section_id': cls.section_b.id, 'academic_year_id': cls.year.id,
            'is_entry_level': True, 'capacity': 10,
        })

    def _student(self, name='Lifecycle Student'):
        return self.env['school.student'].with_context(
            skip_registration_completeness=True).create({
                'name': name, 'date_of_birth': date(2029, 1, 1),
                'guardian_name': 'Guardian', 'guardian_phone': '+251911000001',
                'class_id': self.class_a.id, 'academic_year_id': self.year.id,
            })

    def test_student_id_generated_only_on_approval(self):
        student = self._student()
        self.assertFalse(student.regno)
        self.assertFalse(student.admission_number)
        student.with_context(skip_registration_completeness=True).registration_status = 'submitted'
        student.action_mark_approved()
        self.assertTrue(student.regno)
        self.assertTrue(student.admission_number)
        original = student.regno
        student.with_context(skip_registration_completeness=True).registration_status = 'submitted'
        student.action_mark_approved()
        self.assertEqual(student.regno, original)

    def test_section_transfer_retains_single_yearly_enrollment(self):
        student = self._student('Transfer Student')
        student.with_context(skip_registration_completeness=True).write({
            'registration_status': 'approved', 'regno': 'SRS-TRANSFER',
        })
        enrollment = self.env['school.enrollment'].create({
            'student_id': student.id, 'class_id': self.class_a.id,
            'enrollment_date': date(2035, 9, 1),
        })
        enrollment.action_activate()
        wizard = self.env['school.enrollment.transfer'].create({
            'enrollment_id': enrollment.id, 'new_class_id': self.class_b.id,
            'effective_date': date(2035, 10, 1), 'reason': 'Balance sections',
        })
        wizard.action_confirm()
        self.assertEqual(len(student.enrollment_ids), 1)
        self.assertEqual(len(enrollment.placement_ids), 2)
        self.assertEqual(enrollment.class_id, self.class_b)

    def test_closed_year_is_read_only(self):
        self.year.write({'state': 'open'})
        self.year.write({'state': 'closed'})
        with self.assertRaises(ValidationError):
            self.year.name = 'Changed'
        self.year.with_context(authorized_academic_correction=True).name = '2035/36 corrected'

    def test_one_enrollment_per_student_and_year_including_drafts(self):
        student = self._student('One Yearly Enrollment')
        student.with_context(skip_registration_completeness=True).write({
            'registration_status': 'approved', 'regno': 'SRS-ONE-YEAR',
        })
        self.env['school.enrollment'].create({
            'student_id': student.id, 'class_id': self.class_a.id,
            'enrollment_date': date(2035, 9, 1),
        })
        with self.assertRaises(ValidationError):
            self.env['school.enrollment'].create({
                'student_id': student.id, 'class_id': self.class_b.id,
                'enrollment_date': date(2035, 9, 2),
            })

    def test_historical_student_cannot_be_deleted(self):
        student = self._student('Permanent Identity')
        student.with_context(skip_registration_completeness=True).write({
            'registration_status': 'approved', 'regno': 'SRS-PERMANENT',
        })
        with self.assertRaises(ValidationError):
            student.unlink()

    def test_streams_are_only_valid_for_grades_above_ten(self):
        grade_10 = self.env.ref('school_management.grade_10')
        natural = self.env['school.stream'].create({
            'name': 'Natural Science Test', 'code': 'NAT-TEST',
        })
        with self.assertRaisesRegex(ValidationError, 'Grades 11 and 12'):
            self.env['school.class'].create({
                'name': 'Grade 10 Invalid Stream', 'grade_id': grade_10.id,
                'academic_year_id': self.year.id, 'stream_id': natural.id,
            })

    def test_grade_eleven_accepts_a_stream(self):
        grade_11 = self.env.ref('school_management.grade_11')
        social = self.env['school.stream'].create({
            'name': 'Social Science Test', 'code': 'SOC-TEST',
        })
        school_class = self.env['school.class'].create({
            'name': 'Grade 11 Social', 'grade_id': grade_11.id,
            'academic_year_id': self.year.id, 'stream_id': social.id,
        })
        self.assertEqual(school_class.stream_id, social)
