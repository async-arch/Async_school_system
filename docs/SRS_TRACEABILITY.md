# SRS traceability matrix

This matrix is the release gate for the August 2026 mandatory baseline. A row is
not accepted until its automated evidence and stakeholder UAT evidence are both
attached to the release record.

| Requirement | Implementation | Security | Automated evidence |
|---|---|---|---|
| BR-01, AC-01 | `school.student` registration workflow and approval-time IDs | Registrar ACL and workflow checks | `test_srs_lifecycle.py` |
| BR-02, AC-02 | Registration questions, answers, transfer and document rules | Registrar and sensitive-field groups | `test_srs_lifecycle.py` |
| BR-03, AC-03 | One yearly `school.enrollment`, effective placements and overrides | Registrar/Principal override ACLs | `test_srs_lifecycle.py`, `test_enrollment.py` |
| BR-04, AC-04 | Grade/stream curriculum and effective student subjects | Curriculum ACLs | `test_grade_subject.py` |
| BR-05, AC-05 | Exact effective teacher assignments | Assignment record rules | `test_security.py` |
| BR-06, AC-06 | Assessment rows generated from effective student subjects | Teacher assignment ownership | `test_assessment.py` |
| BR-07, BR-09, AC-07, AC-08 | Placement-derived daily/subject attendance | Exact assignment attendance rule | `test_attendance_roster.py` |
| BR-08, AC-09 | Staff-to-employee link and daily HR status | HR Officer ACL | clean-install model/ACL gate; dedicated HR flow test pending |
| BR-10, AC-10 | Explicit mark statuses and approved-result policy | Teacher/Exam Officer separation | `test_assessment.py` |
| BR-11, AC-11, AC-13 | Approval, locking, publishing, immutable correction events | Exam Officer methods and ACLs | `test_assessment.py` |
| BR-12, AC-12 | Promotion creates the next yearly enrollment | Registrar promotion wizard | `test_srs_lifecycle.py` |
| BR-13 | Metadata-backed verified documents | Registrar/HR/sensitivity ACLs | clean-install model/ACL gate; dedicated document flow test pending |
| BR-14 | Operational dashboards, schedules and announcements preserved | Existing role rules | regression suite |
| BR-15, AC-14 | No hard-delete of academic/audit history | Model methods plus ACL denial | security negative suite |

## Non-functional requirements

| Requirement | Gate |
|---|---|
| NFR-01 security | ACL coverage audit, role CRUD matrix, guessed-URL tests |
| NFR-02 performance | 5,000 students, 300 staff, 150 classes, 50 concurrent workflows; common actions under 3 seconds |
| NFR-03 availability | Odoo/PostgreSQL health checks and reverse-proxy TLS |
| NFR-04 auditability | immutable assessment events and chatter |
| NFR-05 usability | desktop/tablet UAT and clear server validation |
| NFR-06 timezone | `Africa/Addis_Ababa` company setting and timezone tests |
| NFR-07 localization | English release strings are translation-ready |
| NFR-08 data integrity | ORM constraints, reconciliation totals and hashes |
| NFR-09 backup | encrypted off-host DB plus filestore, 30 daily/12 monthly |
| NFR-10 recovery | quarterly restore test; RPO 24h and RTO 4h |
| NFR-11 maintainability | focused model files, static audits and documented migration bundle |
| NFR-12 compatibility | Odoo 19 Community/PostgreSQL 16 clean install and upgrade tests |

## Release blockers

- Clean Odoo 19 install and complete automated suite must pass.
- Two migration rehearsals must reconcile with zero unexplained differences.
- Backup restoration must complete within four hours.
- Administrator, Registrar, Principal, Exam Officer, Teacher, Homeroom Teacher,
  HR, Support, Student, Guardian, and Auditor UAT must be signed.

## External acceptance evidence still required

The repository gates prove installability and covered workflows; they cannot
substitute for a copied Odoo 17 database, production infrastructure, or people.
Before release, attach two migration-rehearsal reconciliations, a successful
encrypted backup restore timed under four hours, the 5,000-student/50-user load
test report, portal/browser acceptance evidence, and signed stakeholder UAT.
