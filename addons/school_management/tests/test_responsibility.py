from dateutil.relativedelta import relativedelta

from odoo import fields
from odoo.exceptions import ValidationError
from odoo.tests.common import TransactionCase

YEAR = '2049/2050'


class TestResponsibilityAndStaffControl(TransactionCase):
    """Brief sections 4, 5, 6 and the section 13 lines that depend on them."""

    def _year(self):
        """Academic year is a master record now. Reuse it across a test so the
        class/section/year unique constraint behaves as it does in production."""
        Year = self.env['school.academic.year']
        return Year.search([('name', '=', YEAR)], limit=1) or Year.create({
            'name': YEAR, 'date_start': '2049-01-01', 'date_end': '2050-12-31'})

    def _term(self, ref='term_1'):
        return self.env['school.term'].search([
            ('academic_year_id', '=', self._year().id), ('sequence', '=', 10),
        ], limit=1) or self.env['school.term'].create({
            'name': 'RESP Term', 'academic_year_id': self._year().id,
            'date_start': '2049-01-01', 'date_end': '2050-12-31', 'sequence': 10,
        })

    def _section(self, ref='section_a'):
        return self.env.ref('school_management.%s' % ref)

    def setUp(self):
        super().setUp()
        self.campus_main = self.env['school.campus'].create({'name': 'RESP Main'})
        self.campus_east = self.env['school.campus'].create({'name': 'RESP East'})
        self.job_title = self.env['school.job.title'].create({
            'name': 'RESP Classroom Teacher', 'department': 'academic',
        })
        self.admin_job_title = self.env['school.job.title'].create({
            'name': 'RESP Registrar', 'department': 'administration',
        })
        self.class_a = self.env['school.class'].create({
            'name': 'RESP Grade 1', 'section_id': self._section().id,
            'academic_year_id': self._year().id,
            'is_entry_level': True,
        })
        self.maths = self.env['school.subject'].create({'name': 'RESP Mathematics'})

        self.staff = self._staff('RESP Teacher One', self.campus_main)
        self._teacher_profile = None

    def teacher_profile(self):
        """school.teacher._check_staff_active rejects draft staff, but the control-status
        tests need self.staff to stay in draft. So the profile is built on first use and
        activates the staff record at that point."""
        if not self._teacher_profile:
            if not self.staff.primary_responsibility:
                self._responsibility(self.staff, 'teacher', is_primary=True)
            if self.staff.state != 'active':
                self.staff.action_activate()
            self._teacher_profile = self.env['school.teacher'].create({'staff_id': self.staff.id})
        return self._teacher_profile

    def _staff(self, name, campus, department='academic'):
        title = self.admin_job_title if department == 'administration' else self.job_title
        parts = name.split(' ', 1)
        first_name = parts[0]
        last_name = parts[1] if len(parts) > 1 else 'Staff'
        # Staff email addresses and phone numbers are both unique, so a test that
        # builds a second staff member has to hand it contact details of its own.
        seq = self.env['school.staff'].search_count([])
        return self.env['school.staff'].create({
            'first_name': first_name, 'last_name': last_name,
            'department': department, 'job_title_id': title.id,
            'employment_status': 'active', 'phone': '+2519117%05d' % seq,
            'campus_id': campus.id, 'date_of_birth': '1990-01-15',
            # school.teacher.create auto-provisions a login from this address.
            'email': '%s.%s@test.invalid' % (name.lower().replace(' ', '.'), seq),
        })

    def _responsibility(self, staff, code, **overrides):
        vals = {
            'staff_id': staff.id, 'responsibility': code,
            'start_date': '2026-07-01', 'department': 'academic',
        }
        vals.update(overrides)
        return self.env['school.staff.responsibility'].create(vals)

    def _assignment(self, **overrides):
        vals = {
            'teacher_id': self.teacher_profile().id, 'subject_id': self.maths.id,
            'class_id': self.class_a.id, 'term_id': self._term().id,
        }
        vals.update(overrides)
        return self.env['school.teacher.assignment'].create(vals)

    # ---------- section 13: master-record rename propagates ----------

    def test_renaming_staff_renames_the_teacher(self):
        teacher = self.teacher_profile()
        self.assertEqual(teacher.name, 'RESP Teacher One')
        self.staff.write({'first_name': 'RESP', 'last_name': 'Teacher Renamed'})
        self.assertEqual(teacher.name, 'RESP Teacher Renamed')

    def test_rename_reaches_the_assignment_label(self):
        assignment = self._assignment()
        self.staff.write({'first_name': 'RESP', 'last_name': 'Renamed Again'})
        self.assertIn('RESP Renamed Again', assignment.name)

    # ---------- section 4: control status gates ----------

    def test_staff_cannot_leave_draft_without_a_responsibility(self):
        with self.assertRaises(ValidationError):
            self.staff.action_activate()

    def test_staff_cannot_leave_draft_without_a_birth_date(self):
        """Otherwise the minimum-age rule only applies to whoever chooses to fill
        the field, and staff reach Active with no age ever checked."""
        self._responsibility(self.staff, 'teacher', is_primary=True)
        self.staff.date_of_birth = False
        with self.assertRaises(ValidationError) as caught:
            self.staff.action_activate()
        self.assertIn('Date of Birth', str(caught.exception))

    def test_staff_cannot_leave_draft_without_a_phone(self):
        self._responsibility(self.staff, 'teacher', is_primary=True)
        self.staff.phone = False
        with self.assertRaises(ValidationError):
            self.staff.action_activate()

    def test_staff_activates_once_requirements_are_met(self):
        self._responsibility(self.staff, 'teacher', is_primary=True)
        self.staff.action_activate()
        self.assertEqual(self.staff.state, 'active')

    def test_suspended_staff_cannot_take_a_new_assignment(self):
        self._responsibility(self.staff, 'teacher', is_primary=True)
        self.staff.action_activate()
        self.teacher_profile()
        self.staff.action_suspend()
        with self.assertRaises(ValidationError):
            self._assignment()

    def _current_period(self):
        """A year, term and class that contain today. Every other fixture here sits
        in 2049, which means its assignments are future-dated and are refused by the
        future-dated rule — so a suspension test built on them passes without the
        suspension ever being consulted."""
        today = fields.Date.context_today(self.env['school.staff'])
        year = self.env['school.academic.year'].create({
            'name': 'RESP Current Year',
            'date_start': today - relativedelta(months=6),
            'date_end': today + relativedelta(months=6),
        })
        term = self.env['school.term'].create({
            'name': 'RESP Current Term', 'academic_year_id': year.id,
            'date_start': year.date_start, 'date_end': year.date_end, 'sequence': 10,
        })
        school_class = self.env['school.class'].create({
            'name': 'RESP Current Grade', 'section_id': self._section().id,
            'academic_year_id': year.id, 'is_entry_level': True,
        })
        return term, school_class

    def test_suspension_is_what_blocks_an_assignment_running_today(self):
        self._responsibility(self.staff, 'teacher', is_primary=True)
        self.staff.action_activate()
        self.teacher_profile()
        term, school_class = self._current_period()
        other_subject = self.env['school.subject'].create({'name': 'RESP Physics'})

        # Positive control: accepted while the staff member is active, which proves
        # the refusal below is about the suspension and not about the dates.
        self._assignment(class_id=school_class.id, term_id=term.id)

        self.staff.action_suspend()
        with self.assertRaises(ValidationError) as caught:
            self._assignment(
                class_id=school_class.id, term_id=term.id, subject_id=other_subject.id)
        self.assertIn('Suspended', str(caught.exception))

    def test_deactivating_staff_disables_the_linked_login(self):
        user = self.env['res.users'].create({'name': 'RESP User', 'login': 'resp_user'})
        self.staff.user_id = user.id
        self._responsibility(self.staff, 'teacher', is_primary=True)
        self.staff.action_activate()
        self.staff.action_deactivate()
        self.assertFalse(user.active)
        self.assertEqual(self.staff.state, 'inactive')

    # ---------- section 6: responsibility rules ----------

    def test_only_one_primary_responsibility_per_staff(self):
        self._responsibility(self.staff, 'teacher', is_primary=True)
        with self.assertRaises(ValidationError):
            self._responsibility(self.staff, 'librarian', is_primary=True)

    def test_primary_responsibility_surfaces_on_the_staff_record(self):
        self._responsibility(self.staff, 'homeroom', is_primary=True)
        self.assertEqual(self.staff.primary_responsibility, 'homeroom')

    def test_staff_cannot_report_to_themselves(self):
        with self.assertRaises(ValidationError):
            self._responsibility(self.staff, 'teacher', manager_id=self.staff.id)

    def test_only_one_homeroom_teacher_per_class_and_term(self):
        self._responsibility(self.staff, 'teacher', is_primary=True)
        self.staff.action_activate()
        self._assignment(responsibility='homeroom')

        other_staff = self._staff('RESP Teacher Two', self.campus_main)
        self._responsibility(other_staff, 'teacher', is_primary=True)
        other_staff.action_activate()
        other_teacher = self.env['school.teacher'].create({'staff_id': other_staff.id})
        history = self.env['school.subject'].create({'name': 'RESP History'})
        with self.assertRaises(ValidationError):
            self._assignment(
                teacher_id=other_teacher.id, subject_id=history.id, responsibility='homeroom',
            )

    def test_selecting_assignment_term_uses_term_dates(self):
        term = self._term()
        assignment = self.env['school.teacher.assignment'].new({
            'class_id': self.class_a.id,
            'term_id': term.id,
            'start_date': term.date_start.replace(year=term.date_start.year - 1),
            'end_date': term.date_end.replace(year=term.date_end.year + 1),
        })
        assignment._onchange_term_id()
        self.assertEqual(assignment.start_date, term.date_start)
        self.assertEqual(assignment.end_date, term.date_end)

    def test_creating_assignment_uses_term_dates(self):
        term = self._term()
        assignment = self._assignment()
        self.assertEqual(assignment.start_date, term.date_start)
        self.assertEqual(assignment.end_date, term.date_end)

    # ---------- section 8: audiences that only staff records can satisfy ----------

    def _user_for(self, staff, login, group):
        user = self.env['res.users'].create({
            'name': login, 'login': login,
            'group_ids': [(6, 0, [
                self.env.ref('base.group_user').id,
                self.env.ref(f'school_management.{group}').id,
            ])],
        })
        staff.user_id = user.id
        return user

    def _announcement(self, name, **overrides):
        vals = {'name': name, 'message': '<p>body</p>', 'audience_type': 'all_staff'}
        vals.update(overrides)
        record = self.env['school.announcement'].create(vals)
        record.action_publish()
        return record

    def test_registrar_sees_responsibility_targeted_announcement(self):
        registrar_staff = self._staff('RESP Registrar', self.campus_main, 'administration')
        self._responsibility(
            registrar_staff, 'registrar', is_primary=True, department='administration',
        )
        user = self._user_for(registrar_staff, 'resp_registrar', 'group_school_registrar')

        targeted = self._announcement(
            'RESP For Registrars', audience_type='responsibility', responsibility='registrar',
        )
        other = self._announcement(
            'RESP For Librarians', audience_type='responsibility', responsibility='librarian',
        )
        visible = self.env['school.announcement'].with_user(user).search([])
        self.assertIn(targeted, visible)
        self.assertNotIn(other, visible)

    def test_campus_targeted_announcement_respects_the_staff_campus(self):
        east_staff = self._staff('RESP East Staff', self.campus_east)
        self._responsibility(east_staff, 'librarian', is_primary=True, campus_id=self.campus_east.id)
        user = self._user_for(east_staff, 'resp_east', 'group_school_frontoffice')

        mine = self._announcement(
            'RESP East Notice', audience_type='branch_campus',
            campus_ids=[(6, 0, self.campus_east.ids)],
        )
        theirs = self._announcement(
            'RESP Main Notice', audience_type='branch_campus',
            campus_ids=[(6, 0, self.campus_main.ids)],
        )
        visible = self.env['school.announcement'].with_user(user).search([])
        self.assertIn(mine, visible)
        self.assertNotIn(theirs, visible)

    # ---------- teacher profile linkage & status sync ----------

    def test_teacher_profile_requires_active_staff(self):
        draft_staff = self._staff('RESP Draft Staff', self.campus_main)
        with self.assertRaises(ValidationError):
            self.env['school.teacher'].create({'staff_id': draft_staff.id})

    def test_deactivating_staff_inactivates_teacher_profile(self):
        self._responsibility(self.staff, 'teacher', is_primary=True)
        self.staff.action_activate()
        teacher = self.teacher_profile()
        self.assertEqual(teacher.teaching_status, 'active')

        self.staff.action_suspend()
        self.assertEqual(teacher.teaching_status, 'inactive')

        self.staff.action_activate()
        self.assertEqual(teacher.teaching_status, 'active')

        self.staff.action_deactivate()
        self.assertEqual(teacher.teaching_status, 'inactive')

    def test_duplicate_teacher_profile_rejected(self):
        self._responsibility(self.staff, 'teacher', is_primary=True)
        self.staff.action_activate()
        self.teacher_profile()
        with self.assertRaises(Exception):
            self.env['school.teacher'].create({'staff_id': self.staff.id})
