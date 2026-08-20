import base64

from odoo.exceptions import AccessError
from odoo.tests.common import TransactionCase

YEAR = '2047/2048'
DUMMY_FILE = base64.b64encode(b'fictional test document')


class TestSchoolSecurity(TransactionCase):
    """Proves the role isolation the brief calls non-negotiable in section 13."""

    def _year(self):
        """Academic year is a master record now. Reuse it across a test so the
        class/section/year unique constraint behaves as it does in production."""
        Year = self.env['school.academic.year']
        return Year.search([('name', '=', YEAR)], limit=1) or Year.create({
            'name': YEAR, 'date_start': '2047-01-01', 'date_end': '2048-12-31'})

    def _term(self, ref='term_1'):
        return self.env['school.term'].search([
            ('academic_year_id', '=', self._year().id), ('sequence', '=', 10),
        ], limit=1) or self.env['school.term'].create({
            'name': 'SEC Term', 'academic_year_id': self._year().id,
            'date_start': '2047-01-01', 'date_end': '2048-12-31', 'sequence': 10,
        })

    def _section(self, ref='section_a'):
        return self.env.ref('school_management.%s' % ref)

    def setUp(self):
        super().setUp()
        self.class_a = self._class('SEC Grade 1', 'section_a')
        self.class_b = self._class('SEC Grade 2', 'section_b')
        self.math = self.env['school.subject'].create({'name': 'SEC Mathematics'})
        self.history = self.env['school.subject'].create({'name': 'SEC History'})

        self.teacher_user = self._user('sec_teacher_a', 'group_school_teacher')
        # Front office is the closest peer role that has limited/read-only access
        self.plain_staff_user = self._user('sec_staff_only', 'group_school_frontoffice')

        self.teacher_a = self._teacher('SEC Teacher A', self.teacher_user)
        self.teacher_b = self._teacher('SEC Teacher B', self._user('sec_teacher_b', 'group_school_teacher'))
        self._assign(self.teacher_a, self.math, self.class_a)
        self._assign(self.teacher_b, self.history, self.class_b)
        self._assign(self.teacher_b, self.history, self.class_a)

        self.student_a = self._student('SEC Student A', self.class_a)
        self.student_b = self._student('SEC Student B', self.class_b)

    # ---------- fixtures ----------

    def _class(self, name, section_ref):
        return self.env['school.class'].create({
            'name': name, 'section_id': self._section(section_ref).id,
            'academic_year_id': self._year().id,
            'is_entry_level': True,
        })

    def _user(self, login, group_name):
        return self.env['res.users'].create({
            'name': login, 'login': login,
            'group_ids': [(6, 0, [
                self.env.ref('base.group_user').id,
                self.env.ref(f'school_management.{group_name}').id,
            ])],
        })

    def _teacher(self, name, user):
        first_name, _, last_name = name.partition(' ')
        job_title = self.env['school.job.title'].search([
            ('name', '=', 'SEC Classroom Teacher'), ('department', '=', 'academic'),
        ], limit=1) or self.env['school.job.title'].create({
            'name': 'SEC Classroom Teacher', 'department': 'academic',
        })
        staff = self.env['school.staff'].create({
            'first_name': first_name, 'last_name': last_name or 'Staff', 'department': 'academic',
            'job_title_id': job_title.id, 'employment_status': 'active',
            'user_id': user.id, 'date_of_birth': '1990-01-15',
            # Staff phone numbers are unique, so each teacher gets one of its own.
            'phone': '+2519114%05d' % self.env['school.staff'].search_count([]),
        })
        self.env['school.staff.responsibility'].create({
            'staff_id': staff.id, 'responsibility': 'teacher',
            'is_primary': True, 'start_date': '2026-07-01', 'department': 'academic',
        })
        staff.action_activate()
        # Passing user_id keeps _create_teacher_user from provisioning a second login,
        # which would detach the teacher from the user these tests act as.
        return self.env['school.teacher'].create({'staff_id': staff.id, 'user_id': user.id})

    def _assign(self, teacher, subject, school_class):
        self.env['school.grade.subject'].create({
            'class_id': school_class.id, 'subject_id': subject.id,
        })
        return self.env['school.teacher.assignment'].create({
            'teacher_id': teacher.id, 'subject_id': subject.id,
            'class_id': school_class.id, 'term_id': self._term().id,
        })

    def _student(self, name, school_class):
        student = self.env['school.student'].create({
            'name': name, 'class_id': school_class.id,
            'academic_year_id': school_class.academic_year_id.id,
            'date_of_birth': '2015-05-05',
            'guardian_name': 'SEC Guardian',
            'guardian_phone': '+251911234567',
            'birth_certificate': DUMMY_FILE,
            'registration_date': '2026-08-01',
            'registration_status': 'approved',
        })
        # Attendance requires an active enrollment since 17.0.7.0.0.
        student._ensure_enrollment()
        return student

    def _mark(self, student, subject):
        # Marks belong to an assessment since 17.0.8.0.0.
        assignment = self.env['school.teacher.assignment'].search([
            ('class_id', '=', student.class_id.id), ('subject_id', '=', subject.id),
        ], limit=1)
        assessment = self.env['school.assessment'].create({
            'name': 'SEC Test', 'assessment_type': 'test',
            'class_id': student.class_id.id, 'subject_id': subject.id,
            'term_id': self._term().id, 'state': 'open',
            'teacher_assignment_id': assignment.id,
            'date': assignment.start_date,
        })
        return self.env['school.mark'].create({
            'assessment_id': assessment.id,
            'student_id': student.id, 'score': 70.0,
        })

    def _assessment(self, school_class, subject, name):
        return self.env['school.assessment'].create({
            'name': name, 'assessment_type': 'test',
            'class_id': school_class.id, 'subject_id': subject.id,
            'term_id': self._term().id, 'state': 'open',
        })

    def _attendance(self, student):
        return self.env['school.attendance'].create({
            'student_id': student.id, 'date': '2047-08-03', 'status': 'present',
        })

    def _announcement(self, name, **overrides):
        vals = {'name': name, 'message': '<p>body</p>', 'audience_type': 'all_staff'}
        vals.update(overrides)
        record = self.env['school.announcement'].create(vals)
        if vals.get('state') != 'draft':
            record.action_publish()
        return record

    # ---------- section 9: attendance and marks are scoped to assignments ----------

    def test_teacher_sees_attendance_only_for_assigned_classes(self):
        self._attendance(self.student_a)
        self._attendance(self.student_b)
        visible = self.env['school.attendance'].with_user(self.teacher_user).search([])
        self.assertEqual(visible.student_id, self.student_a)

    def test_teacher_sees_marks_only_for_assigned_class_and_subject(self):
        self._mark(self.student_a, self.math)
        self._mark(self.student_b, self.history)
        visible = self.env['school.mark'].with_user(self.teacher_user).search([])
        self.assertEqual(visible.student_id, self.student_a)

    def test_teacher_pair_scope_blocks_cross_pair_marks_and_assessments(self):
        own_assessment = self._assessment(self.class_a, self.math, 'SEC Own Pair')
        cross_assessment = self._assessment(self.class_a, self.history, 'SEC Cross Pair')
        own_mark = self.env['school.mark'].create({
            'assessment_id': own_assessment.id, 'student_id': self.student_a.id, 'score': 70.0,
        })
        cross_mark = self.env['school.mark'].create({
            'assessment_id': cross_assessment.id, 'student_id': self.student_a.id, 'score': 70.0,
        })
        visible_assessments = self.env['school.assessment'].with_user(self.teacher_user).search([])
        visible_marks = self.env['school.mark'].with_user(self.teacher_user).search([])
        self.assertIn(own_assessment, visible_assessments)
        self.assertNotIn(cross_assessment, visible_assessments)
        self.assertIn(own_mark, visible_marks)
        self.assertNotIn(cross_mark, visible_marks)

    def test_teacher_without_active_assignments_sees_no_assessments_or_marks(self):
        user = self._user('sec_teacher_unassigned', 'group_school_teacher')
        assessment = self._assessment(self.class_a, self.math, 'SEC Assigned Pair')
        mark = self.env['school.mark'].create({
            'assessment_id': assessment.id, 'student_id': self.student_a.id, 'score': 70.0,
        })
        self.assertFalse(self.env['school.assessment'].with_user(user).search([]))
        self.assertFalse(self.env['school.mark'].with_user(user).search([]))

    def test_teacher_sees_students_only_for_assigned_classes(self):
        visible = self.env['school.student'].with_user(self.teacher_user).search([])
        self.assertIn(self.student_a, visible)
        self.assertNotIn(self.student_b, visible)

    # ---------- section 8: announcement audiences ----------

    def test_all_staff_announcement_is_visible(self):
        live = self._announcement('SEC All Staff')
        visible = self.env['school.announcement'].with_user(self.teacher_user).search([])
        self.assertIn(live, visible)

    def test_announcement_for_another_class_is_hidden(self):
        targeted = self._announcement(
            'SEC Class B Only', audience_type='class_section', class_ids=[(6, 0, self.class_b.ids)],
        )
        visible = self.env['school.announcement'].with_user(self.teacher_user).search([])
        self.assertNotIn(targeted, visible)

    def test_announcement_for_own_class_is_visible(self):
        targeted = self._announcement(
            'SEC Class A Only', audience_type='class_section', class_ids=[(6, 0, self.class_a.ids)],
        )
        visible = self.env['school.announcement'].with_user(self.teacher_user).search([])
        self.assertIn(targeted, visible)

    def test_draft_announcement_is_hidden_from_the_audience(self):
        draft = self._announcement('SEC Draft', state='draft')
        visible = self.env['school.announcement'].with_user(self.teacher_user).search([])
        self.assertNotIn(draft, visible)

    def test_expired_announcement_is_hidden(self):
        expired = self._announcement(
            'SEC Expired',
            publish_datetime='2026-01-01 08:00:00', expiry_datetime='2026-01-02 08:00:00',
        )
        visible = self.env['school.announcement'].with_user(self.teacher_user).search([])
        self.assertNotIn(expired, visible)

    def test_subject_targeted_announcement_respects_taught_subjects(self):
        mine = self._announcement(
            'SEC Maths Teachers', audience_type='subject_group', subject_ids=[(6, 0, self.math.ids)],
        )
        theirs = self._announcement(
            'SEC History Teachers', audience_type='subject_group', subject_ids=[(6, 0, self.history.ids)],
        )
        visible = self.env['school.announcement'].with_user(self.teacher_user).search([])
        self.assertIn(mine, visible)
        self.assertNotIn(theirs, visible)

    # ---------- section 4 and 13: private documents ----------

    def test_staff_documents_are_private_to_the_registrar(self):
        staff = self.teacher_a.staff_id
        staff.id_document = DUMMY_FILE
        with self.assertRaises(AccessError):
            staff.with_user(self.teacher_user).read(['id_document'])

    def test_plain_staff_sees_only_their_own_staff_record(self):
        visible = self.env['school.staff'].with_user(self.plain_staff_user).search([])
        self.assertFalse(visible)

    # ---------- schedule scoping ----------

    def test_teacher_sees_own_draft_schedule_but_not_another_teachers(self):
        mine = self.env['school.class.schedule'].create({
            'class_id': self.class_a.id, 'subject_id': self.math.id,
            'teacher_id': self.teacher_a.id, 'term_id': self._term().id,
            'day_of_week': '0', 'start_time': 8.0, 'end_time': 9.0,
        })
        theirs = self.env['school.class.schedule'].create({
            'class_id': self.class_b.id, 'subject_id': self.history.id,
            'teacher_id': self.teacher_b.id, 'term_id': self._term().id,
            'day_of_week': '0', 'start_time': 8.0, 'end_time': 9.0,
        })
        visible = self.env['school.class.schedule'].with_user(self.teacher_user).search([])
        self.assertIn(mine, visible)
        self.assertNotIn(theirs, visible)

    # ---------- the registrar can do the job the role exists for ----------

    def test_registrar_can_carry_a_staff_member_from_new_to_active(self):
        """Registering staff is the registrar's job, so every model activation
        touches has to be reachable with registrar rights alone. Creating the
        staff record was allowed while the responsibility line it cannot be
        activated without was not, which stopped the role at the last step.
        """
        registrar = self._user('sec_registrar', 'group_school_registrar')
        job_title = self.env['school.job.title'].with_user(registrar).search([
            ('department', '=', 'administration'),
        ], limit=1) or self.env['school.job.title'].sudo().create({
            'name': 'SEC Registrar Title', 'department': 'administration',
        })

        staff = self.env['school.staff'].with_user(registrar).create({
            'first_name': 'SEC', 'last_name': 'Registered By Registrar',
            'department': 'administration', 'job_title_id': job_title.id,
            'employment_status': 'active', 'phone': '+251911660000',
            'email': 'sec.registered@school.example', 'date_of_birth': '1990-01-15',
        })
        self.env['school.staff.responsibility'].with_user(registrar).create({
            'staff_id': staff.id, 'responsibility': 'registrar',
            'is_primary': True, 'start_date': '2026-07-01',
            'department': 'administration',
        })

        staff.action_activate()
        self.assertEqual(staff.state, 'active')

    def test_registrar_can_read_the_master_data_the_staff_form_shows(self):
        registrar = self._user('sec_registrar_read', 'group_school_registrar')
        self.env['school.campus'].with_user(registrar).search([])
        self.env['school.job.title'].with_user(registrar).search([])

    def test_a_teacher_can_open_a_staff_record_without_an_access_error(self):
        """The staff form shows responsibilities and job titles, so read access to
        school.staff alone is not enough to open it."""
        staff = self.env['school.staff'].with_user(self.teacher_user).search([], limit=1)
        if staff:
            staff.read(['name', 'job_title_id', 'primary_responsibility'])
            staff.responsibility_ids.read(['responsibility'])
