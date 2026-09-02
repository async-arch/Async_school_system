import { notFound } from 'next/navigation'
import {
  Badge,
  Card,
  CardHeader,
  Cell,
  DataTable,
  DateText,
  DetailGrid,
  EmptyState,
  ErrorState,
  LinkButton,
  Note,
  PageHeader,
  RestrictedState,
  Row,
  RowLink,
  StatusBadge,
  TableCard,
} from '@/components/ui'
import { WorkflowPanel } from '@/components/workflow-panel'
import { hasAccess } from '@/lib/odoo/client'
import { toOdooError } from '@/lib/odoo/errors'
import { formatSelection, formatText, trimNumber } from '@/lib/format'
import {
  getActivationBlockers,
  getStaff,
  getStaffLinks,
  getStaffPersonalData,
  getTeacherProfileFor,
  listCampusOptions,
  listDailyStatus,
  listEmployment,
  listManagerOptions,
  listResponsibilities,
  staffFieldMeta,
} from '@/lib/odoo/models/staff'
import { m2oLabel } from '@/lib/odoo/types'
import { availableTransitions } from '@/lib/odoo/workflows'
import { Responsibilities } from './responsibilities'

export const metadata = { title: 'Staff record · Async School' }

const Restricted = () => <span className="text-stone">Restricted to your role</span>

export default async function StaffDetailPage({ params }: PageProps<'/staff/[id]'>) {
  const id = Number((await params).id)
  if (!Number.isFinite(id)) notFound()

  let staff, responsibilities, employment, dailyStatus, personal, links, blockers,
    canWrite, teacherProfile, meta, campuses, managers
  try {
    ;[
      staff, responsibilities, employment, dailyStatus, personal, links, blockers,
      canWrite, teacherProfile, meta, campuses, managers,
    ] = await Promise.all([
      getStaff(id),
      listResponsibilities(id),
      listEmployment(id),
      listDailyStatus(id),
      getStaffPersonalData(id),
      getStaffLinks(id),
      getActivationBlockers(id),
      hasAccess('school.staff', 'write'),
      getTeacherProfileFor(id),
      staffFieldMeta(),
      listCampusOptions(),
      listManagerOptions(id),
    ])
  } catch (cause) {
    return (
      <>
        <PageHeader title="Staff record" />
        <ErrorState {...toOdooError(cause).toClient()} retryHref="/staff" />
      </>
    )
  }

  if (!staff) notFound()

  const teacher = teacherProfile?.rows[0]
  const state = String(staff.state || '')

  return (
    <>
      <PageHeader
        title={staff.name || 'Unnamed staff member'}
        subtitle={`${staff.staff_id || 'No staff number yet'} · ${formatSelection(staff.department)}`}
        breadcrumbs={[{ label: 'Staff', href: '/staff' }, { label: staff.name }]}
        meta={
          <>
            <StatusBadge state={state} />
            {staff.active ? null : <Badge tone="muted">Archived</Badge>}
            {teacher ? <Badge tone="neutral">Teacher</Badge> : null}
          </>
        }
        action={
          <>
            {canWrite ? (
              <LinkButton href={`/staff/${id}/edit`} icon="staff" variant="primary">
                Edit
              </LinkButton>
            ) : null}
            <LinkButton href="/staff" icon="arrowLeft">
              Back to staff
            </LinkButton>
          </>
        }
      />

      <div className="grid items-start gap-4 lg:grid-cols-[1fr_320px]">
        <div className="space-y-4">
          <Card>
            <CardHeader title="Personal" icon="user" />
            <DetailGrid
              fields={[
                { label: 'First name', value: formatText(staff.first_name) },
                { label: 'Last name', value: formatText(staff.last_name) },
                { label: 'Gender', value: formatSelection(staff.gender) },
                {
                  label: 'Date of birth',
                  value: personal ? <DateText value={personal.date_of_birth} /> : <Restricted />,
                },
                {
                  label: 'Age',
                  value: personal ? trimNumber(personal.age) : <Restricted />,
                },
                {
                  label: 'Fayda ID',
                  // Shown only because Odoo returned it — never reconstructed.
                  value: personal ? formatText(personal.fayda_id) : <Restricted />,
                },
              ]}
            />
          </Card>

          <Card>
            <CardHeader title="Contact" icon="announcements" />
            <DetailGrid
              fields={[
                { label: 'Primary phone', value: formatText(staff.phone) },
                { label: 'Mobile', value: formatText(staff.mobile) },
                { label: 'Email', value: formatText(staff.email) },
              ]}
            />
          </Card>

          <Card>
            <CardHeader title="Employment" icon="staff" />
            <DetailGrid
              fields={[
                { label: 'Department', value: formatSelection(staff.department) },
                { label: 'Job title', value: m2oLabel(staff.job_title_id) },
                {
                  label: 'Primary responsibility',
                  value: formatSelection(staff.primary_responsibility),
                },
                { label: 'Employment status', value: formatSelection(staff.employment_status) },
                { label: 'Employment type', value: formatSelection(staff.employment_type) },
                { label: 'Hire date', value: <DateText value={staff.hire_date} /> },
                { label: 'End date', value: <DateText value={staff.end_date} /> },
                { label: 'Campus', value: m2oLabel(staff.campus_id) },
                { label: 'Reporting manager', value: m2oLabel(staff.manager_id) },
                {
                  label: 'Linked employee',
                  value: links ? m2oLabel(links.employee_id) : <Restricted />,
                },
                {
                  label: 'Odoo login',
                  value: links ? m2oLabel(links.user_id) : <Restricted />,
                },
              ]}
            />
          </Card>

          <TableCard
            title="Responsibilities"
            icon="assignments"
            hint="At least one active responsibility is required before the record can leave Draft."
          >
            <Responsibilities
              staffId={id}
              rows={responsibilities.rows.map((row) => ({
                id: row.id,
                responsibility: String(row.responsibility || ''),
                is_primary: row.is_primary,
                department: String(row.department || ''),
                campus: m2oLabel(row.campus_id, ''),
                manager: m2oLabel(row.manager_id, ''),
                start_date: String(row.start_date || ''),
                end_date: String(row.end_date || ''),
                active: row.active,
              }))}
              responsibilities={meta.primary_responsibility?.selection ?? []}
              departments={meta.department?.selection ?? []}
              campuses={campuses}
              managers={managers}
              canWrite={canWrite}
            />
          </TableCard>

          <TableCard
            title="Teaching profile"
            icon="teachers"
            hint="A teacher profile hangs off this staff record; the staff record is what Odoo scopes teaching permissions from."
            action={
              teacher ? (
                <LinkButton href={`/teachers/${teacher.id}`} size="sm" icon="arrowRight">
                  Open teacher
                </LinkButton>
              ) : undefined
            }
          >
            {teacherProfile === null ? (
              <RestrictedState what="Teaching profiles" />
            ) : teacher ? (
              <DataTable
                caption="Teaching profile for this staff member"
                columns={[
                  { key: 'name', label: 'Teacher' },
                  { key: 'teacherId', label: 'Teacher ID' },
                  { key: 'status', label: 'Teaching status' },
                ]}
              >
                <Row>
                  <Cell strong>
                    <RowLink href={`/teachers/${teacher.id}`}>{teacher.name}</RowLink>
                  </Cell>
                  <Cell>
                    <span className="tabular">{formatText(teacher.teacher_id)}</span>
                  </Cell>
                  <Cell>
                    <StatusBadge state={teacher.teaching_status} size="sm" />
                  </Cell>
                </Row>
              </DataTable>
            ) : (
              /*
                Whether this staff member could hold a profile is the same rule
                Odoo enforces in _check_staff_active. Saying which part they
                fail — and offering the action that fixes it — is the whole
                difference between a dead end and a next step.
              */
              <EmptyState
                icon="teachers"
                title="No teaching profile"
                hint={
                  state !== 'active'
                    ? `Odoo accepts a teaching profile only on an active staff member. This record is ${state || 'not active'}.`
                    : staff.employment_status !== 'active'
                      ? `Odoo accepts a teaching profile only while employment is active. This record is ${formatSelection(staff.employment_status)}.`
                      : staff.department !== 'academic' &&
                          !['teacher', 'homeroom', 'department_head', 'coordinator'].includes(
                            String(staff.primary_responsibility),
                          )
                        ? 'Odoo accepts a teaching profile only in the academic department, or with a teaching responsibility. Add one above.'
                        : 'This staff member is eligible — create their teaching profile.'
                }
                action={
                  canWrite &&
                  state === 'active' &&
                  staff.employment_status === 'active' &&
                  (staff.department === 'academic' ||
                    ['teacher', 'homeroom', 'department_head', 'coordinator'].includes(
                      String(staff.primary_responsibility),
                    )) ? (
                    <LinkButton href="/teachers/new" variant="primary" icon="plus" size="sm">
                      Create teaching profile
                    </LinkButton>
                  ) : undefined
                }
              />
            )}
          </TableCard>

          <TableCard
            title="Employment history"
            icon="documents"
            hint="Effective-dated and non-deletable — Odoo refuses to remove these."
          >
            {employment === null ? (
              <RestrictedState what="Employment history" />
            ) : employment.rows.length === 0 ? (
              <EmptyState
                icon="documents"
                title="No employment records"
                hint="Odoo creates these as employment periods are recorded."
              />
            ) : (
              <DataTable
                caption="Employment history"
                columns={[
                  { key: 'title', label: 'Job title' },
                  { key: 'responsibility', label: 'Responsibility', hideBelow: 'sm' },
                  { key: 'manager', label: 'Manager', hideBelow: 'lg' },
                  { key: 'from', label: 'From' },
                  { key: 'to', label: 'To' },
                ]}
              >
                {employment.rows.map((row) => (
                  <Row key={row.id}>
                    <Cell strong>{m2oLabel(row.job_title_id)}</Cell>
                    <Cell hideBelow="sm">{formatSelection(row.responsibility)}</Cell>
                    <Cell hideBelow="lg">{m2oLabel(row.manager_id)}</Cell>
                    <Cell>{<DateText value={row.date_start} />}</Cell>
                    <Cell>{row.date_end ? <DateText value={row.date_end} /> : 'Current'}</Cell>
                  </Row>
                ))}
              </DataTable>
            )}
          </TableCard>

          <TableCard
            title="Recent daily status"
            icon="attendance"
            hint="Generated nightly by Odoo from hr.attendance."
          >
            {dailyStatus === null ? (
              <RestrictedState what="Daily status" />
            ) : dailyStatus.rows.length === 0 ? (
              <EmptyState
                icon="attendance"
                title="No daily status yet"
                hint="The scheduled job records these once the staff member is active."
              />
            ) : (
              <DataTable
                caption="Recent daily status"
                columns={[
                  { key: 'date', label: 'Date' },
                  { key: 'status', label: 'Status' },
                  { key: 'in', label: 'Check in', hideBelow: 'md' },
                  { key: 'out', label: 'Check out', hideBelow: 'md' },
                  { key: 'hours', label: 'Hours', numeric: true },
                ]}
              >
                {dailyStatus.rows.map((row) => (
                  <Row key={row.id}>
                    <Cell strong>{<DateText value={row.date} />}</Cell>
                    <Cell>
                      <StatusBadge state={row.status} size="sm" />
                    </Cell>
                    <Cell hideBelow="md">{<DateText value={row.check_in} withTime />}</Cell>
                    <Cell hideBelow="md">{<DateText value={row.check_out} withTime />}</Cell>
                    <Cell numeric>{trimNumber(row.worked_hours)}</Cell>
                  </Row>
                ))}
              </DataTable>
            )}
          </TableCard>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader title="Status" icon="check" />
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <StatusBadge state={state} />
              {staff.active ? null : <Badge tone="muted">Archived</Badge>}
            </div>
            <WorkflowPanel
              workflow="staff"
              id={staff.id}
              transitions={availableTransitions('staff', state).map(
                ({ key, label, confirm, destructive, requiresReason }) => ({
                  key,
                  label,
                  confirm,
                  destructive,
                  requiresReason,
                }),
              )}
              revalidate={[`/staff/${staff.id}`, '/staff', '/teachers']}
              canWrite={canWrite}
              blockedNote={state === 'draft' ? (blockers ?? undefined) : undefined}
            />
            <Note>
              Activation mints the staff number, creates the linked employee record and reactivates
              any teacher profile. Deactivation archives the Odoo login so access cannot outlive
              employment. Staff records are never deleted from here — Odoo reserves that for an
              administrator.
            </Note>
          </Card>
        </div>
      </div>
    </>
  )
}
