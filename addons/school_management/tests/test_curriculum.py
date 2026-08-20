import base64

from odoo.exceptions import ValidationError
from odoo.tests.common import TransactionCase

DUMMY_FILE = base64.b64encode(b'fictional test document')


class TestCurriculum(TransactionCase):
    """Curriculum drives subject rosters: activation derives compulsory
    subjects, mid-year additions reach enrolled students, off-curriculum
    subjects are refused."""

    def setUp(self):
        super().setUp()
        self.year = self.env['school.academic.year'].create({
            'name': '2094/2095',
            'date_start': '2094-09-01', 'date_end': '2095-06-30'})
        self.klass = self.env['school.class'].create({
            'name': 'CUR Grade 1',
            'academic_year_id': self.year.id,
            'is_entry_level': True,
        })
        self.math = self.env['school.subject'].create({'name': 'CUR Mathematics'})
        self.art = self.env['school.subject'].create({'name': 'CUR Art'})
        self.gs_math = self.env['school.grade.subject'].create({
            'class_id': self.klass.id,
            'subject_id': self.math.id,
        })
        self.gs_art = self.env['school.grade.subject'].create({
            'class_id': self.klass.id,
            'subject_id': self.art.id,
            'subject_type': 'optional',
        })

    def _approved(self, name):
        student = self.env['school.student'].create({
            'name': name,
            'date_of_birth': '2089-01-01',
            'guardian_name': 'Guardian of %s' % name,
            'guardian_phone': '+251911330001',
            'class_id': self.klass.id,
            'academic_year_id': self.year.id,
            'birth_certificate': DUMMY_FILE,
        })
        student.action_mark_submitted()
        student.action_mark_approved()
        return student

    def test_activation_derives_compulsory_only(self):
        student = self._approved('CUR Student One')
        subjects = student.enrollment_ids.subject_ids
        self.assertEqual(subjects.subject_id, self.math)
        self.assertEqual(subjects.state, 'enrolled')

    def test_optional_added_manually(self):
        student = self._approved('CUR Student One')
        self.env['school.student.subject'].create({
            'enrollment_id': student.enrollment_ids.id,
            'grade_subject_id': self.gs_art.id,
        })
        self.assertEqual(len(student.enrollment_ids.subject_ids), 2)

    def test_new_compulsory_reaches_enrolled_students(self):
        student = self._approved('CUR Student One')
        science = self.env['school.subject'].create({'name': 'CUR Science'})
        self.env['school.grade.subject'].create({
            'class_id': self.klass.id,
            'subject_id': science.id,
        })
        self.assertIn(science, student.enrollment_ids.subject_ids.subject_id)

    def test_off_curriculum_subject_refused(self):
        student = self._approved('CUR Student One')
        other_class = self.env['school.class'].create({
            'name': 'CUR Grade 2',
            'academic_year_id': self.year.id,
        })
        gs_other = self.env['school.grade.subject'].create({
            'class_id': other_class.id,
            'subject_id': self.art.id,
        })
        with self.assertRaises(ValidationError):
            self.env['school.student.subject'].create({
                'enrollment_id': student.enrollment_ids.id,
                'grade_subject_id': gs_other.id,
            })

    def test_duplicate_subject_enrollment_blocked(self):
        student = self._approved('CUR Student One')
        with self.assertRaises(Exception), self.env.cr.savepoint():
            self.env['school.student.subject'].create({
                'enrollment_id': student.enrollment_ids.id,
                'grade_subject_id': self.gs_math.id,
            })
            self.env['school.student.subject'].flush_model()

    def test_derivation_is_idempotent(self):
        student = self._approved('CUR Student One')
        student.enrollment_ids._derive_subject_enrollments()
        self.assertEqual(len(student.enrollment_ids.subject_ids), 1)

    def test_stream_specific_curriculum_is_only_for_grades_eleven_and_twelve(self):
        grade_10 = self.env.ref('school_management.grade_10')
        grade_10_class = self.env['school.class'].create({
            'name': 'CUR Grade 10 Class', 'grade_id': grade_10.id,
            'academic_year_id': self.year.id,
        })
        natural = self.env['school.stream'].create({
            'name': 'CUR Natural', 'code': 'CUR-NAT',
        })
        with self.assertRaisesRegex(ValidationError, 'Grades 11 and 12'):
            self.env['school.grade.subject'].create({
                'class_id': grade_10_class.id,
                'subject_id': self.math.id,
                'stream_id': natural.id,
            })
