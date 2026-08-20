from odoo.tests.common import TransactionCase
from odoo.exceptions import AccessError


class TestDemoSeed(TransactionCase):

    def test_seed_requires_system_administrator(self):
        user = self.env['res.users'].create({
            'name': 'SRS Seed Unauthorized User',
            'login': 'srs_seed_unauthorized',
            'group_ids': [(6, 0, [self.env.ref('base.group_user').id])],
        })
        with self.assertRaises(AccessError):
            self.env['school.demo.seed'].with_user(user).seed_all()

    def test_seed_is_complete_and_idempotent(self):
        company = self.env.company
        company.write({
            'school_timezone': 'UTC',
            'school_subject_attendance': True,
            'school_ranking': True,
            'school_approval_required': False,
            'school_capacity_override': True,
        })
        settings_before = (
            company.school_timezone, company.school_subject_attendance,
            company.school_ranking, company.school_approval_required,
            company.school_capacity_override,
        )
        seeder = self.env['school.demo.seed']
        first = seeder.seed_all()
        second = seeder.seed_all()

        self.assertEqual(first, second)
        self.assertEqual(second['classes'], 2)
        self.assertEqual(second['subjects'], 6)
        self.assertEqual(second['staff'], 5)
        self.assertEqual(second['teachers'], 3)
        self.assertEqual(second['students'], 6)
        self.assertEqual(second['assignments'], 6)
        self.assertEqual(second['attendance'], 6)
        self.assertEqual(second['assessments'], 6)
        self.assertEqual(second['marks'], 18)
        self.assertEqual(second['report_cards'], 6)
        self.assertEqual(second['documents'], 6)
        self.assertEqual(second['schedules'], 4)

        cards = self.env['school.report.card'].search([
            ('student_id.name', '=like', 'SRS Demo%'),
        ])
        self.assertEqual(set(cards.mapped('state')), {'published'})
        self.assertTrue(all(0 <= average <= 100
                            for average in cards.mapped('overall_average')))
        self.assertEqual(settings_before, (
            company.school_timezone, company.school_subject_attendance,
            company.school_ranking, company.school_approval_required,
            company.school_capacity_override,
        ))
