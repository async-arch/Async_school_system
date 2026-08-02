# DraftNote — QA & Integration Working Update

| | |
|---|---|
| **Intern** | Dawit Worku |
| **Workstream** | Integration / QA lead (brief §12 — Integration Team and Security & QA Team) |
| **Project** | Odoo School Management System |
| **Delivery date** | Thursday, 30 July 2026 |
| **Repository** | `async-arch/Async_school_system.` |
| **Branch at submission** | `main` @ `ff88530` |

---

## 1. Scope owned

Per §12 the Integration and Security/QA workstreams cover:

- Attendance and Mark List teacher permissions, schedule links, relational consistency, regression testing
- Access groups, record rules, document privacy, conflict tests, cross-role tests, demo data, bug log, final integration

In practice this meant acting as the gate on `main`: auditing every incoming PR against the brief, finding and fixing defects before merge, and owning the security layer that the other workstreams' acceptance criteria depend on.

---

## 2. Headline finding

**The security layer specified in §11 did not exist.** `security/school_security.xml` was an empty `<odoo/>` — zero access groups, zero record rules — and all 18 ACL rows were bound to `base.group_user` / `base.group_system`.

Roughly a third of §13's non-negotiable acceptance criteria are statements about what a given role can and cannot see. None of them could be satisfied, and §14 demo steps 11–15 could not be performed at all.

Two further modules named in §2 as the *existing foundation* were also hollow:

| Module | Actual state found |
|---|---|
| Mark List | `models/school_mark.py` was **0 bytes** while being imported. `school_mark_views.xml` was an empty `<odoo/>`. The model did not exist. |
| Attendance | Model existed (48 lines) but its view file was empty and it had no menu — unreachable in the UI. |

---

## 3. Defect log

Severity: **S1** blocks an acceptance criterion · **S2** breaks a workflow · **S3** cosmetic or hygiene.

| # | Sev | Defect | Where found | Status |
|---|---|---|---|---|
| 1 | S1 | No access groups or record rules; §13 role isolation unsatisfiable | Pre-merge audit | Fixed — 7 groups, 17 rules |
| 2 | S1 | `school.mark` model missing entirely | Pre-merge audit | Fixed — model, views, menu |
| 3 | S1 | Attendance had no views and no menu | Pre-merge audit | Fixed |
| 4 | S1 | §6 Responsibility Assignment module absent; non-teaching staff could hold no responsibility, so responsibility-targeted announcements could never reach a Registrar or Librarian | Brief re-audit | Fixed |
| 5 | S1 | `school.teacher.name` was an independent `Char`; renaming the staff master record did **not** propagate. Direct failure of §13 "changing a teacher or staff name in the master record is reflected in linked assignments and schedules" | Brief re-audit | Fixed — now `related='staff_id.name'` |
| 6 | S1 | PR #11 added three models with **zero ACL rows** — non-admin users would hit `AccessError` | PR #11 review | Fixed before merge (`8925fe6`) |
| 7 | S1 | Staff/teacher required documents had no fields at all (§4, §5, §13) | Brief re-audit | Fixed — private binaries |
| 8 | S2 | `staff_id` `NOT NULL` migration fails on databases with existing teacher rows. Odoo logs `unable to set NOT NULL on column 'staff_id'` and silently leaves the column nullable | Post-merge upgrade of PR #14 | **OPEN** — see §7 |
| 9 | S2 | Demo data below §13 minimums (3 staff / 2 teachers vs required 5 / 3) | Acceptance-criteria check | Fixed — 5 / 3 |
| 10 | S2 | **No students in demo data at all**, so attendance and marks could not be exercised in the browser; §14 steps 13 and 15 dead-ended | Browser test-pass preparation | Fixed — PR #17 |
| 11 | S2 | Admin overview tiles all rendered `0` against a database with 5 active staff. Two causes: `create="false"` on the form blocked the transient record, and a compute with no field dependencies never fires for an unsaved record | Browser verification | Fixed |
| 12 | S2 | Test suite passed only against an empty database — fixture values collided with seeded data, 9 of 9 errored once real data existed | Post-seed test run | Fixed — namespaced fixtures |
| 13 | S2 | `admin` password is not `admin` on CLI-created databases; documented login was wrong | Browser test-pass | Fixed + documented |
| 14 | S3 | Unsaved class schedules displayed `False - False ( 00:00)` in the breadcrumb | Browser verification | Fixed |
| 15 | S3 | Merge conflict in `__manifest__.py` between PR #11 and `main` | PR #11 merge | Resolved |
| 16 | S3 | `__manifest__.py` had no `license` key; Odoo warned on every load | Install log review | Fixed |
| 17 | S3 | Two fields on `school.staff` shared the label "Responsibilities" | Upgrade log review | Fixed |
| 18 | S3 | `admin_passwd = admin` and `db_password = odoo` committed in tracked `config/odoo.conf`; DB manager unprotected. §18 forbids committing database credentials | Security review | **OPEN** — see §7 |

**Fixed: 16. Open: 2.**

---

## 4. Integration decisions

Decisions taken as integration lead, with the reasoning, since §15 requires being able to explain them:

**Required fields enforced by constraint, not `required=True`.**
§4 requires name, phone, department, job title, responsibility, and employment status. Setting `required=True` adds a `NOT NULL` to a column that already holds rows, which is exactly the migration that failed in defect #8. A `@api.constrains` gate on leaving Draft gives the same guarantee without a migration that can fail.

**`state` added alongside `employment_status`, not replacing it.**
§4 lists a control status (Draft/Active/Suspended/Inactive/Archived) *and* an employment status. Overwriting the existing selection would have reinterpreted the Staff team's data. Two fields, two meanings.

**Documents and responsibilities added by `_inherit` in separate files.**
Keeps the Staff Registration and Teacher Registration teams' own model and view files untouched, so their PRs don't conflict with the security work.

**One audience-targeting shape shared by programs and announcements.**
`school.announcement` imports `AUDIENCE_TYPES` and `AUDIENCE_VALUE_FIELDS` from `school_program` rather than duplicating them, so one record-rule shape covers both models.

**Record-rule domains use flattened fields on `res.users`.**
`ir.rule` domains run through `safe_eval`, which permits attribute access but not method calls, and has no `datetime` in scope. Both were found the hard way — the first install attempt failed with `name 'datetime' is not defined`. Scope is precomputed into `school_taught_class_ids`, `school_taught_subject_ids`, `school_campus_ids`, and `school_responsibility_list` so every domain is a plain attribute lookup.

**Scope held rather than widened.**
Branch/campus was initially reported as not implementable because nothing modelled a campus. On re-audit, adding a small `school.campus` model made it straightforward, and that earlier assessment was withdrawn and corrected. All eight §8 audience types now work.

---

## 5. Merge gatekeeping record

| PR | Author | Action taken |
|---|---|---|
| #11 Teacher/Subject/Assignment | team | Resolved manifest conflict, **added the 6 missing ACL rows before merge**, then merged |
| #14 Teacher→Staff link, workload | mekhlua | Reviewed, CI green, merged. Post-merge upgrade surfaced defect #8, reported not hidden |
| #15 Program & class scheduling | self | Merged after CI + browser verification |
| #16 Security, marks, announcements, dashboards | self | Merged after 34-test run + three-role browser verification |
| #17 Demo students/attendance/marks | self | Merged |
| **#9 Mark list** | **Jennah198** | **Not merged** — `CONFLICTING`, and now overlaps the `school.mark` model shipped in #16. Flagged to be rebased rather than conflict-fixed |

---

## 6. Test evidence

```
docker compose exec odoo odoo -c /etc/odoo/odoo.conf -d <db> -u school_management \
  --test-enable --test-tags /school_management --no-http --stop-after-init

school_management: 40 tests, 0 failed, 0 error(s) of 34 tests
```

461 lines of test code across three files, **34 test methods**:

| File | Tests | Covers |
|---|---|---|
| `test_class_schedule.py` | 9 | §7.3 conflict validation — teacher / class / room double-booking, back-to-back allowed, other term allowed, cancelled frees the room, unassigned teacher rejected, weekday-or-date required, inactive teacher cannot publish, reschedule requires a reason |
| `test_security.py` | 12 | §9 and §13 isolation — teacher sees attendance, marks and students only for assigned classes and subjects; announcements for another class or subject invisible; draft and expired invisible; documents raise `AccessError` below Registrar; plain staff sees no other staff |
| `test_responsibility.py` | 13 | §4, §5, §6 — master-record rename propagates; Draft gate; suspended staff take no assignments; deactivation disables the login; one primary responsibility; no self-reporting; one homeroom per class and term; Registrar sees responsibility-targeted announcements; campus targeting |

Verified clean on: fresh install **with** demo data, fresh install **without** demo data, and upgrade of an existing database.

### Cross-role browser verification

Same menu (**Communication → My Announcements**), three users, one screenshot each:

| User | Sees | Does not see |
|---|---|---|
| `demo_teacher_maths` | Opening Assembly, Grade 1 A Parent Visit | Laboratory Closed |
| `demo_teacher_science` | Opening Assembly, Laboratory Closed (Urgent) | Grade 1 A Parent Visit |
| `demo_librarian` | Opening Assembly only | both targeted notices |

This is §13's "a teacher sees only relevant announcements" and "a staff member outside an announcement audience cannot see the restricted announcement", demonstrated rather than asserted.

### Validation error case

Attempted `Physics / Hanna Girma / Monday 08:30–09:30 / Room 101` against an existing 08:00–09:00 booking:

> **Oh snap!** Grade 5 is already booked at this time by "Mathematics - Grade 5 (Monday 08:00)". Change the class/section, the time, or the room.

Backend `@api.constrains`, rejected at create — not a UI-only warning, as §7.3 requires.

---

## 7. Open defects and risks handed forward

**1. `staff_id` NOT NULL fails on upgraded databases — S2, from PR #14.**
Fresh installs get the constraint; upgraded ones silently do not. `staff_id` is therefore enforced only by the ORM on any existing database. Needs a pre-init migration that backfills existing teacher rows before the constraint is applied. Owner: Teacher & Assignment team.

**2. Committed database credentials — S3, pre-existing.**
`config/odoo.conf` is tracked and contains `admin_passwd = admin` and `db_password = odoo`. `.gitignore` covers `.env` but not this file. With the DB manager unprotected, anyone reaching port 8070 can drop or duplicate any database. Fix is to move both into `.env` and ship a `config/odoo.conf.example`. Not done during the sprint because it changes how the stack boots for every intern.

**3. Section, Academic Year, and Term are not their own records.**
§6 asks for relational fields to them. Section is a `Char` on `school.class`, academic year a `Char`, term a two-value `Selection`. Everything keys off the class record so the links stay consistent, but there is no master table for either. This is a schema change touching every workstream and was deliberately not attempted mid-sprint.

**4. Dated and recurring schedule slots do not cross-check.**
A one-off makeup class landing on a recurring weekday is not flagged. Marked in code with the upgrade path.

**5. No approval workflow on attendance or marks.** Direct entry only.

### Breaking change shipped

ACLs no longer grant anything to plain `base.group_user`. **Any existing user without a School Management role will see an empty School app** after upgrading. `base.user_admin` is added to School Administrator automatically; everyone else needs a role in Settings → Users. This will affect every intern's local database the moment they pull `main`.

---

## 8. Deliverables produced

- **Role and permission matrix** — README, 7 roles with the implication ladder
- **Status transition documentation** — schedule, program, announcement
- **Regression checklist** — 24 rows in README covering Registration, Attendance, Mark List, staff, teacher, scheduling, and role isolation
- **Conflict and access-control test evidence** — §6 above
- **Known issues and incomplete work list** — README, matching §7 above
- **Install and upgrade commands** — README, including the `--no-http` caveat and the CLI admin-password gotcha
- **Demo data** — 5 staff, 3 teachers, 4 students, 2 classes, 3 subjects, 5 class periods, 2 programs, 5 announcements, 8 attendance records, 8 marks, 2 campuses, 3 rooms, 6 role logins

---

## 9. Next recommended actions

1. Open an issue for the `staff_id` backfill migration before anyone else upgrades a populated database
2. Notify the team about the `base.group_user` breaking change ahead of Thursday
3. Tell Jennah198 that #9 needs rebasing onto the merged `school.mark`, not just conflict resolution
4. Decide as a team whether Academic Year and Term become master tables — this is the last structural gap against §6
5. Move the committed credentials out of `config/odoo.conf` once the demo is over
