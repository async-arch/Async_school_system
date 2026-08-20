import base64
from datetime import timedelta

from odoo import fields
from odoo.exceptions import AccessError, ValidationError
from odoo.tests.common import TransactionCase

DUMMY_FILE = base64.b64encode(b'fictional test document')


class TestAssessment(TransactionCase):
    """SRS §9: mark lists are generated from subject enrollments, follow the
    Draft→Open→Submitted→Approved→Locked→Published workflow, and reopen only
    through the audited unlock."""

    def setUp(self):
        super().setUp()
        self.today = fields.Date.context_today(self.env['school.assessment'])
        self.yesterday = self.today - timedelta(days=1)
        self.year = self.env['school.academic.year'].create({
            'name': '2096/2097', 'date_start': self.today - timedelta(days=365),
            'date_end': self.today + timedelta(days=365)})
        self.klass = self.env['school.class'].create({
            'name': 'ASM Grade 1',
            'academic_year_id': self.year.id,
            'is_entry_level': True,
        })
        self.other_class = self.env['school.class'].create({
            'name': 'ASM Grade 2',
            'academic_year_id': self.year.id,
        })
        self.math = self.env['school.subject'].create({'name': 'ASM Mathematics'})
        self.art = self.env['school.subject'].create({'name': 'ASM Art'})
        self.term = self.env['school.term'].create({
            'name': 'ASM Term', 'academic_year_id': self.year.id,
            'date_start': self.today - timedelta(days=365),
            'date_end': self.today + timedelta(days=365)})
        self.env['school.grade.subject'].create({
            'class_id': self.klass.id, 'subject_id': self.math.id,
        })
        self.env['school.grade.subject'].create({
            'class_id': self.other_class.id, 'subject_id': self.math.id,
        })

        self.teacher_user = self._user('asm_teacher', 'group_school_teacher')
        self.officer_user = self._user('asm_officer', 'group_school_exam_officer')
        self.registrar_user = self._user('asm_registrar', 'group_school_registrar')
        self._assign(self._teacher('ASM Teacher', self.teacher_user), self.math, self.klass)

        self.student_one = self._approved('ASM Student One', self.yesterday)
        self.student_two = self._approved('ASM Student Two', self.yesterday)

    # ---------- fixtures ----------

    def _user(self, login, group_name):
        # message_post refuses an author without an email address.
        return self.env['res.users'].create({
            'name': login, 'login': login, 'email': f'{login}@school.example',
            'group_ids': [(6, 0, [
                self.env.ref('base.group_user').id,
                self.env.ref(f'school_management.{group_name}').id,
            ])],
        })

    def _teacher(self, name, user):
        first_name, _, last_name = name.partition(' ')
        job_title = self.env['school.job.title'].search([
            ('name', '=', 'ASM Teacher'), ('department', '=', 'academic'),
        ], limit=1) or self.env['school.job.title'].create({
            'name': 'ASM Teacher', 'department': 'academic',
        })
        staff = self.env['school.staff'].create({
            'first_name': first_name, 'last_name': last_name or 'Staff',
            'department': 'academic', 'job_title_id': job_title.id,
            'employment_status': 'active', 'user_id': user.id,
            'date_of_birth': '1990-01-15',
            # Staff phone numbers are unique, so each teacher gets one of its own.
            'phone': '+2519115%05d' % self.env['school.staff'].search_count([]),
        })
        self.env['school.staff.responsibility'].create({
            'staff_id': staff.id, 'responsibility': 'teacher',
            'is_primary': True, 'start_date': '2026-07-01', 'department': 'academic',
        })
        staff.action_activate()
        return self.env['school.teacher'].create({'staff_id': staff.id, 'user_id': user.id})

    def _assign(self, teacher, subject, school_class):
        return self.env['school.teacher.assignment'].create({
            'teacher_id': teacher.id, 'subject_id': subject.id,
            'class_id': school_class.id, 'term_id': self.term.id,
        })

    def _approved(self, name, registration_date):
        student = self.env['school.student'].create({
            'name': name,
            'date_of_birth': '2090-01-01',
            'guardian_name': 'Guardian of %s' % name,
            'guardian_phone': '+251911550001',
            'academic_year_id': self.year.id,
            'class_id': self.klass.id,
            'birth_certificate': DUMMY_FILE,
            'registration_date': registration_date,
        })
        student.action_mark_submitted()
        student.action_mark_approved()
        return student

    def _assessment(self, **overrides):
        vals = {
            'name': 'Test 1', 'assessment_type': 'test',
            'class_id': self.klass.id, 'subject_id': self.math.id,
            'term_id': self.term.id, 'date': self.today,
        }
        vals.update(overrides)
        return self.env['school.assessment'].create(vals)

    # ---------- generation (BR-06, AC-06, AC-07, BR-10) ----------

    def test_open_generates_rows_from_subject_enrollments(self):
        assessment = self._assessment()
        assessment.action_open()
        self.assertEqual(assessment.state, 'open')
        self.assertEqual(len(assessment.mark_ids), 2)
        self.assertEqual(set(assessment.mark_ids.mapped('mark_status')), {'pending'})
        self.assertEqual(set(assessment.mark_ids.mapped('grade')), {False})
        self.assertEqual(assessment.mark_ids.mapped('class_id'), self.klass)

    def test_late_enrollment_not_listed(self):
        assessment = self._assessment(date=self.yesterday)
        assessment.action_open()
        self.assertEqual(len(assessment.mark_ids), 2)
        self._approved('ASM Late Joiner', self.today)
        assessment.action_regenerate()
        self.assertEqual(len(assessment.mark_ids), 2)

    def test_open_without_teacher_assignment_blocked(self):
        with self.assertRaises(ValidationError):
            self._assessment(subject_id=self.art.id)

    def test_scope_onchange_selects_the_exact_active_assignment(self):
        assignment = self.env['school.teacher.assignment'].search([
            ('class_id', '=', self.klass.id),
            ('subject_id', '=', self.math.id),
            ('term_id', '=', self.term.id),
        ], limit=1)
        assessment = self.env['school.assessment'].new({
            'class_id': self.klass.id,
            'subject_id': self.math.id,
            'term_id': self.term.id,
            'date': self.today,
        })
        assessment._onchange_assessment_scope()
        self.assertEqual(assessment.matching_assignment_count, 1)
        self.assertEqual(assessment.teacher_assignment_id, assignment)

    def test_scope_onchange_rejects_assignment_outside_effective_dates(self):
        assessment = self.env['school.assessment'].new({
            'class_id': self.klass.id,
            'subject_id': self.math.id,
            'term_id': self.term.id,
            'date': self.term.date_start - timedelta(days=1),
        })
        assessment._onchange_assessment_scope()
        self.assertEqual(assessment.matching_assignment_count, 0)
        self.assertFalse(assessment.teacher_assignment_id)

    def test_assessment_date_must_be_inside_selected_term(self):
        with self.assertRaisesRegex(
                ValidationError, 'Assessment Date must be within'):
            self._assessment(date=self.term.date_start - timedelta(days=1))

    def test_selecting_term_clamps_default_date_to_its_range(self):
        assessment = self.env['school.assessment'].new({
            'date': self.term.date_start - timedelta(days=1),
            'term_id': self.term.id,
        })
        assessment._onchange_term_id()
        self.assertEqual(assessment.date, self.term.date_start)

        assessment.date = self.term.date_end + timedelta(days=1)
        assessment._onchange_term_id()
        self.assertEqual(assessment.date, self.term.date_end)

    def test_assessment_rejects_assignment_from_another_class(self):
        other_assignment = self._assign(
            self._teacher('ASM Other Teacher', self._user(
                'asm_other_teacher', 'group_school_teacher')),
            self.math, self.other_class)
        with self.assertRaisesRegex(ValidationError, 'exact applicable assignment'):
            self._assessment(teacher_assignment_id=other_assignment.id)

    def test_teacher_cannot_create_mark_rows(self):
        assessment = self._assessment()
        assessment.action_open()
        with self.assertRaises(AccessError):
            self.env['school.mark'].with_user(self.teacher_user).create({
                'assessment_id': assessment.id,
                'student_id': self.student_one.id,
                'score': 50.0,
            })

    # ---------- entry ----------

    def test_score_entry_flips_pending_to_recorded(self):
        assessment = self._assessment()
        assessment.action_open()
        row_one, row_two = assessment.mark_ids
        row_one.write({'score': 85.0})
        self.assertEqual(row_one.mark_status, 'recorded')
        self.assertEqual(row_one.grade, 'B')
        row_two.write({'mark_status': 'absent'})
        self.assertFalse(row_two.grade)

    def test_mark_rejects_student_from_another_class(self):
        """A mark row must belong to the assessment's generated roster."""
        other_student = self.env['school.student'].create({
            'name': 'ASM Grade Two Student',
            'date_of_birth': '2090-01-01',
            'guardian_name': 'Guardian of Grade Two Student',
            'guardian_phone': '+251911550099',
            'academic_year_id': self.year.id,
            'class_id': self.other_class.id,
            'birth_certificate': DUMMY_FILE,
            'previous_grade_document': DUMMY_FILE,
            'registration_status': 'approved',
        })
        assessment = self._assessment()
        with self.assertRaisesRegex(ValidationError, 'not enrolled'):
            self.env['school.mark'].create({
                'assessment_id': assessment.id,
                'student_id': other_student.id,
                'score': 50.0,
            })

    # ---------- workflow (BR-11, AC-13) ----------

    def test_locked_marks_require_authorized_unlock(self):
        assessment = self._assessment()
        assessment.action_open()
        assessment.mark_ids.write({'score': 60.0})
        assessment.with_user(self.teacher_user).action_submit()

        with self.assertRaises(AccessError):
            assessment.with_user(self.registrar_user).action_approve()
        assessment.with_user(self.officer_user).action_approve()
        assessment.with_user(self.officer_user).action_lock()
        self.assertEqual(assessment.state, 'locked')

        with self.assertRaises(ValidationError):
            assessment.mark_ids[0].write({'score': 90.0})
        with self.assertRaises(ValidationError):
            assessment.mark_ids[0].unlink()

        wizard = self.env['school.assessment.unlock'].with_user(self.officer_user).create({
            'assessment_id': assessment.id, 'reason': 'Score typed for the wrong student.',
        })
        wizard.action_confirm()
        self.assertEqual(assessment.state, 'open')
        assessment.mark_ids[0].write({'score': 90.0})
        self.assertTrue(any('wrong student' in body
                            for body in assessment.message_ids.mapped('body')))

    def test_publish_follows_lock(self):
        self.env.company.school_grading_configured = True
        scheme = self.env['school.grading.scheme'].create({
            'name': 'ASM Scheme', 'pass_percentage': 50.0,
            'band_ids': [
                (0, 0, {'name': 'A', 'minimum_percentage': 80, 'maximum_percentage': 100}),
                (0, 0, {'name': 'B', 'minimum_percentage': 50, 'maximum_percentage': 79.99}),
                (0, 0, {'name': 'F', 'minimum_percentage': 0, 'maximum_percentage': 49.99}),
            ],
        })
        self.env.company.school_grading_scheme_id = scheme
        assessment = self._assessment()
        assessment.action_open()
        assessment.action_submit()
        officer = assessment.with_user(self.officer_user)
        officer.action_approve()
        with self.assertRaises(ValidationError):
            officer.action_publish()
        officer.action_lock()
        officer.action_publish()
        self.assertEqual(assessment.state, 'published')

    def test_published_marks_create_versioned_report_card(self):
        scheme = self.env['school.grading.scheme'].create({
            'name': 'ASM Report Scheme', 'pass_percentage': 50.0,
            'band_ids': [
                (0, 0, {'name': 'Pass', 'minimum_percentage': 50, 'maximum_percentage': 100}),
                (0, 0, {'name': 'Fail', 'minimum_percentage': 0, 'maximum_percentage': 49.99}),
            ],
        })
        self.env.company.write({
            'school_grading_configured': True, 'school_grading_scheme_id': scheme.id,
        })
        assessment = self._assessment()
        assessment.action_open()
        assessment.mark_ids.write({'score': 75.0})
        assessment.action_submit()
        officer = assessment.with_user(self.officer_user)
        officer.action_approve()
        officer.action_lock()
        officer.action_publish()
        card = self.env['school.report.card'].generate_for(self.student_one, self.term)
        self.assertEqual(card.version, 1)
        self.assertEqual(card.result, 'pass')
        card.with_user(self.officer_user).action_approve()
        card.with_user(self.officer_user).action_publish()
        correction = self.env['school.report.card'].generate_for(
            self.student_one, self.term, correction_reason='Approved correction')
        correction.with_user(self.officer_user).action_approve()
        correction.with_user(self.officer_user).action_publish()
        self.assertEqual(correction.version, 2)
        self.assertEqual(card.state, 'superseded')

    def test_grading_scheme_activation_requires_complete_percentage_coverage(self):
        scheme = self.env['school.grading.scheme'].create({
            'name': 'ASM Incomplete Scheme', 'pass_percentage': 50.0,
            'band_ids': [
                (0, 0, {'name': 'A', 'minimum_percentage': 90,
                        'maximum_percentage': 100}),
                (0, 0, {'name': 'B', 'minimum_percentage': 80,
                        'maximum_percentage': 89}),
            ],
        })
        with self.assertRaisesRegex(ValidationError, 'cover every percentage'):
            scheme.action_use_for_report_cards()

        scheme.band_ids.create({
            'scheme_id': scheme.id, 'name': 'C',
            'minimum_percentage': 0, 'maximum_percentage': 79.99,
        })
        scheme.band_ids.filtered(lambda band: band.name == 'B').maximum_percentage = 89.99
        scheme.action_use_for_report_cards()
        self.assertEqual(self.env.company.school_grading_scheme_id, scheme)
        self.assertTrue(self.env.company.school_grading_configured)
        self.assertTrue(scheme.is_company_scheme)

    def test_report_card_wizard_generates_and_opens_percentage_average(self):
        scheme = self.env['school.grading.scheme'].create({
            'name': 'ASM Wizard Scheme', 'pass_percentage': 50.0,
            'band_ids': [
                (0, 0, {'name': 'Pass', 'minimum_percentage': 50,
                        'maximum_percentage': 100}),
                (0, 0, {'name': 'Fail', 'minimum_percentage': 0,
                        'maximum_percentage': 49.99}),
            ],
        })
        self.env.company.write({
            'school_grading_configured': True,
            'school_grading_scheme_id': scheme.id,
        })
        assessment = self._assessment()
        assessment.action_open()
        assessment.mark_ids.write({'score': 82.0})
        assessment.action_submit()
        officer = assessment.with_user(self.officer_user)
        officer.action_approve()
        officer.action_lock()
        officer.action_publish()

        wizard = self.env['school.report.card.generate'].with_user(
            self.officer_user).create({
                'student_id': self.student_one.id,
                'term_id': self.term.id,
            })
        action = wizard.action_generate()
        card = self.env['school.report.card'].browse(action['res_id'])
        self.assertEqual(action['res_model'], 'school.report.card')
        self.assertEqual(action['view_mode'], 'form')
        self.assertEqual(card.overall_average, 82.0)

    # ---------- history (regression: marks used to follow the student) ----------

    def test_transfer_does_not_rewrite_mark_class(self):
        assessment = self._assessment(date=self.yesterday)
        assessment.action_open()
        self.env['school.enrollment.transfer'].create({
            'enrollment_id': self.student_one.enrollment_ids.filtered(
                lambda e: e.state == 'active').id,
            'new_class_id': self.other_class.id,
            'effective_date': self.today,
            'reason': 'Historical mark regression',
        }).action_confirm()
        row = assessment.mark_ids.filtered(lambda m: m.student_id == self.student_one)
        self.assertEqual(row.class_id, self.klass)
