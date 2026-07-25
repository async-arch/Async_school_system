# -*- coding: utf-8 -*-
{
    'name': "School Management",

    'summary': "Student Registration, Attendance, and Mark List for Async Tech Solutions",

    'description': """
School Management System
=========================
Manages student registration as the master data source, with linked
attendance tracking and mark/result entry referencing the same student record.
    """,

    'author': "Async Tech Solutions",
    'website': "https://www.asynctechsolutions.com",

    'category': 'Education',
    'version': '0.1',

    'depends': ['base', 'mail'],

    'data': [
        'security/school_security.xml',
        'security/ir.model.access.csv',
        'data/school_sequence.xml',
        'data/school_class_seed_data.xml',
        'views/school_class_views.xml',
        'views/school_student_views.xml',
        'views/school_attendance_views.xml',
        'views/school_mark_views.xml',
        'views/school_menu_views.xml',
        'report/school_student_report.xml',
    ],

    'demo': [
        'demo/school_demo.xml',
    ],

    # ======================================================= #
   
    # ======================================================= #
    'application': True,  
    'installable': True,
    'auto_install': False,
}