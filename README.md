# Async School Management System

<!-- markdownlint-disable MD013 -->

An Odoo 19 Community add-on covering the full school lifecycle: admissions,
effective-dated enrollment and curriculum, staff/HR integration, assignments,
scheduling, attendance, assessments, documents, reporting, and audit controls.

## What you need

You do **not** need to install Odoo, PostgreSQL, or Python on your computer.
Docker downloads and runs Odoo 19 Community and PostgreSQL 16 for this project.

Install these tools first:

- [Git](https://git-scm.com/downloads)
- [Docker Desktop](https://www.docker.com/products/docker-desktop/) on Windows
  or macOS, or Docker Engine with the Compose plugin on Linux
- Bash (already available on Linux and macOS; use WSL 2 on Windows)

Make sure Docker is running and that port `8070` is free. Verify the tools with:

```bash
git --version
docker --version
docker compose version
docker info
```

This repository uses the `docker compose` command provided by Compose v2, not
the older `docker-compose` command.

## Quick start

```bash
git clone https://github.com/async-arch/Async_school_system.git
cd Async_school_system
cp .env.example .env
cp config/odoo.conf.example config/odoo.conf
```

Open `config/odoo.conf` and replace `CHANGE_ME` in this line with a private
value:

```ini
admin_passwd = CHANGE_ME
```

This is Odoo's database-management master password, not the password used to
log in to the application. Do not commit it.

Now build the development database and start the services:

```bash
./scripts/reset-db.sh
```

The first run can take several minutes because Docker must download the images.
When the script finishes, open <http://localhost:8070> and log in with:

- Email: `admin`
- Password: `admin`

These are development credentials. Do not expose this stack to the public
internet.

Check that both services are running:

```bash
docker compose ps
```

If Odoo is still starting, follow its logs with `docker compose logs -f odoo`.
Press `Ctrl+C` to stop following the logs; the containers will continue running.

### What the setup script does

`reset-db.sh` drops and rebuilds the database named by `ODOO_DB` in `.env`,
installs the `school_management` module, and loads demo data unless
`ODOO_LOAD_DEMO=0`. Everyone who runs it gets the same starting database. The
web database manager is disabled (`list_db = False`) so developers do not
accidentally create different databases with different options.

Both `.env` and `config/odoo.conf` are gitignored. Never commit them.

Port 8070 on the host maps to Odoo's 8069 in the container (see
`docker-compose.yml`).

For migration rehearsals or side-by-side validation, use the isolated
`docker-compose.odoo19.yml` project described in
[`docs/MIGRATION_RUNBOOK.md`](docs/MIGRATION_RUNBOOK.md). It has separate
service and volume names and must not be pointed at the Odoo 17 volumes.

### Load the complete Odoo 19 SRS sample workflow

After the Odoo 19 module is installed or upgraded, populate the existing
`school` database with a connected demonstration dataset:

```bash
./scripts/seed-odoo19-srs.sh school
```

The command is additive and idempotent: it never resets the database, preserves
records entered through the UI, and can be run again safely. It reuses the
existing `2026/2027` year and terms when present; the fictional business records
start with `SRS Demo` and cover academic setup, staff and teachers, students and
guardians, curriculum, assignments, attendance, published assessments and
marks, report cards, documents, rooms, schedules, a program, and an
announcement. It also installs a complete grading scheme and selects it for
report-card calculation without changing the other school settings.

The default PostgreSQL values in `.env.example` match
`config/odoo.conf.example`. If you change `POSTGRES_USER` or
`POSTGRES_PASSWORD` in `.env`, make the same change to `db_user` or
`db_password` in `config/odoo.conf` before starting the stack.

To install without fictional demo records, set this value in `.env` before
running the reset script:

```dotenv
ODOO_LOAD_DEMO=0
```

> **Warning:** `./scripts/reset-db.sh` deletes and recreates the database named
> by `ODOO_DB`. Do not use it for a database containing work you need to keep.

## Everyday Docker commands

```bash
# Start the existing environment
docker compose up -d

# Show service status
docker compose ps

# Follow Odoo logs
docker compose logs -f odoo

# Stop the environment while keeping its database and files
docker compose down
```

Docker stores PostgreSQL data and Odoo files in named volumes, so
`docker compose down` does not delete them. Avoid `docker compose down -v`
unless you intentionally want to delete all local project data.

## Keeping your checkout in sync

Anything the whole team must see lives in `data/` (real) or `demo/` (fictional) XML.
Records you create through the UI exist only in your database and for nobody else.

```bash
git pull

# Export values such as ODOO_DB from the local environment file.
set -a
source .env
set +a

docker compose exec odoo odoo -c /etc/odoo/odoo.conf -d "$ODOO_DB" \
  -u school_management --no-http --stop-after-init
docker compose restart odoo
```

Then hard-refresh the browser (`Ctrl+Shift+R`) — Odoo caches menus in a compiled asset
bundle, so a stale bundle is the usual reason a teammate's new menu does not appear.
If anything still looks wrong, `./scripts/reset-db.sh` returns you to a known state.

Note that the seed files under `data/` are `noupdate="1"`, so `-u` will **not** revise
rows that already exist in your database. Seed changes need a full rebuild.

## Install, upgrade, and test from the command line

Run the following once in each new terminal before using commands that reference
`$ODOO_DB`:

```bash
set -a
source .env
set +a
```

```bash
# fresh install with fictional demo data
docker compose exec odoo odoo -c /etc/odoo/odoo.conf -d "$ODOO_DB" \
  -i school_management \
  --no-http --stop-after-init

# fresh install without demo data
docker compose exec odoo odoo -c /etc/odoo/odoo.conf -d "$ODOO_DB" \
  --without-demo=all -i school_management --no-http --stop-after-init

# upgrade an existing database after pulling changes
docker compose exec odoo odoo -c /etc/odoo/odoo.conf -d "$ODOO_DB" \
  -u school_management --no-http --stop-after-init

# run the module's tests
docker compose exec odoo odoo -c /etc/odoo/odoo.conf -d "$ODOO_DB" \
  -u school_management --test-enable --test-tags /school_management \
  --no-http --stop-after-init
```

`--no-http` matters when the stack is already running: without it the CLI process
tries to bind port 8069 and logs a traceback before continuing.

Restart the server container after changing Python files so the registry reloads:
`docker compose restart odoo`.

## Troubleshooting

### Docker cannot connect

Start Docker Desktop or the Docker service, then confirm that `docker info` succeeds.
On Linux, follow Docker's post-install instructions if your user cannot access the
Docker daemon. On Windows, run the project inside a WSL 2 terminal with Docker Desktop
WSL integration enabled.

### Port 8070 is already in use

Stop the process using port `8070`, or change the host side of the port mapping in
`docker-compose.yml`, for example from `8070:8069` to `8071:8069`. Then open
<http://localhost:8071>.

### Odoo does not become ready

Inspect the current state and logs:

```bash
docker compose ps
docker compose logs --tail=200 db odoo
```

The database health check may take some time on a slow first start. A database
authentication error usually means the credentials in `.env` and `config/odoo.conf`
do not match.

### Start over with a clean development database

Use the repository script so the module and demo-data options remain deterministic:

```bash
./scripts/reset-db.sh
```

This deletes only the database named by `ODOO_DB`; it does not delete the
repository.

## Demo logins

Installed only when the database is created **with** demo data. Password is `demo`
for all of them.

| Login | Group | Scope |
| --- | --- | --- |
| `demo_registrar` | Registrar / Academic Officer | All student and staff master data |
| `demo_director` | Director / Principal | Read-only across all academic data, plus Analysis |
| `demo_teacher_maths` | Teacher | Mathematics, Grade 1 A and Grade 2 A, homeroom of Grade 1 A |
| `demo_teacher_science` | Teacher | General Science, Grade 2 A, department-head responsibility |
| `demo_teacher_amharic` | Teacher | Amharic, Grade 1 A, East Campus |
| `demo_librarian` | Front Office / Communication | Librarian responsibility, East Campus, no teaching assignments |

Department Head is a **responsibility** on the staff and assignment records, not a
security group — `demo_teacher_science` sits in the same Teacher group as the others
and is targetable by responsibility-addressed announcements.

`demo_teacher_maths` and `demo_teacher_science` are the pair to use when showing
role isolation: each sees only their own classes, marks, and announcements.

## Roles and permission matrix

Six **flat peer groups**, defined in `security/school_security.xml`. There is no
implication ladder between them — only School Administrator carries `implied_ids`,
which pull in the other five.

```text
School Administrator ──implies──> Director · Registrar · Teacher · Finance · Front Office
```

| Group | Access |
| --- | --- |
| School Administrator | Everything, plus rooms and campuses |
| Registrar / Academic Officer | Full create/edit/delete on students, staff, teachers, academic years, terms, sections, classes, subjects, assignments, schedules, attendance, marks, programs, announcements, job titles, staff responsibilities. Includes **private documents**. Read-only on rooms and campuses. |
| Director / Principal | **Read-only** on every academic model, unscoped, plus the Analysis dashboards. No create, write, or delete anywhere. |
| Teacher | Read classes, subjects, programs, schedules, assignments. Students, attendance, and marks scoped to **assigned classes** (marks also by subject). Attendance and marks are create/write but **not delete**. Own teacher profile is writable; own schedule slots and assignments only. |
| Front Office / Communication | Announcements read/create/write, scoped to ones they authored or that target them. All students for contact lookup. **Own staff record only.** |
| Finance Officer | Read-only on class schedules, academic years, terms, and sections — enough for its Schedule Coverage menu. No financial models exist yet, so the role is a placeholder. |

Attendance and marks are create/write for Teacher with delete withheld, so a teacher
cannot remove history. Delete is held by Registrar and School Administrator; Director
cannot delete either.

Announcement visibility is enforced by record rule, not just by the menu: teachers see
only live announcements whose audience matches them, and Registrar and Front Office see
what they authored plus what targets them. Director and Administrator see all.

### Private documents

Staff and teacher document binaries carry a field-level group of
`group_school_registrar`. Anyone without that group cannot read them through the form
view *or* the ORM — `read(['id_document'])` raises `AccessError`. The Documents tab
does not render at all for other roles.

## Status transitions

**Class schedule** — `Draft → Published → Completed`, with `Cancelled` and
`Rescheduled`. A cancelled slot releases its teacher, class, and room; every other
status still holds them. Moving to `Rescheduled` requires a reason, and the previous
day, date, and times stay in the chatter through field tracking.

**Program** — `Draft → Published → Completed`, with `Cancelled`. Cancelled programs
stay visible with their status rather than disappearing.

**Announcement** — `Draft → Published → Archived`. Only records that are published,
past their publish time, and not past their expiry are visible to their audience.

## Conflict and access-control tests

```bash
set -a
source .env
set +a
docker compose exec odoo odoo -c /etc/odoo/odoo.conf -d "$ODOO_DB" \
  -u school_management --test-enable --test-tags /school_management \
  --no-http --stop-after-init
```

The command succeeds with `0 failed` and `0 error(s)`. CI performs a fresh module
install with demo data and runs the same tagged test suite on pushes and pull requests
to `main`, so broken demo XML, model code, or record rules fail the build.

`addons/school_management/tests/test_class_schedule.py` — teacher, class, and room
double-booking blocked; back-to-back slots allowed; same weekday in another term
allowed; a cancelled slot frees the room; a teacher with no assignment rejected;
weekday-or-date required; inactive teacher cannot be published; rescheduling
requires a reason; program audience requires values.

`addons/school_management/tests/test_responsibility.py` — renaming a staff record
renames the teacher and reaches the assignment label; staff cannot leave Draft without
a phone or an active responsibility; suspended staff take no new assignments;
deactivating staff disables the linked login; one primary responsibility per staff;
no self-reporting; one homeroom teacher per class and term; a Registrar sees
responsibility-targeted announcements; campus targeting respects the staff campus.

`addons/school_management/tests/test_security.py` — a teacher sees attendance,
marks, and students only for assigned classes and subjects; announcements targeted
at another class or another subject are invisible; draft and expired announcements
are invisible; staff documents raise `AccessError` below Registrar; a plain staff
user sees no other staff records; a teacher sees their own draft schedule but not
another teacher's.

## Regression checklist

Run before merging anything into `main`. Each row is a previously accepted workflow.

| # | Workflow | Steps | Expected |
| --- | --- | --- | --- |
| 1 | Student registration is the master source | Students → New → fill name, DOB, guardian, phone, class, birth certificate → set Approved | Saves; `regno` is generated; missing documents block Approved with a named list |
| 2 | Guardian phone validation | Save a student with `0911` and no nationality | Blocked with the phone-format message |
| 3 | Entry-level exemption | Approve a student in a class flagged Entry Level with no previous-grade document | Allowed |
| 4 | Attendance loads approved students | Academic → Attendance → New → pick a student | Class auto-fills from the student; one row per student per date enforced |
| 5 | Mark list loads approved students | Academic → Mark List → New | Only Approved students selectable; percentage and grade compute; duplicate student/subject/term/assessment blocked |
| 6 | Mark needs a teaching assignment | Enter a mark for a subject nobody is assigned to teach in that class | Blocked with a named message |
| 7 | Unique student ID | Attempt two students with the same `regno` | Blocked |
| 8 | Staff registration | Administration → Staff → New with department and job title | `staff_id` generated; job title limited to the chosen department |
| 9 | Staff document privacy | Open a staff record as `demo_teacher_maths` | Documents tab absent |
| 10 | Teacher links to staff | Academic → Teachers → New | Staff Record required; one teacher profile per staff member |
| 11 | Teacher workload | Add assignments beyond the teacher's maximum weekly periods | Blocked with the workload message |
| 12 | Job titles reachable when archived | Administration → Job Titles → filter Archived | Archived titles listed |
| 13 | Class schedule conflicts | Book two overlapping slots on one teacher, class, or room | Blocked with a message naming the clashing slot |
| 14 | Schedule needs an assignment | Schedule a teacher for a subject they are not assigned | Blocked |
| 15 | Role isolation | Log in as `demo_teacher_maths`, then `demo_teacher_science` | Each sees only their own classes, marks, attendance, and announcements |
| 16 | Announcement audience | Open My Announcements as each demo teacher | Grade 1 A notice only for the maths teacher; laboratory notice only for the science teacher; assembly notice for both |
| 17 | Owner data isolation | Log in as `demo_librarian` | No students, no marks, no other staff records |
| 18 | Responsibility targeting | Open My Announcements as `demo_registrar` | Sees the Registrar notice; teachers do not |
| 19 | Campus targeting | Open My Announcements as `demo_librarian` (East) vs `demo_teacher_maths` (Main) | East Campus water notice only for East staff |
| 20 | Staff control status | Suspend a staff member, then add a teaching assignment | Blocked with the suspended-staff message |
| 21 | Master-record rename | Rename a staff record | Teacher name, assignments, and schedules follow |
| 22 | Draft gate | Activate a staff record with no responsibility | Blocked, listing what is missing |
| 23 | One homeroom per class | Assign a second homeroom teacher to the same class and term | Blocked |
| 24 | Admin overview | School → Overview as admin | Real counts; each tile opens its records |

## Known issues and incomplete work

Stated honestly — these are **not** finished.

- **Finance Officer reads, but there is nothing financial to read.** The group now has
  read access to the models behind its one menu, so it no longer raises `AccessError`.
  What it does not have is a domain: there are no fee, invoice, or payment models, so
  Schedule Coverage is all it can show. The role is a placeholder until those exist.

- **Terms are not scoped to an academic year.** `school.term` is a flat list, so
  `Term 1` is one shared record rather than one per year, and a term carries no
  dates of its own. Nothing stops a 2026/2027 class being scheduled against a term
  that conceptually belongs to another year, because the term does not belong to
  one. Scoping terms per year is the next step if the school needs term dates.

- **`staff_id` is not NOT NULL on upgraded databases.** Making it required on a table
  that already held teacher rows fails the migration; Odoo logs
  `unable to set NOT NULL on column 'staff_id'` and leaves the column nullable. Fresh
  installs get the constraint. Needs a pre-init migration that backfills existing rows.
- **Dated and recurring schedule slots do not cross-check.** A one-off makeup class on
  a date that lands on a recurring weekday is not flagged as a conflict. Recurring
  slots only collide with recurring slots in the same term.
- **The class-schedule calendar shows dated sessions only.** Recurring slots have no
  date. Positioning hours on a calendar needs timezone-aware datetimes that render
  wrong for users in other zones, so Weekly Timetable covers the recurring case as a
  list grouped by day.
- **Reporting is native graph and pivot views**, not per-role dashboard pages. They
  read real records and are scoped by the same record rules, so a teacher and a
  director see different totals from the same menu.
- **No attendance or mark approval workflow.** Both are direct entry with no
  submit-and-review step.

## Structure

```text
addons/school_management/
├── models/          # one file per domain concept, incl. academic year, term, section
├── views/           # one file per model, plus menus and dashboards
├── security/        # role groups, record rules, and ACLs
├── data/            # sequences, seed job titles, academic years, terms, sections
├── demo/            # fictional demonstration data
├── migrations/      # one folder per version that moved existing data
├── report/          # student report
└── tests/           # conflict and access-control tests
```

`migrations/` holds a script per version bump that had to move data already in a
database. They matter because Postgres stores a `Char` and a `Selection` alike, so a
field-type change succeeds silently and leaves invalid values behind. Each script also
applies the `NOT NULL` that Odoo skips on a table that already holds rows, so an
upgraded database ends up identical to a fresh one rather than quietly weaker.
