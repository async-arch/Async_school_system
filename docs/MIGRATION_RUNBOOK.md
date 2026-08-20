# Odoo 17 to Odoo 19 migration runbook

1. Freeze writes and take a PostgreSQL plus filestore backup from Odoo 17.
2. Export a versioned bundle from the frozen snapshot:

   ```bash
   ODOO17_URL=https://old.example ODOO17_DB=school \
   ODOO17_LOGIN=migration ODOO17_PASSWORD='...' \
   python3 scripts/export_odoo17_bundle.py migration/2026-08-12
   ```

3. Verify checksums before transport with
   `python3 scripts/reconcile_migration_bundle.py migration/2026-08-12`.
4. Import in model dependency order through the Odoo 19 ORM. Store every
   `legacy_key` to new-model/new-ID mapping. Consolidate same-year legacy
   transfer enrollments into one enrollment with effective placements.
5. Produce imported totals by status, year, grade, section, subject,
   department, attendance status, assessment state, mark status, attachment,
   and message. Pass these to `--import-totals` and investigate every mismatch.
6. Run clean-install, module, security, portal, copied-data, attachment, and
   smoke tests. Do not permit user writes before the go/no-go decision.
7. On success, activate Odoo 19 and issue password-reset invitations. Retain
   the stopped Odoo 17 stack and final backup for rollback.

Run two full rehearsals from fresh snapshots. The second must be repeatable
with no unexplained reconciliation difference.
