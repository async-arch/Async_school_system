import base64

from odoo.exceptions import ValidationError
from odoo.tests.common import TransactionCase


DUMMY_FILE = base64.b64encode(b'result test document')


class TestAssessmentResults(TransactionCase):
    def setUp(self):
        super().setUp()
        self.year = self.env['school.academic.year'].create({'name': '2098/2099'})
        self.school_class = self.env['school.class'].create({
            'name': 'Result Grade 1', 'academic_year_id': self.year.id, 'is_entry_level': True,
        })
        self.subject = self.env['school.subject'].create({'name': 'Result Mathematics'})
        self.term = self.env.ref('school_management.term_1')
        self.env['school.grade.subject'].create({
            'class_id': self.school_class.id, 'subject_id': self.subject.id,
        })
        self.officer = self.env['res.users'].create({
            'name': 'Result Officer', 'login': 'result_officer',
            'email': 'result_officer@school.example',
            'groups_id': [(6, 0, [
                self.env.ref('base.group_user').id,
                self.env.ref('school_management.group_school_exam_officer').id,
            ])],
        })
        job_title = self.env['school.job.title'].create({
            'name': 'Result Teacher', 'department': 'academic',
        })
        staff = self.env['school.staff'].create({
            'first_name': 'Result', 'last_name': 'Teacher',
            'department': 'academic', 'job_title_id': job_title.id,
            'employment_status': 'active', 'phone': '+251911000002',
            'email': 'result_teacher@school.example',
        })
        self.env['school.staff.responsibility'].create({
            'staff_id': staff.id, 'responsibility': 'teacher',
            'is_primary': True, 'start_date': '2026-07-01', 'department': 'academic',
        })
        staff.action_activate()
        self.teacher = self.env['school.teacher'].create({'staff_id': staff.id})
        self.env['school.teacher.assignment'].create({
            'teacher_id': self.teacher.id, 'subject_id': self.subject.id,
            'class_id': self.school_class.id, 'term_id': self.term.id,
        })
        self.student = self.env['school.student'].create({
            'name': 'Result Student', 'class_id': self.school_class.id,
            'date_of_birth': '2090-01-01', 'guardian_name': 'Result Guardian',
            'guardian_phone': '+251911000001', 'birth_certificate': DUMMY_FILE,
            'registration_date': '2026-08-01', 'registration_status': 'approved',
        })
        self.student._ensure_enrollment()
        self.enrollment = self.student.enrollment_ids.filtered(
            lambda item: item.state == 'active'
        )[:1]

    def _assessment(self, name, weight):
        assessment = self.env['school.assessment'].create({
            'name': name, 'assessment_type': 'test',
            'class_id': self.school_class.id, 'subject_id': self.subject.id,
            'term_id': self.term.id, 'weight': weight, 'state': 'open',
        })
        mark = self.env['school.mark'].create({
            'assessment_id': assessment.id, 'student_id': self.student.id,
            'score': 0.0,
        })
        return assessment, mark

    def _approve(self, assessment, mark, score):
        mark.write({'score': score})
        assessment.action_submit()
        assessment.with_user(self.officer).action_approve()

    def test_weighted_result_uses_approved_marks_only(self):
        first, first_mark = self._assessment('Result Quiz', 1.0)
        second, second_mark = self._assessment('Result Final', 3.0)
        first_mark.write({'score': 50.0})
        second_mark.write({'score': 100.0})
        result = self.env['school.subject.result'].generate_for_subject(
            self.student, self.enrollment, self.school_class, self.subject, self.term,
        )
        self.assertEqual(result.result_status, 'incomplete')
        self._approve(first, first_mark, 50.0)
        self._approve(second, second_mark, 100.0)
        result.action_recalculate()
        self.assertAlmostEqual(result.percentage, 87.5, places=2)
        self.assertEqual(result.grade, 'B')
        self.assertEqual(result.result_status, 'pass')
        self.assertEqual(result.assessment_count, 2)
        self.assertAlmostEqual(result.weight_total, 4.0)

    def test_makeup_status_is_counted_as_replacement_score(self):
        assessment, mark = self._assessment('Result Makeup', 1.0)
        mark.write({'score': 75.0, 'mark_status': 'makeup'})
        assessment.action_submit()
        assessment.with_user(self.officer).action_approve()
        result = self.env['school.subject.result'].generate_for_subject(
            self.student, self.enrollment, self.school_class, self.subject, self.term,
        )
        self.assertEqual(result.result_status, 'pass')
        self.assertAlmostEqual(result.percentage, 75.0, places=2)

    def test_report_card_generation_is_idempotent_and_blocks_incomplete_approval(self):
        assessment, mark = self._assessment('Result Assessment', 1.0)
        card = self.env['school.report.card'].create({
            'student_id': self.student.id, 'enrollment_id': self.enrollment.id,
            'term_id': self.term.id,
        })
        card.action_generate()
        self.assertEqual(card.state, 'generated')
        self.assertEqual(len(card.line_ids), 1)
        self.assertFalse(card.complete)
        with self.assertRaises(ValidationError):
            card.action_approve()
        self._approve(assessment, mark, 90.0)
        card.action_generate()
        self.assertTrue(card.complete)
        self.assertEqual(len(card.line_ids), 1)
        card.action_approve()
        card.action_publish()
        self.assertEqual(card.state, 'published')
        with self.assertRaises(ValidationError):
            card.write({'overall_grade': 'X'})
        reopen_action = card.with_user(self.officer).action_open_reopen_wizard()
        self.assertEqual(reopen_action['res_model'], 'school.report.card.reopen')
        wizard = self.env['school.report.card.reopen'].with_user(self.officer).create({
            'report_card_id': card.id,
            'reason': 'Correct an approved result entry.',
        })
        wizard.action_confirm()
        self.assertEqual(card.state, 'generated')

    def test_default_grading_policy_boundaries(self):
        policy = self.env.ref('school_management.grading_policy_default')
        self.assertEqual(policy.get_grade(90), 'A')
        self.assertEqual(policy.get_grade(89.99), 'B')
        self.assertEqual(policy.get_grade(50), 'E')
        self.assertEqual(policy.get_grade(49.99), 'F')
