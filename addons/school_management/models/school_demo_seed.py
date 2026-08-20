import base64
from datetime import timedelta

from odoo import api, fields, models
from odoo.exceptions import AccessError


PREFIX = 'SRS Demo'
DEMO_FILE = base64.b64encode(
    b'Fictional SRS demonstration document. Not an official record.')


class SchoolDemoSeed(models.AbstractModel):
    """Repeatable, additive SRS demonstration data for an existing database."""

    _name = 'school.demo.seed'
    _description = 'SRS Demonstration Data Seeder'

    @api.model
    def _one(self, model, domain, values):
        record = self.env[model].search(domain, limit=1)
        return record or self.env[model].create(values)

    @api.model
    def _staff(self, first_name, last_name, department, title, responsibility,
               phone, email, campus, manager=False):
        Staff = self.env['school.staff']
        staff = Staff.search([
            ('first_name', '=', first_name), ('last_name', '=', last_name),
            ('email', '=', email),
        ], limit=1)
        if not staff:
            staff = Staff.create({
                'first_name': first_name, 'last_name': last_name,
                'department': department, 'job_title_id': title.id,
                'employment_type': 'full_time', 'employment_status': 'active',
                # Required to activate, so that no staff member reaches Active
                # without their age having been checked.
                'date_of_birth': '1990-01-15',
                'hire_date': '2026-08-01', 'phone': phone, 'email': email,
                'campus_id': campus.id, 'manager_id': manager.id if manager else False,
            })
        assignment = self._one('school.staff.responsibility', [
            ('staff_id', '=', staff.id), ('responsibility', '=', responsibility),
            ('start_date', '=', fields.Date.to_date('2026-08-01')),
        ], {
            'staff_id': staff.id, 'responsibility': responsibility,
            'is_primary': True, 'department': department,
            'campus_id': campus.id, 'manager_id': manager.id if manager else False,
            'start_date': '2026-08-01',
        })
        if staff.state == 'draft':
            staff.action_activate()
        self._one('school.staff.employment', [
            ('staff_id', '=', staff.id), ('date_start', '=', fields.Date.to_date('2026-08-01')),
        ], {
            'staff_id': staff.id, 'job_title_id': title.id,
            'responsibility': responsibility if responsibility in (
                'teacher', 'homeroom', 'department_head', 'coordinator',
                'registrar', 'finance') else 'frontoffice',
            'manager_id': manager.id if manager else False, 'campus_id': campus.id,
            'date_start': '2026-08-01', 'reason': 'Initial SRS demo appointment',
        })
        return staff

    @api.model
    def _teacher(self, staff, qualification, specialization):
        teacher = self.env['school.teacher'].search([('staff_id', '=', staff.id)], limit=1)
        if not teacher:
            teacher = self.env['school.teacher'].create({
                'staff_id': staff.id, 'qualification': qualification,
                'specialization': specialization, 'years_of_experience': 7,
                'hire_date': '2026-08-01', 'teaching_status': 'active',
                'max_weekly_workload': 24, 'available_days': 'Monday-Friday',
            })
        return teacher

    @api.model
    def _student(self, name, birth_date, gender, guardian, phone, school_class,
                 registration_date, candidate_number=False):
        Student = self.env['school.student'].with_context(
            skip_registration_completeness=True)
        student = Student.search([('name', '=', name)], limit=1)
        if not student:
            values = {
                'name': name, 'first_name': name.split()[0],
                'last_name': name.split()[-1], 'date_of_birth': birth_date,
                'gender': gender, 'nationality_id': self.env.ref('base.et').id,
                'guardian_name': guardian, 'guardian_phone': phone,
                'emergency_contact_name': guardian,
                'emergency_contact_phone': phone,
                'address': 'Addis Ababa, Ethiopia',
                'admission_type': 'new', 'class_id': school_class.id,
                'academic_year_id': school_class.academic_year_id.id,
                'section_id': school_class.section_id.id,
                'education_level': school_class.education_level,
                'stream_id': school_class.stream_id.id,
                'birth_certificate': DEMO_FILE,
                'birth_certificate_filename': 'fictional-birth-certificate.txt',
                'previous_grade_document': DEMO_FILE,
                'previous_grade_document_filename': 'fictional-previous-grade.txt',
                'registration_date': registration_date,
            }
            if candidate_number:
                values.update({
                    'candidate_number': candidate_number,
                    'candidate_registration_date': registration_date,
                })
            student = Student.create(values)
        if student.registration_status in ('draft', 'incomplete'):
            student.action_pending_verification()
        if student.registration_status == 'pending_verification':
            student.write({'registration_status': 'submitted'})
        if student.registration_status == 'submitted':
            student.action_mark_approved()
        return student

    @api.model
    def _assessment(self, name, school_class, subject, term, assignment, scores):
        Assessment = self.env['school.assessment']
        assessment = Assessment.search([
            ('name', '=', name), ('class_id', '=', school_class.id),
            ('subject_id', '=', subject.id), ('term_id', '=', term.id),
        ], limit=1)
        assessment_date = term.date_start + timedelta(days=45)
        if not assessment:
            assessment = Assessment.create({
                'name': name, 'assessment_type': 'test',
                'class_id': school_class.id, 'subject_id': subject.id,
                'term_id': term.id, 'teacher_assignment_id': assignment.id,
                'date': assessment_date, 'max_mark': 100.0, 'weight': 100.0,
            })
        if assessment.state == 'draft':
            assessment.action_open()
        if assessment.state == 'returned':
            assessment.action_reopen()
        if assessment.state == 'open':
            assessment.action_regenerate()
            for mark in assessment.mark_ids:
                score = scores.get(mark.student_id.name)
                if score is not None:
                    mark.write({'score': score, 'mark_status': 'recorded'})
            assessment.action_submit()
        if assessment.state == 'submitted':
            assessment.action_approve()
        if assessment.state == 'approved':
            assessment.action_lock()
        if assessment.state == 'locked':
            assessment.action_publish()
        return assessment

    @api.model
    def seed_all(self):
        if not self.env.user.has_group('base.group_system'):
            raise AccessError('Only a system administrator can load SRS demonstration data.')
        self = self.sudo()
        # Serialize runs so two administrators cannot race the search/create
        # upserts and produce duplicate demonstration records.
        self.env.cr.execute(
            "SELECT pg_advisory_xact_lock(hashtext(%s))",
            ['school_management.srs_demo_seed'],
        )
        self.env['school.grade'].ensure_standard_academic_structure()
        company = self.env.company
        year = self._one('school.academic.year', [('name', '=', '2026/2027')], {
            'name': '2026/2027', 'date_start': '2026-09-01',
            'date_end': '2027-06-30', 'state': 'open', 'is_current': True,
        })
        term1 = self._one('school.term', [
            ('name', '=', 'Term 1'), ('academic_year_id', '=', year.id),
        ], {
            'name': 'Term 1', 'academic_year_id': year.id,
            'date_start': '2026-09-01', 'date_end': '2027-01-31', 'sequence': 10,
        })
        term2 = self._one('school.term', [
            ('name', '=', 'Term 2'), ('academic_year_id', '=', year.id),
        ], {
            'name': 'Term 2', 'academic_year_id': year.id,
            'date_start': '2027-02-01', 'date_end': '2027-06-30', 'sequence': 20,
        })
        campus = self._one('school.campus', [('name', '=', f'{PREFIX} Main Campus')], {
            'name': f'{PREFIX} Main Campus', 'code': 'SRS-MAIN',
            'address': 'Bole, Addis Ababa',
        })
        section = self._one('school.section', [('name', '=', 'SRS Demo A')], {
            'name': 'SRS Demo A', 'sequence': 90,
        })
        shift = self._one('school.shift', [('code', '=', 'SRS-MORNING')], {
            'name': 'SRS Demo Morning', 'code': 'SRS-MORNING',
            'time_start': 8.0, 'time_end': 13.0, 'sequence': 10,
        })
        natural = self.env.ref('school_management.stream_natural_science')
        grade3 = self.env.ref('school_management.grade_3')
        grade11 = self.env.ref('school_management.grade_11')
        class3 = self._one('school.class', [
            ('name', '=', f'{PREFIX} Grade 3'), ('section_id', '=', section.id),
            ('academic_year_id', '=', year.id),
        ], {
            'name': f'{PREFIX} Grade 3', 'grade_id': grade3.id,
            'section_id': section.id, 'academic_year_id': year.id,
            'capacity': 30, 'shift_id': shift.id, 'campus_id': campus.id,
            'education_level': 'primary', 'min_age': 8, 'max_age': 11,
        })
        class11 = self._one('school.class', [
            ('name', '=', f'{PREFIX} Grade 11 Natural'), ('section_id', '=', section.id),
            ('academic_year_id', '=', year.id),
        ], {
            'name': f'{PREFIX} Grade 11 Natural', 'grade_id': grade11.id,
            'section_id': section.id, 'academic_year_id': year.id,
            'capacity': 30, 'shift_id': shift.id, 'stream_id': natural.id,
            'campus_id': campus.id, 'education_level': 'high_school',
            'min_age': 15, 'max_age': 20,
        })

        subject_specs = (
            ('Mathematics', 'SRS-MATH'),
            ('English Language', 'SRS-ENG'),
            ('Environmental Science', 'SRS-ENV'),
            ('Advanced Mathematics', 'SRS-AMATH'),
            ('Biology', 'SRS-BIO'),
            ('Chemistry', 'SRS-CHEM'),
        )
        subjects = {}
        for name, code in subject_specs:
            full_name = f'{PREFIX} {name}'
            subjects[code] = self._one('school.subject', [
                ('name', '=', full_name),
            ], {
                'name': full_name, 'code': code, 'short_name': name,
                'subject_type': 'compulsory',
            })
        for school_class, codes in (
                (class3, ('SRS-MATH', 'SRS-ENG', 'SRS-ENV')),
                (class11, ('SRS-AMATH', 'SRS-BIO', 'SRS-CHEM'))):
            for code in codes:
                self._one('school.grade.subject', [
                    ('class_id', '=', school_class.id),
                    ('subject_id', '=', subjects[code].id),
                ], {
                    'class_id': school_class.id, 'subject_id': subjects[code].id,
                    'stream_id': school_class.stream_id.id,
                    'subject_type': 'compulsory', 'maximum_mark': 100,
                    'pass_mark': 50,
                })

        scheme = self._one('school.grading.scheme', [
            ('name', '=', f'{PREFIX} Standard Grading'),
            ('company_id', '=', company.id),
        ], {
            'name': f'{PREFIX} Standard Grading', 'company_id': company.id,
            'pass_percentage': 50.0,
        })
        for name, minimum, maximum, remark in (
            ('A', 90, 100, 'Excellent'), ('B', 80, 89.99, 'Very Good'),
            ('C', 70, 79.99, 'Good'), ('D', 60, 69.99, 'Satisfactory'),
            ('E', 50, 59.99, 'Pass'), ('F', 0, 49.99, 'Needs Improvement'),
        ):
            self._one('school.grading.band', [
                ('scheme_id', '=', scheme.id), ('name', '=', name),
            ], {
                'scheme_id': scheme.id, 'name': name,
                'minimum_percentage': minimum, 'maximum_percentage': maximum,
                'remark': remark,
            })
        scheme.action_use_for_report_cards()

        title_teacher = self._one('school.job.title', [
            ('name', '=', 'SRS Demo Teacher'), ('department', '=', 'academic'),
        ], {'name': 'SRS Demo Teacher', 'department': 'academic'})
        title_director = self._one('school.job.title', [
            ('name', '=', 'SRS Demo Academic Director'), ('department', '=', 'academic'),
        ], {'name': 'SRS Demo Academic Director', 'department': 'academic'})
        title_registrar = self._one('school.job.title', [
            ('name', '=', 'SRS Demo Registrar'), ('department', '=', 'administration'),
        ], {'name': 'SRS Demo Registrar', 'department': 'administration'})
        director = self._staff(
            'SRS Demo', 'Meron Director', 'academic', title_director,
            'academic_director', '+251911880001', 'srs.demo.director@example.invalid', campus)
        registrar = self._staff(
            'SRS Demo', 'Selam Registrar', 'administration', title_registrar,
            'registrar', '+251911880002', 'srs.demo.registrar@example.invalid', campus,
            manager=director)
        teacher_staff = []
        for index, (last_name, email) in enumerate((
                ('Almaz Mathematics', 'srs.demo.math@example.invalid'),
                ('Dawit Science', 'srs.demo.science@example.invalid'),
                ('Hanna Language', 'srs.demo.language@example.invalid')), start=3):
            teacher_staff.append(self._staff(
                'SRS Demo', last_name, 'academic', title_teacher, 'teacher',
                f'+25191188000{index}', email, campus, manager=director))
        teachers = [
            self._teacher(teacher_staff[0], 'MSc Mathematics', 'Mathematics'),
            self._teacher(teacher_staff[1], 'MSc Biology', 'Natural Sciences'),
            self._teacher(teacher_staff[2], 'MA English', 'Language Education'),
        ]
        class3.homeroom_teacher_id = teachers[0]
        class11.homeroom_teacher_id = teachers[1]

        assignment_map = {}
        assignment_specs = (
            (class3, 'SRS-MATH', teachers[0], 'homeroom', 5),
            (class3, 'SRS-ENG', teachers[2], 'teacher', 4),
            (class3, 'SRS-ENV', teachers[1], 'teacher', 3),
            (class11, 'SRS-AMATH', teachers[0], 'teacher', 5),
            (class11, 'SRS-BIO', teachers[1], 'homeroom', 5),
            (class11, 'SRS-CHEM', teachers[1], 'teacher', 4),
        )
        for school_class, code, teacher, responsibility, periods in assignment_specs:
            assignment = self._one('school.teacher.assignment', [
                ('class_id', '=', school_class.id),
                ('subject_id', '=', subjects[code].id), ('term_id', '=', term1.id),
            ], {
                'teacher_id': teacher.id, 'subject_id': subjects[code].id,
                'class_id': school_class.id, 'term_id': term1.id,
                'responsibility': responsibility, 'weekly_periods': periods,
            })
            assignment_map[(school_class.id, code)] = assignment

        students = []
        student_specs = (
            ('SRS Demo Hana Bekele', '2017-05-12', 'female', 'Bekele Tadesse', '+251911881001', class3, False),
            ('SRS Demo Noah Tesfaye', '2017-09-03', 'male', 'Tesfaye Girma', '+251911881002', class3, False),
            ('SRS Demo Liya Ahmed', '2018-01-18', 'female', 'Ahmed Yusuf', '+251911881003', class3, False),
            ('SRS Demo Abel Kebede', '2010-02-20', 'male', 'Kebede Alemu', '+251911881004', class11, False),
            ('SRS Demo Ruth Solomon', '2009-11-11', 'female', 'Solomon Desta', '+251911881005', class11, False),
            ('SRS Demo Bereket Haile', '2010-06-08', 'male', 'Haile Worku', '+251911881006', class11, False),
        )
        for name, dob, gender, guardian, phone, school_class, candidate in student_specs:
            students.append(self._student(
                name, dob, gender, guardian, phone, school_class,
                term1.date_start, candidate_number=candidate))

        question = self._one('school.registration.question', [
            ('code', '=', 'SRS_DEMO_LEARNING_SUPPORT'),
        ], {
            'name': 'Does the student need additional learning support?',
            'code': 'SRS_DEMO_LEARNING_SUPPORT', 'answer_type': 'text',
            'grade_from': 1, 'grade_to': 12, 'admission_type': 'all',
            'required': False,
        })
        for student in students:
            self._one('school.registration.answer', [
                ('student_id', '=', student.id), ('question_id', '=', question.id),
            ], {
                'student_id': student.id, 'question_id': question.id,
                'value_text': 'No additional support identified in this fictional demo.',
            })

        attendance_date = term1.date_start + timedelta(days=14)
        attendance_states = ('present', 'late', 'present', 'present', 'absent', 'sick')
        for student, status in zip(students, attendance_states):
            enrollment = student.enrollment_ids.filtered(
                lambda item: item.academic_year_id == year)[:1]
            attendance = self.env['school.attendance'].search([
                ('student_id', '=', student.id), ('date', '=', attendance_date),
                ('attendance_type', '=', 'daily'),
            ], limit=1)
            if not attendance:
                self.env['school.attendance'].create({
                    'enrollment_id': enrollment.id, 'date': attendance_date,
                    'status': status, 'note': 'SRS fictional demonstration attendance',
                })

        assessment_scores = {
            'SRS-MATH': (88, 74, 93), 'SRS-ENG': (91, 69, 85),
            'SRS-ENV': (84, 72, 79), 'SRS-AMATH': (86, 77, 92),
            'SRS-BIO': (90, 83, 75), 'SRS-CHEM': (81, 89, 68),
        }
        for school_class, codes, cohort in (
                (class3, ('SRS-MATH', 'SRS-ENG', 'SRS-ENV'), students[:3]),
                (class11, ('SRS-AMATH', 'SRS-BIO', 'SRS-CHEM'), students[3:])):
            for code in codes:
                scores = dict(zip(
                    [student.name for student in cohort], assessment_scores[code]))
                self._assessment(
                    f'{PREFIX} Term 1 {subjects[code].short_name} Test',
                    school_class, subjects[code], term1,
                    assignment_map[(school_class.id, code)], scores)

        cards = self.env['school.report.card']
        for student in students:
            card = cards.search([
                ('student_id', '=', student.id), ('term_id', '=', term1.id),
            ], order='version desc', limit=1)
            if not card:
                card = cards.generate_for(student, term1)
            if card.state == 'draft':
                card.action_approve()
            if card.state == 'approved':
                card.action_publish()

        room3 = self._one('school.room', [('name', '=', f'{PREFIX} Room 301')], {
            'name': f'{PREFIX} Room 301', 'code': 'SRS-R301',
            'room_type': 'classroom', 'capacity': 30,
        })
        lab = self._one('school.room', [('name', '=', f'{PREFIX} Science Lab')], {
            'name': f'{PREFIX} Science Lab', 'code': 'SRS-LAB',
            'room_type': 'laboratory', 'capacity': 30,
        })
        schedule_specs = (
            (class3, 'SRS-MATH', '0', 8.0, 9.0, room3, 'regular'),
            (class3, 'SRS-ENG', '0', 9.0, 10.0, room3, 'regular'),
            (class11, 'SRS-BIO', '1', 8.0, 9.0, lab, 'laboratory'),
            (class11, 'SRS-AMATH', '1', 9.0, 10.0, room3, 'regular'),
        )
        for school_class, code, day, start, end, room, schedule_type in schedule_specs:
            assignment = assignment_map[(school_class.id, code)]
            schedule = self._one('school.class.schedule', [
                ('teacher_assignment_id', '=', assignment.id),
                ('day_of_week', '=', day), ('start_time', '=', start),
            ], {
                'class_id': school_class.id, 'subject_id': subjects[code].id,
                'teacher_id': assignment.teacher_id.id,
                'teacher_assignment_id': assignment.id, 'term_id': term1.id,
                'day_of_week': day, 'start_time': start, 'end_time': end,
                'room_id': room.id, 'schedule_type': schedule_type,
            })
            if schedule.state == 'draft':
                schedule.action_publish()

        program = self._one('school.program', [('name', '=', f'{PREFIX} Parent Conference')], {
            'name': f'{PREFIX} Parent Conference', 'program_type': 'meeting',
            'audience_type': 'class_section', 'class_ids': [(6, 0, [class3.id, class11.id])],
            'start_datetime': '2026-11-14 06:00:00',
            'end_datetime': '2026-11-14 10:00:00',
            'location': f'{PREFIX} Main Hall', 'organizer_id': registrar.id,
            'description': '<p>Fictional parent conference for SRS demonstration.</p>',
        })
        if program.state == 'draft':
            program.action_publish()
        announcement = self._one('school.announcement', [
            ('name', '=', f'{PREFIX} Term 1 Results Published'),
        ], {
            'name': f'{PREFIX} Term 1 Results Published',
            'message': '<p>Fictional Term 1 results are ready for review.</p>',
            'category': 'academic', 'audience_type': 'class_section',
            'class_ids': [(6, 0, [class3.id, class11.id])],
            'priority': '1', 'publish_datetime': fields.Datetime.now(),
        })
        if announcement.state == 'draft':
            announcement.action_publish()

        document_type = self._one('school.document.type', [
            ('code', '=', 'SRS-DEMO-BIRTH'),
        ], {
            'name': 'SRS Demo Birth Certificate', 'code': 'SRS-DEMO-BIRTH',
            'owner_type': 'student', 'sensitive': True,
        })
        for student in students:
            document = self.env['school.document'].search([
                ('student_id', '=', student.id),
                ('document_type_id', '=', document_type.id),
            ], limit=1)
            if not document:
                attachment = self.env['ir.attachment'].create({
                    'name': f'{student.name} - fictional birth certificate.txt',
                    'datas': DEMO_FILE, 'mimetype': 'text/plain',
                    'res_model': 'school.student', 'res_id': student.id,
                })
                document = self.env['school.document'].create({
                    'name': f'{student.name} - Birth Certificate',
                    'document_type_id': document_type.id,
                    'student_id': student.id, 'attachment_id': attachment.id,
                    'sensitivity': 'confidential',
                })
            if document.state == 'uploaded':
                document.action_verify()

        daily_statuses = ('present', 'present', 'late', 'present', 'training')
        all_staff = director | registrar
        for staff in teacher_staff:
            all_staff |= staff
        for staff, status in zip(all_staff, daily_statuses):
            self._one('school.staff.daily.status', [
                ('staff_id', '=', staff.id), ('date', '=', attendance_date),
            ], {
                'staff_id': staff.id, 'date': attendance_date, 'status': status,
            })

        return self.summary()

    @api.model
    def summary(self):
        counts = {}
        for label, model, domain in (
            ('classes', 'school.class', [('name', '=like', f'{PREFIX}%')]),
            ('subjects', 'school.subject', [('name', '=like', f'{PREFIX}%')]),
            ('staff', 'school.staff', [('first_name', '=', PREFIX)]),
            ('teachers', 'school.teacher', [('staff_id.first_name', '=', PREFIX)]),
            ('students', 'school.student', [('name', '=like', f'{PREFIX}%')]),
            ('assignments', 'school.teacher.assignment', [('class_id.name', '=like', f'{PREFIX}%')]),
            ('attendance', 'school.attendance', [('student_id.name', '=like', f'{PREFIX}%')]),
            ('assessments', 'school.assessment', [('name', '=like', f'{PREFIX}%')]),
            ('marks', 'school.mark', [('student_id.name', '=like', f'{PREFIX}%')]),
            ('report_cards', 'school.report.card', [('student_id.name', '=like', f'{PREFIX}%')]),
            ('documents', 'school.document', [('student_id.name', '=like', f'{PREFIX}%')]),
            ('schedules', 'school.class.schedule', [('class_id.name', '=like', f'{PREFIX}%')]),
        ):
            counts[label] = self.env[model].search_count(domain)
        return counts
