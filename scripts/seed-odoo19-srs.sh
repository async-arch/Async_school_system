#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
database="${1:-school}"

docker compose -f docker-compose.odoo19.yml exec -T odoo19 sh -lc \
  'odoo shell -c /etc/odoo/odoo.conf --db_password="$(cat /run/secrets/postgres_password)" -d "$1"' \
  sh "$database" <<'PY'
result = env['school.demo.seed'].seed_all()
expected = {
    'assessments': 6, 'assignments': 6, 'attendance': 6, 'classes': 2,
    'documents': 6, 'marks': 18, 'report_cards': 6, 'schedules': 4,
    'staff': 5, 'students': 6, 'subjects': 6, 'teachers': 3,
}
if result != expected:
    raise RuntimeError('SRS demo reconciliation failed: %r != %r' % (result, expected))
cards = env['school.report.card'].search([
    ('student_id.name', '=like', 'SRS Demo%'),
])
if set(cards.mapped('state')) != {'published'}:
    raise RuntimeError('All SRS demo report cards must be published.')
if any(card.overall_average < 0 or card.overall_average > 100 for card in cards):
    raise RuntimeError('SRS demo report-card averages must be between 0 and 100.')
env.cr.commit()
print('SRS demo seed complete:')
for key, value in sorted(result.items()):
    print('  %s: %s' % (key, value))
PY
