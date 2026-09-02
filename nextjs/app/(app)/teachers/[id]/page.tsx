import { notFound } from 'next/navigation'
import {
  Badge,
  Card,
  CardHeader,
  Cell,
  DataTable,
  DetailGrid,
  EmptyState,
  ErrorState,
  LinkButton,
  Note,
  PageHeader,
  RestrictedState,
  Row,
  RowLink,
  Stat,
  StatusBadge,
  TableCard,
} from '@/components/ui'
import { toOdooError } from '@/lib/odoo/errors'
import {
  formatDate,
  formatSelection,
  formatText,
  formatTimeRange,
  trimNumber,
  weekdayName,
} from '@/lib/format'
import {
  canWriteTeacher,
  getTeacher,
  listAssignmentsForTeacher,
  listSlotsForTeacher,
} from '@/lib/odoo/models/teacher'
import { m2oId, m2oLabel } from '@/lib/odoo/types'
import { TeacherLogin } from './teacher-login'

export const metadata = { title: 'Teacher · Async School' }

/**
 * A teaching profile and everything that hangs off it.
 *
 * The workload figures are Odoo's `_compute_dashboard_kpis`, displayed rather
 * than recounted — the same numbers the teacher's own dashboard shows, so the
 * two cannot disagree.
 */
export default async function TeacherDetailPage({ params }: PageProps<'/teachers/[id]'>) {
  const id = Number((await params).id)
  if (!Number.isFinite(id)) notFound()

  let teacher, assignments, slots, canWrite
  try {
    ;[teacher, assignments, slots, canWrite] = await Promise.all([
      getTeacher(id),
      listAssignmentsForTeacher(id),
      listSlotsForTeacher(id),
      canWriteTeacher(),
    ])
  } catch (cause) {
    return (
      <>
        <PageHeader title="Teacher" />
        <ErrorState {...toOdooError(cause).toClient()} retryHref="/teachers" />
      </>
    )
  }
  if (!teacher) notFound()

  const staffId = m2oId(teacher.staff_id)
  const active = assignments?.rows.filter((row) => row.state === 'active') ?? []
  const subjects = [...new Set(active.map((row) => m2oLabel(row.subject_id)))].filter((s) => s !== '—')
  const classes = [...new Set(active.map((row) => m2oLabel(row.class_id)))].filter((s) => s !== '—')

  return (
    <>
      <PageHeader
        title={teacher.name}
        subtitle={`${formatText(teacher.teacher_id)} · ${formatSelection(teacher.department)}`}
        breadcrumbs={[{ label: 'Teachers', href: '/teachers' }, { label: teacher.name }]}
        meta={
          <>
            <StatusBadge state={teacher.teaching_status} />
            {teacher.active ? null : <Badge tone="muted">Archived</Badge>}
          </>
        }
        action={
          <>
            {canWrite ? (
              <LinkButton href={`/teachers/${id}/edit`} icon="teachers" variant="primary">
                Edit
              </LinkButton>
            ) : null}
            {staffId ? (
              <LinkButton href={`/staff/${staffId}`} icon="staff">
                Staff record
              </LinkButton>
            ) : null}
            <LinkButton href="/teachers" icon="arrowLeft">
              Back
            </LinkButton>
          </>
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Classes" value={trimNumber(teacher.assigned_class_count)} icon="classes" />
        <Stat label="Subjects" value={trimNumber(teacher.assigned_subject_count)} icon="subjects" />
        <Stat label="Students" value={trimNumber(teacher.total_student_count)} icon="students" />
        <Stat
          label="Periods per week"
          value={trimNumber(teacher.current_weekly_periods)}
          icon="timetable"
          hint={
            teacher.max_weekly_workload
              ? `Maximum ${teacher.max_weekly_workload}`
              : 'No maximum set'
          }
        />
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-[1fr_320px]">
        <div className="space-y-4">
          <Card>
            <CardHeader title="Profile" icon="teachers" />
            <DetailGrid
              fields={[
                {
                  label: 'Staff record',
                  value: staffId ? (
                    <RowLink href={`/staff/${staffId}`}>{m2oLabel(teacher.staff_id)}</RowLink>
                  ) : (
                    '—'
                  ),
                },
                { label: 'Teacher number', value: formatText(teacher.teacher_id) },
                { label: 'Department', value: formatSelection(teacher.department) },
                {
                  label: 'Primary responsibility',
                  value: formatSelection(teacher.primary_responsibility),
                },
                { label: 'Qualification', value: formatText(teacher.qualification) },
                { label: 'Specialisation', value: formatText(teacher.specialization) },
                {
                  label: 'Years of experience',
                  value: teacher.years_of_experience ? trimNumber(teacher.years_of_experience) : '—',
                },
                { label: 'Available days', value: formatText(teacher.available_days) },
                { label: 'Hire date', value: formatDate(teacher.hire_date) },
                { label: 'Odoo login', value: m2oLabel(teacher.user_id) },
              ]}
            />
          </Card>

          <TableCard
            title="Assignments"
            icon="assignments"
            hint="What this teacher teaches, to which class, in which term."
            action={
              <LinkButton href="/assignments" size="sm" icon="arrowRight">
                All assignments
              </LinkButton>
            }
          >
            {assignments === null ? (
              <RestrictedState what="Teaching assignments" />
            ) : assignments.rows.length === 0 ? (
              <EmptyState
                icon="assignments"
                title="No assignments yet"
                hint="An assignment ties this teacher to a subject, a class and a term."
              />
            ) : (
              <DataTable
                caption="Assignments held by this teacher"
                columns={[
                  { key: 'subject', label: 'Subject' },
                  { key: 'class', label: 'Class' },
                  { key: 'term', label: 'Term', hideBelow: 'sm' },
                  { key: 'year', label: 'Year', hideBelow: 'lg' },
                  { key: 'role', label: 'Role', hideBelow: 'md' },
                  { key: 'periods', label: 'Periods', numeric: true },
                  { key: 'state', label: 'Status' },
                ]}
              >
                {assignments.rows.map((row) => (
                  <Row key={row.id}>
                    <Cell strong>{m2oLabel(row.subject_id)}</Cell>
                    <Cell>{m2oLabel(row.class_id)}</Cell>
                    <Cell hideBelow="sm">{m2oLabel(row.term_id)}</Cell>
                    <Cell hideBelow="lg">{m2oLabel(row.academic_year_id)}</Cell>
                    <Cell hideBelow="md">{formatSelection(row.responsibility)}</Cell>
                    <Cell numeric>{row.weekly_periods}</Cell>
                    <Cell>
                      <StatusBadge state={row.state} size="sm" />
                    </Cell>
                  </Row>
                ))}
              </DataTable>
            )}
          </TableCard>

          <TableCard
            title="Timetable"
            icon="timetable"
            hint="Published slots for this teacher, across every term."
          >
            {slots === null ? (
              <RestrictedState what="The timetable" />
            ) : slots.rows.length === 0 ? (
              <EmptyState
                icon="timetable"
                title="No timetable slots"
                hint="Slots are created against a class, subject and teacher for a term."
              />
            ) : (
              <DataTable
                caption="Timetable slots for this teacher"
                columns={[
                  { key: 'day', label: 'Day' },
                  { key: 'time', label: 'Time' },
                  { key: 'class', label: 'Class' },
                  { key: 'subject', label: 'Subject', hideBelow: 'sm' },
                  { key: 'room', label: 'Room', hideBelow: 'lg' },
                  { key: 'state', label: 'Status' },
                ]}
              >
                {slots.rows.map((slot) => (
                  <Row key={slot.id}>
                    <Cell strong>
                      <RowLink href={`/schedule/${slot.id}`}>{weekdayName(slot.day_of_week)}</RowLink>
                    </Cell>
                    <Cell>
                      <span className="tabular">
                        {formatTimeRange(slot.start_time, slot.end_time)}
                      </span>
                    </Cell>
                    <Cell>{m2oLabel(slot.class_id)}</Cell>
                    <Cell hideBelow="sm">{m2oLabel(slot.subject_id)}</Cell>
                    <Cell hideBelow="lg">{m2oLabel(slot.room_id)}</Cell>
                    <Cell>
                      <StatusBadge state={slot.state} model="school.class.schedule" size="sm" />
                    </Cell>
                  </Row>
                ))}
              </DataTable>
            )}
          </TableCard>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader title="Teaching now" icon="check" />
            {active.length === 0 ? (
              <p className="text-[12px] text-slate">No active assignments this term.</p>
            ) : (
              <dl className="space-y-3 text-[13px]">
                <div>
                  <dt className="text-[11px] tracking-wide text-stone uppercase">Subjects</dt>
                  <dd className="mt-1 text-graphite">{subjects.join(', ') || '—'}</dd>
                </div>
                <div>
                  <dt className="text-[11px] tracking-wide text-stone uppercase">Classes</dt>
                  <dd className="mt-1 text-graphite">{classes.join(', ') || '—'}</dd>
                </div>
              </dl>
            )}
          </Card>

          <Card>
            <CardHeader title="Login" icon="user" />
            <TeacherLogin
              teacherId={id}
              userLabel={m2oLabel(teacher.user_id, '')}
              canWrite={canWrite}
            />
            <Note>
              Odoo creates the login against the email on the staff record, puts it in the teacher
              group and emails a password reset. No password passes through this application.
            </Note>
          </Card>
        </div>
      </div>
    </>
  )
}
