# -*- coding: utf-8 -*-
{
    'name': "School_Management",

    'summary': "Student Registration, Staff Registration, Attendance, and Mark List for Async Tech Solutions",

    'description': """
School Management System
=========================
Manages student and staff registration as master data sources, with linked
attendance tracking and mark/result entry referencing the same student record.
    """,

    'author': "Async Tech Solutions",
    'website': "https://www.asynctechsolutions.com",

    'category': 'Education',
    # Odoo convention: <odoo series>.<major>.<minor>.<patch>. The series prefix is what
    # tells a reader, and the Odoo app store, which Odoo this targets.
    'version': '19.0.1.1.0',
    'license': 'LGPL-3',

    'depends': [
        'base', 'contacts', 'portal', 'mail', 'web',
        'hr', 'hr_attendance', 'hr_holidays',
    ],

    'data': [
        'security/school_security.xml',
        'security/ir.model.access.csv',
        'views/school_admission_wizard_views.xml',
        'views/school_enrollment_views.xml',
        'security/school_record_rules.xml',
        'data/school_academic_year_data.xml',
        'data/school_term_data.xml',
        'data/school_sequence.xml',
        'data/school_enrollment_sequence.xml',
        'data/school_staff_sequence.xml',
        'data/school_job_title_seed_data.xml',
        'data/school_teacher_sequence.xml',
        'data/school_cron.xml',
        'data/school_grade_stream_data.xml',
        'data/school_class_seed_data.xml',
        'data/school_grading_data.xml',
        'views/school_academic_year_views.xml',
        'views/school_term_views.xml',
        'views/school_class_views.xml',
        'views/school_subject_views.xml',
        'views/school_teacher_views.xml',
        'views/school_teacher_dashboard_views.xml',
        'views/school_student_views.xml',
        'views/school_student_dashboard_views.xml',
        'views/school_student_list_views.xml',
        'views/school_student_guardian_views.xml',
        'views/school_grade_subject_views.xml',
        'views/school_staff_views.xml',
        'views/school_attendance_views.xml',
        'views/school_assessment_views.xml',
        'views/school_result_views.xml',
        'views/school_report_card_views.xml',
        'wizards/school_report_card_reopen_views.xml',
        'views/school_mark_views.xml',
        'views/school_room_views.xml',
        'views/school_program_views.xml',
        'views/school_class_schedule_views.xml',
        'views/school_teacher_assignment_views.xml',
        'views/school_responsibility_views.xml',
        'views/school_announcement_views.xml',
        'views/school_documents_views.xml',
        'views/school_dashboard_views.xml',
        'views/school_overview_views.xml',
        'report/school_student_report.xml',
        'data/school_weekday_data.xml',
        'views/school_menu_views.xml',
        'report/school_report_card_report.xml',
        'views/school_srs_views.xml',
        # After school_srs_views.xml: these inherit views defined there.
        'views/school_setup_wizard_views.xml',
        'views/school_day_builder_views.xml',
    ],

    'demo': [
        'demo/school_demo.xml',
    ],

    'application': True,
    'installable': True,
    'auto_install': False,
}
