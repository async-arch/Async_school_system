from odoo.tests.common import TransactionCase


class TestOdoo19UiAccess(TransactionCase):
    """Regression coverage for master-data creation and Odoo 19 form rendering."""

    def test_school_administrator_and_registrar_can_create_master_data(self):
        registrar = self.env['res.users'].create({
            'name': 'UI Access Registrar', 'login': 'ui_access_registrar',
            'group_ids': [(6, 0, [
                self.env.ref('base.group_user').id,
                self.env.ref('school_management.group_school_registrar').id,
            ])],
        })
        for model_name in (
            'school.academic.year', 'school.term', 'school.section',
            'school.class', 'school.subject', 'school.grade.subject',
            'school.teacher', 'school.teacher.assignment',
        ):
            for user in (self.env.ref('base.user_admin'), registrar):
                with self.subTest(model=model_name, user=user.login):
                    self.assertTrue(
                        self.env[model_name].with_user(user).has_access('create'),
                        '%s must be creatable from its administrator/registrar menu'
                        % model_name,
                    )

    def test_mail_thread_forms_use_odoo19_chatter_element(self):
        for xml_id in (
            'view_school_assessment_form', 'view_school_enrollment_form',
            'view_school_teacher_assignment_form', 'view_school_announcement_form',
            'view_school_class_schedule_form', 'view_school_program_form',
            'view_school_staff_responsibility_form',
        ):
            with self.subTest(view=xml_id):
                arch = self.env.ref('school_management.%s' % xml_id).arch_db
                self.assertNotIn('oe_chatter', arch)
                self.assertNotIn('message_follower_ids', arch)
                self.assertNotIn('message_ids', arch)
                self.assertIn('<chatter', arch)

    def test_dependent_academic_pickers_are_scoped(self):
        expected_fragments = {
            'view_school_student_form': [
                "('academic_year_id', '=', academic_year_id)"],
            'view_school_assessment_form': [
                "('grade_subject_ids.class_id', '=', class_id)",
                "('academic_year_id', '=', academic_year_id)",
                'teacher_assignment_id'],
            'view_school_teacher_assignment_form': [
                "('grade_subject_ids.class_id', '=', class_id)",
                "('academic_year_id', '=', academic_year_id)"],
            'view_school_class_schedule_form': [
                "('grade_subject_ids.class_id', '=', class_id)",
                "('academic_year_id', '=', academic_year_id)",
                'teacher_assignment_id'],
            'view_school_enrollment_transfer_form': [
                "('academic_year_id', '=', academic_year_id)"],
        }
        for xml_id, fragments in expected_fragments.items():
            arch = self.env.ref('school_management.%s' % xml_id).arch_db
            for fragment in fragments:
                with self.subTest(view=xml_id, fragment=fragment):
                    self.assertIn(fragment, arch)

    def test_marks_are_generated_roster_rows_not_manual_records(self):
        for xml_id in ('view_school_mark_tree', 'view_school_mark_form'):
            arch = self.env.ref('school_management.%s' % xml_id).arch_db
            with self.subTest(view=xml_id):
                self.assertIn('create="0"', arch)
                self.assertIn('delete="0"', arch)

    def test_report_cards_are_generated_not_manually_created(self):
        arch = self.env.ref(
            'school_management.view_school_report_card_list').arch_db
        self.assertIn('create="0"', arch)
        self.assertIn('Generate Report Card', arch)
        self.assertIn('display="always"', arch)
        self.assertIn('Overall Average (%)', arch)
        action = self.env.ref('school_management.action_school_report_card')
        self.assertIn('Generate Report Card', action.help)

    def test_grading_scheme_form_has_explicit_activation_workflow(self):
        arch = self.env.ref(
            'school_management.view_school_grading_scheme_form').arch_db
        self.assertIn('action_use_for_report_cards', arch)
        self.assertIn('Use for Report Cards', arch)
        self.assertIn('is_company_scheme', arch)
        self.assertIn('cover the complete 0–100 range', arch)

    def test_mark_entry_opens_the_assessment_workflow(self):
        action = self.env.ref('school_management.action_school_my_mark_tasks')
        self.assertEqual(action.res_model, 'school.assessment')
        self.assertEqual(action.view_mode, 'list,form')

    def test_curriculum_uses_a_scoped_explicit_form(self):
        action = self.env.ref('school_management.action_school_grade_subject')
        self.assertEqual(action.view_mode, 'list,form')
        arch = self.env.ref(
            'school_management.view_school_grade_subject_form').arch_db
        self.assertIn("class_grade_level not in ('11', '12')", arch)
        self.assertIn('Maximum &amp; Pass Marks', arch)

    def test_teacher_form_keeps_chatter_below_full_width_content(self):
        arch = self.env.ref(
            'school_management.view_school_teacher_form').arch_db
        self.assertIn('<chatter', arch)
        self.assertGreater(arch.index('<chatter'), arch.index('<sheet'))
        self.assertLess(arch.index('<chatter'), arch.index('</sheet>'))
        self.assertNotIn('<group string="Availability">', arch)

        links_arch = self.env.ref(
            'school_management.view_school_teacher_form_links').arch_db
        self.assertNotIn('expr="//form"', links_arch)

    def test_empty_teacher_list_explains_staff_prerequisites(self):
        help_html = self.env.ref(
            'school_management.action_school_teacher').help
        for instruction in (
            'Registrar', 'Staff', 'Academic', 'Teacher', 'Activate',
        ):
            with self.subTest(instruction=instruction):
                self.assertIn(instruction, help_html)

    def test_teacher_assignment_dates_come_from_term_not_user_input(self):
        assignment_arch = self.env.ref(
            'school_management.view_school_teacher_assignment_form').arch_db
        teacher_arch = self.env.ref(
            'school_management.view_school_teacher_form').arch_db
        for arch in (assignment_arch, teacher_arch):
            with self.subTest(view=arch[:80]):
                self.assertNotIn('name="start_date"', arch)
                self.assertNotIn('name="end_date"', arch)

    def test_assessment_form_guides_scope_and_uses_full_width(self):
        arch = self.env.ref(
            'school_management.view_school_assessment_form').arch_db
        self.assertIn('matching_assignment_count', arch)
        self.assertIn('No active teacher assignment matches', arch)
        self.assertIn('outside the selected term', arch)
        self.assertIn('assessment_date_in_term', arch)
        self.assertIn("('start_date', '&lt;=', date)", arch)
        self.assertIn('<chatter', arch)
        self.assertGreater(arch.index('<chatter'), arch.index('<sheet'))
        self.assertLess(arch.index('<chatter'), arch.index('</sheet>'))

    def test_staff_form_guides_job_title_and_uses_full_width(self):
        arch = self.env.ref(
            'school_management.view_school_staff_form').arch_db
        self.assertIn('Select a Department first', arch)
        self.assertIn("('active', '=', True)", arch)
        self.assertIn('invisible="not department"', arch)
        self.assertIn('<chatter', arch)
        self.assertGreater(arch.index('<chatter'), arch.index('<sheet'))
        self.assertLess(arch.index('<chatter'), arch.index('</sheet>'))

        responsibility_arch = self.env.ref(
            'school_management.view_school_staff_form_responsibility').arch_db
        self.assertNotIn('expr="//form"', responsibility_arch)
