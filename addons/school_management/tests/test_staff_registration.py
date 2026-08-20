from dateutil.relativedelta import relativedelta

from odoo import fields
from odoo.exceptions import ValidationError
from odoo.tests.common import TransactionCase


class TestStaffEmailUniqueness(TransactionCase):
    """A staff email becomes the Odoo login of any teacher profile built on it,
    and logins are unique database-wide. Two staff records sharing an address
    therefore fail late, with a raw constraint error at login creation, unless
    registration rejects the duplicate up front.
    """

    def setUp(self):
        super().setUp()
        self.job_title = self.env['school.job.title'].create({
            'name': 'EMAIL Classroom Teacher', 'department': 'academic',
        })

    def _staff(self, first_name, email, phone=None):
        # Phone numbers are unique too, so every record gets one of its own
        # unless the test is deliberately reusing a number.
        seq = self.env['school.staff'].search_count([])
        return self.env['school.staff'].create({
            'first_name': first_name, 'last_name': 'Tester',
            'department': 'academic', 'job_title_id': self.job_title.id,
            'phone': phone or '+2519118%05d' % seq, 'email': email,
        })

    def test_duplicate_email_is_rejected(self):
        self._staff('EMAIL One', 'shared@school.example')
        with self.assertRaises(ValidationError):
            self._staff('EMAIL Two', 'shared@school.example')

    def test_duplicate_email_is_rejected_whatever_the_case(self):
        self._staff('EMAIL Three', 'mixed.case@school.example')
        with self.assertRaises(ValidationError):
            self._staff('EMAIL Four', 'Mixed.Case@School.Example')

    def test_a_named_address_does_not_slip_past_the_check(self):
        self._staff('EMAIL Five', 'named@school.example')
        with self.assertRaises(ValidationError):
            self._staff('EMAIL Six', 'Someone Else <named@school.example>')

    def test_archived_staff_keeps_holding_its_address(self):
        first = self._staff('EMAIL Seven', 'archived@school.example')
        first.active = False
        with self.assertRaises(ValidationError):
            self._staff('EMAIL Eight', 'archived@school.example')

    def test_moving_an_address_onto_a_taken_one_is_rejected(self):
        self._staff('EMAIL Nine', 'nine@school.example')
        ten = self._staff('EMAIL Ten', 'ten@school.example')
        with self.assertRaises(ValidationError):
            ten.email = 'nine@school.example'

    def test_a_record_does_not_collide_with_itself(self):
        staff = self._staff('EMAIL Eleven', 'eleven@school.example')
        staff.write({'phone': '+251911000111'})
        self.assertEqual(staff.email, 'eleven@school.example')

    def test_underscore_is_not_read_as_a_wildcard(self):
        """'a_b@' must not match 'axb@' — =ilike would treat the underscore as
        'any character' if the pattern were passed through unescaped."""
        self._staff('EMAIL Twelve', 'a_b@school.example')
        other = self._staff('EMAIL Thirteen', 'axb@school.example')
        self.assertTrue(other.id)

    def test_the_stored_address_is_normalized(self):
        staff = self._staff('EMAIL Fourteen', ' Fourteen@School.Example ')
        self.assertEqual(staff.email, 'fourteen@school.example')

    def test_an_unusable_address_is_still_rejected(self):
        with self.assertRaises(ValidationError):
            self._staff('EMAIL Fifteen', 'not-an-address')

    def test_staff_without_an_address_do_not_collide(self):
        self._staff('EMAIL Sixteen', False)
        second = self._staff('EMAIL Seventeen', False)
        self.assertTrue(second.id)


class TestStaffPhoneUniqueness(TransactionCase):
    """A number reaches one person, so two staff records sharing one is a
    data-entry mistake that makes the school's own contact list unusable.
    """

    def setUp(self):
        super().setUp()
        self.job_title = self.env['school.job.title'].create({
            'name': 'PHONE Classroom Teacher', 'department': 'academic',
        })

    def _staff(self, first_name, phone):
        # Keyed on the name, not a record count: an archived staff member still
        # holds its email address, so a count would hand the address of an
        # archived record straight to the next one.
        return self.env['school.staff'].create({
            'first_name': first_name, 'last_name': 'Tester',
            'department': 'academic', 'job_title_id': self.job_title.id,
            'phone': phone,
            'email': '%s@school.example' % first_name.lower().replace(' ', '.'),
        })

    def test_duplicate_number_is_rejected(self):
        self._staff('PHONE One', '+251911223344')
        with self.assertRaises(ValidationError):
            self._staff('PHONE Two', '+251911223344')

    def test_the_same_number_typed_differently_is_still_a_duplicate(self):
        self._staff('PHONE Three', '+251911223355')
        for variant in ('0911223355', '251911223355', '+251 91 122 33 55'):
            with self.subTest(variant=variant), self.assertRaises(ValidationError):
                self._staff('PHONE Four', variant)

    def test_a_different_number_is_accepted(self):
        self._staff('PHONE Five', '+251911223366')
        other = self._staff('PHONE Six', '+251911223367')
        self.assertTrue(other.id)

    def test_moving_a_number_onto_a_taken_one_is_rejected(self):
        self._staff('PHONE Seven', '+251911223377')
        eight = self._staff('PHONE Eight', '+251911223388')
        with self.assertRaises(ValidationError):
            eight.phone = '+251911223377'

    def test_a_record_does_not_collide_with_itself(self):
        staff = self._staff('PHONE Nine', '+251911223399')
        staff.write({'phone': '0911223399'})
        self.assertEqual(staff.phone, '0911223399')

    def test_an_archived_staff_member_releases_its_number(self):
        """Unlike an email address, which stays taken as an Odoo login, a phone
        line is handed on when someone leaves."""
        first = self._staff('PHONE Ten', '+251911224400')
        first.active = False
        reused = self._staff('PHONE Eleven', '+251911224400')
        self.assertTrue(reused.id)

    def test_staff_without_a_number_do_not_collide(self):
        self._staff('PHONE Twelve', False)
        second = self._staff('PHONE Thirteen', False)
        self.assertTrue(second.id)


class TestStaffAge(TransactionCase):
    """A school cannot employ a child, so registration has to say so rather than
    accept any date in the past.
    """

    def setUp(self):
        super().setUp()
        self.job_title = self.env['school.job.title'].create({
            'name': 'AGE Classroom Teacher', 'department': 'academic',
        })
        self.today = fields.Date.context_today(self.env['school.staff'])

    def _staff(self, first_name, date_of_birth):
        seq = self.env['school.staff'].search_count([])
        return self.env['school.staff'].create({
            'first_name': first_name, 'last_name': 'Tester',
            'department': 'academic', 'job_title_id': self.job_title.id,
            'phone': '+2519119%05d' % seq, 'date_of_birth': date_of_birth,
            'email': '%s@school.example' % first_name.lower().replace(' ', '.'),
        })

    def test_a_child_cannot_be_registered_as_staff(self):
        with self.assertRaises(ValidationError):
            self._staff('AGE One', self.today - relativedelta(years=1))

    def test_someone_just_under_eighteen_is_rejected(self):
        almost = self.today - relativedelta(years=18) + relativedelta(days=1)
        with self.assertRaises(ValidationError):
            self._staff('AGE Two', almost)

    def test_someone_who_turns_eighteen_today_is_accepted(self):
        staff = self._staff('AGE Three', self.today - relativedelta(years=18))
        self.assertEqual(staff.age, 18)

    def test_an_adult_is_accepted_and_their_age_is_shown(self):
        staff = self._staff('AGE Four', self.today - relativedelta(years=34))
        self.assertEqual(staff.age, 34)

    def test_the_age_follows_a_corrected_birth_date(self):
        staff = self._staff('AGE Five', self.today - relativedelta(years=40))
        staff.date_of_birth = self.today - relativedelta(years=25)
        self.assertEqual(staff.age, 25)

    def test_staff_without_a_birth_date_keep_working(self):
        staff = self._staff('AGE Six', False)
        self.assertEqual(staff.age, 0)

    def test_a_birth_date_in_the_future_is_still_rejected(self):
        with self.assertRaises(ValidationError):
            self._staff('AGE Seven', self.today + relativedelta(years=1))


class TestTeacherHireDate(TransactionCase):
    """The hire date is entered once, on the staff record, and the teacher profile
    starts from it instead of asking for the same date a second time.
    """

    def setUp(self):
        super().setUp()
        self.job_title = self.env['school.job.title'].create({
            'name': 'HIRE Classroom Teacher', 'department': 'academic',
        })

    def _active_staff(self, first_name, hire_date):
        seq = self.env['school.staff'].search_count([])
        staff = self.env['school.staff'].create({
            'first_name': first_name, 'last_name': 'Tester',
            'department': 'academic', 'job_title_id': self.job_title.id,
            'employment_status': 'active', 'date_of_birth': '1990-01-15',
            'hire_date': hire_date, 'phone': '+2519120%05d' % seq,
            'email': '%s@school.example' % first_name.lower().replace(' ', '.'),
        })
        self.env['school.staff.responsibility'].create({
            'staff_id': staff.id, 'responsibility': 'teacher',
            'is_primary': True, 'start_date': '2026-07-01', 'department': 'academic',
        })
        staff.action_activate()
        return staff

    def test_the_teacher_profile_starts_from_the_staff_hire_date(self):
        staff = self._active_staff('HIRE One', '2026-08-01')
        teacher = self.env['school.teacher'].create({'staff_id': staff.id})
        self.assertEqual(str(teacher.hire_date), '2026-08-01')

    def test_a_teacher_who_started_teaching_later_keeps_their_own_date(self):
        staff = self._active_staff('HIRE Two', '2026-08-01')
        teacher = self.env['school.teacher'].create({
            'staff_id': staff.id, 'hire_date': '2026-09-15',
        })
        self.assertEqual(str(teacher.hire_date), '2026-09-15')

    def test_an_edited_teaching_start_date_is_not_overwritten(self):
        staff = self._active_staff('HIRE Three', '2026-08-01')
        teacher = self.env['school.teacher'].create({'staff_id': staff.id})
        teacher.hire_date = '2027-01-10'
        teacher.invalidate_recordset()
        self.assertEqual(str(teacher.hire_date), '2027-01-10')

    def test_a_staff_record_with_no_hire_date_leaves_the_teacher_empty(self):
        staff = self._active_staff('HIRE Four', False)
        teacher = self.env['school.teacher'].create({'staff_id': staff.id})
        self.assertFalse(teacher.hire_date)
