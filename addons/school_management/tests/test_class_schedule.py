from odoo.exceptions import ValidationError
from odoo.tests.common import TransactionCase

# A year distinct from seeded/demo records (2026/2027) so the fixture never collides.
YEAR = '2048/2049'


class TestClassSchedule(TransactionCase):

    def _year(self):
        """Academic year is a master record now. Reuse it across a test so the
        class/section/year unique constraint behaves as it does in production."""
        Year = self.env['school.academic.year']
        return Year.search([('name', '=', YEAR)], limit=1) or Year.create({
            'name': YEAR, 'date_start': '2048-01-01', 'date_end': '2049-12-31'})

    def _term(self, ref='term_1'):
        sequence = 1 if ref == 'term_1' else 2
        return self.env['school.term'].search([
            ('academic_year_id', '=', self._year().id), ('sequence', '=', sequence * 10),
        ], limit=1) or self.env['school.term'].create({
            'name': 'TEST Term %s' % sequence, 'academic_year_id': self._year().id,
            'date_start': '2048-01-01' if sequence == 1 else '2049-01-01',
            'date_end': '2048-12-31' if sequence == 1 else '2049-12-31',
            'sequence': sequence * 10,
        })

    def _section(self, ref='section_a'):
        return self.env.ref('school_management.%s' % ref)

    def setUp(self):
        super().setUp()
        self.school_class = self.env['school.class'].create({
            'name': 'TEST Grade 5',
            'section_id': self._section('section_b').id,
            'academic_year_id': self._year().id,
        })
        self.subject = self.env['school.subject'].create({'name': 'TEST Mathematics'})
        self.teacher = self._teacher('TEST Teacher One')
        self.room = self.env['school.room'].create({'name': 'TEST Room 101'})
        self.env['school.teacher.assignment'].create({
            'teacher_id': self.teacher.id,
            'subject_id': self.subject.id,
            'class_id': self.school_class.id,
            'term_id': self._term().id,
        })

    def _teacher(self, name):
        """A teacher needs its own staff master record: staff_id is required and unique."""
        first_name, _, last_name = name.partition(' ')
        job_title = self.env['school.job.title'].search([
            ('name', '=', 'TEST Classroom Teacher'), ('department', '=', 'academic'),
        ], limit=1) or self.env['school.job.title'].create({
            'name': 'TEST Classroom Teacher', 'department': 'academic',
        })
        staff = self.env['school.staff'].create({
            'first_name': first_name,
            'last_name': last_name or 'Staff',
            'department': 'academic',
            'job_title_id': job_title.id,
            'employment_status': 'active',
            'date_of_birth': '1990-01-15',
            # Staff phone numbers are unique, so each teacher gets one of its own.
            'phone': '+2519113%05d' % self.env['school.staff'].search_count([]),
            # school.teacher.create auto-provisions a login from this address.
            'email': '%s@test.invalid' % name.lower().replace(' ', '.'),
        })
        self.env['school.staff.responsibility'].create({
            'staff_id': staff.id, 'responsibility': 'teacher',
            'is_primary': True, 'start_date': '2026-07-01', 'department': 'academic',
        })
        staff.action_activate()
        return self.env['school.teacher'].create({'staff_id': staff.id})

    def _slot(self, **overrides):
        vals = {
            'class_id': self.school_class.id,
            'subject_id': self.subject.id,
            'teacher_id': self.teacher.id,
            'term_id': self._term().id,
            'day_of_week': '0',
            'start_time': 8.0,
            'end_time': 9.0,
            'room_id': self.room.id,
        }
        vals.update(overrides)
        return self.env['school.class.schedule'].create(vals)

    def test_overlapping_slot_is_blocked(self):
        self._slot()
        with self.assertRaises(ValidationError):
            self._slot(start_time=8.5, end_time=9.5)

    def test_teacher_only_conflict_is_blocked(self):
        """Same teacher, different class and room, overlapping time -> still blocked."""
        other_class = self.env['school.class'].create({
            'name': 'TEST Grade 6',
            'section_id': self._section('section_a').id,
            'academic_year_id': self._year().id,
        })
        other_room = self.env['school.room'].create({'name': 'TEST Room 102'})
        self.env['school.teacher.assignment'].create({
            'teacher_id': self.teacher.id,
            'subject_id': self.subject.id,
            'class_id': other_class.id,
            'term_id': self._term().id,
        })
        self._slot()
        with self.assertRaises(ValidationError):
            self._slot(class_id=other_class.id, room_id=other_room.id,
                       start_time=8.5, end_time=9.5)

    def test_class_only_conflict_is_blocked(self):
        """Same class, different teacher/subject/room, overlapping time -> still blocked."""
        other_teacher = self._teacher('TEST Teacher Three')
        other_subject = self.env['school.subject'].create({'name': 'TEST English'})
        other_room = self.env['school.room'].create({'name': 'TEST Room 103'})
        self.env['school.teacher.assignment'].create({
            'teacher_id': other_teacher.id,
            'subject_id': other_subject.id,
            'class_id': self.school_class.id,
            'term_id': self._term().id,
        })
        self._slot()
        with self.assertRaises(ValidationError):
            self._slot(teacher_id=other_teacher.id, subject_id=other_subject.id,
                       room_id=other_room.id, start_time=8.5, end_time=9.5)

    def test_room_only_conflict_is_blocked(self):
        """Same room, different teacher and class, overlapping time -> still blocked."""
        other_teacher = self._teacher('TEST Teacher Four')
        other_class = self.env['school.class'].create({
            'name': 'TEST Grade 7',
            'section_id': self._section('section_a').id,
            'academic_year_id': self._year().id,
        })
        self.env['school.teacher.assignment'].create({
            'teacher_id': other_teacher.id,
            'subject_id': self.subject.id,
            'class_id': other_class.id,
            'term_id': self._term().id,
        })
        self._slot()
        with self.assertRaises(ValidationError):
            self._slot(teacher_id=other_teacher.id, class_id=other_class.id,
                       start_time=8.5, end_time=9.5)

    def test_back_to_back_slot_is_allowed(self):
        self._slot()
        self.assertTrue(self._slot(start_time=9.0, end_time=10.0))

    def test_same_weekday_in_other_term_is_allowed(self):
        self._slot()
        self.env['school.teacher.assignment'].create({
            'teacher_id': self.teacher.id,
            'subject_id': self.subject.id,
            'class_id': self.school_class.id,
            'term_id': self._term('term_2').id,
        })
        self.assertTrue(self._slot(term_id=self._term('term_2').id))

    def test_cancelled_slot_frees_the_room(self):
        self._slot().action_cancel()
        self.assertTrue(self._slot())

    def test_teacher_without_assignment_is_blocked(self):
        unassigned = self._teacher('TEST Teacher Two')
        with self.assertRaises(ValidationError):
            self._slot(teacher_id=unassigned.id)

    def test_slot_needs_a_weekday(self):
        with self.assertRaises(Exception):
            self._slot(day_of_week=False)

    def test_inactive_teacher_cannot_be_published(self):
        slot = self._slot()
        self.teacher.teaching_status = 'inactive'
        with self.assertRaises(ValidationError):
            slot.action_publish()

    def test_reschedule_requires_a_reason(self):
        slot = self._slot()
        with self.assertRaises(ValidationError):
            slot.state = 'rescheduled'
        slot.write({'state': 'rescheduled', 'reschedule_reason': 'Teacher on leave.'})
        self.assertEqual(slot.state, 'rescheduled')

    def test_program_audience_needs_values(self):
        with self.assertRaises(ValidationError):
            self.env['school.program'].create({
                'name': 'TEST Academic Briefing',
                'audience_type': 'subject_group',
                'start_datetime': '2026-08-03 08:00:00',
                'end_datetime': '2026-08-03 10:00:00',
            })
