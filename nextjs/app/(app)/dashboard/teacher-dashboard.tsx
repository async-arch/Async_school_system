import {
  Cell,
  DataTable,
  Row,
  RowLink,
  StatusBadge,
} from '@/components/ui'
import {
  ActionList,
  CountTile,
  DashboardGreeting,
  Panel,
  QuickLinks,
  StateBreakdown,
  TileGrid,
} from '@/components/dashboard/panels'
import { formatDate, formatSelection, formatTimeRange, weekdayName } from '@/lib/format'
import {
  academicContext,
  attendanceTodayByStatus,
  classesForTeacher,
  safeCount,
  todaysLessons,
} from '@/lib/odoo/models/dashboard'
import { listAssignmentsForTeacher } from '@/lib/odoo/models/teacher'
import { listAssessmentsAwaitingEntry } from '@/lib/odoo/models/assessment'
import { listLiveAnnouncements } from '@/lib/odoo/models/operations'
import { m2oId, m2oLabel, type CurrentUser } from '@/lib/odoo/types'

/**
 * What a teacher needs on the way in: today's lessons, the mark lists waiting
 * on them, and whether today's register has been taken.
 *
 * Every panel is scoped by Odoo's record rules rather than by a filter written
 * here — a teacher's assessments, attendance and classes are already narrowed
 * to their own assignments before this code sees them.
 */
export async function TeacherDashboard({ user }: { user: CurrentUser }) {
  const teacherId = m2oId(user.school_teacher_id)
  const classIds = user.school_taught_class_ids ?? []

  const [
    lessons,
    awaitingEntry,
    classes,
    attendanceToday,
    announcements,
    myStudents,
    assignments,
    academic,
  ] = await Promise.all([
    teacherId ? todaysLessons(teacherId) : Promise.resolve(null),
    listAssessmentsAwaitingEntry(5),
    classesForTeacher(classIds),
    attendanceTodayByStatus(),
    listLiveAnnouncements(3),
    classIds.length
      ? safeCount('school.student', [['class_id', 'in', classIds]])
      : Promise.resolve(null),
    // Record rules already narrow assignments to this teacher's own rows; the
    // id says whose page it is, not who may see it.
    teacherId ? listAssignmentsForTeacher(teacherId, 50) : Promise.resolve(null),
    academicContext(),
  ])

  /*
    "My subjects" and "my classes" are derived from the teacher's own active
    assignments rather than counted separately, so the dashboard cannot
    disagree with the assignment records it links to. An assignment that has
    ended stops contributing, which is the point of the state.
  */
  const activeAssignments = assignments?.rows.filter((row) => row.state === 'active') ?? []
  const mySubjects = [...new Map(
    activeAssignments
      .filter((row) => row.subject_id)
      .map((row) => [(row.subject_id as [number, string])[0], (row.subject_id as [number, string])[1]]),
  )]
  const myClasses = [...new Map(
    activeAssignments
      .filter((row) => row.class_id)
      .map((row) => [(row.class_id as [number, string])[0], (row.class_id as [number, string])[1]]),
  )]

  const recordedToday = attendanceToday?.reduce((sum, group) => sum + group.count, 0) ?? null
  const notRecorded =
    attendanceToday?.find((group) => group.value === 'not_recorded')?.count ?? null

  return (
    <>
      <DashboardGreeting
        name={user.name}
        role="Teacher"
        department={
          [
            user.school_department || null,
            academic.year?.name ?? null,
            academic.term?.name ?? null,
          ]
            .filter(Boolean)
            .join(' · ') || undefined
        }
      />

      <QuickLinks
        links={[
          { href: '/attendance', label: 'Take attendance', icon: 'attendance' },
          { href: '/assessments', label: 'Enter marks', icon: 'assessments' },
          { href: '/schedule', label: 'My timetable', icon: 'timetable' },
        ]}
      />

      <TileGrid>
        <CountTile
          label="Lessons today"
          value={lessons ? lessons.rows.length : null}
          icon="timetable"
          href="/schedule"
          hint={weekdayName(new Date().getDay() === 0 ? '6' : String(new Date().getDay() - 1))}
        />
        <CountTile
          label="My classes"
          value={myClasses.length || (classes ? classes.rows.length : null)}
          icon="classes"
          href="/classes"
          hint="From your active assignments"
        />
        <CountTile
          label="My subjects"
          value={mySubjects.length || null}
          icon="subjects"
          href="/assignments"
          hint="From your active assignments"
        />
        <CountTile label="My students" value={myStudents} icon="students" href="/students" />
        <CountTile
          label="Mark lists open"
          value={awaitingEntry ? awaitingEntry.total : null}
          icon="assessments"
          href="/assessments?status=open"
          hint="Open or returned to you"
        />
      </TileGrid>

      <div className="grid items-start gap-4 lg:grid-cols-2">
        <Panel
          title="Today's lessons"
          icon="timetable"
          href="/schedule"
          hrefLabel="Full timetable"
          restricted={teacherId !== null && lessons === null}
          empty={
            !lessons || lessons.rows.length === 0
              ? {
                  title: teacherId ? 'No lessons scheduled today' : 'No teacher profile linked',
                  hint: teacherId
                    ? 'Your published timetable slots for today appear here.'
                    : 'A teaching profile is created when a staff member takes a teaching responsibility.',
                }
              : undefined
          }
        >
          {lessons && lessons.rows.length > 0 ? (
            <DataTable
              caption="Lessons scheduled for today"
              columns={[
                { key: 'time', label: 'Time' },
                { key: 'class', label: 'Class' },
                { key: 'subject', label: 'Subject' },
                { key: 'room', label: 'Room', hideBelow: 'sm' },
                { key: 'state', label: 'Status' },
              ]}
            >
              {lessons.rows.map((slot) => (
                <Row key={slot.id}>
                  <Cell strong>
                    <RowLink href={`/schedule/${slot.id}`}>
                      <span className="tabular">
                        {formatTimeRange(slot.start_time, slot.end_time)}
                      </span>
                    </RowLink>
                  </Cell>
                  <Cell>{m2oLabel(slot.class_id)}</Cell>
                  <Cell>{m2oLabel(slot.subject_id)}</Cell>
                  <Cell hideBelow="sm">{m2oLabel(slot.room_id)}</Cell>
                  <Cell>
                    <StatusBadge state={slot.state} model="school.class.schedule" size="sm" />
                  </Cell>
                </Row>
              ))}
            </DataTable>
          ) : null}
        </Panel>

        <Panel
          title="Waiting on you"
          icon="check"
          hint="Mark lists Odoo has opened or returned to you."
        >
          <ActionList
            items={[
              {
                label: 'Mark lists to complete',
                count: awaitingEntry?.total ?? null,
                href: '/assessments?status=open',
                icon: 'assessments',
              },
              {
                label: "Today's register still not recorded",
                count: notRecorded,
                href: '/attendance',
                icon: 'attendance',
              },
            ]}
          />
        </Panel>

        <Panel
          title="Mark lists open to you"
          icon="assessments"
          href="/assessments"
          restricted={awaitingEntry === null}
          empty={
            awaitingEntry && awaitingEntry.rows.length === 0
              ? {
                  title: 'No mark lists open',
                  hint: 'A mark list appears here once an assessment is opened, or returned to you for correction.',
                }
              : undefined
          }
        >
          {awaitingEntry && awaitingEntry.rows.length > 0 ? (
            <DataTable
              caption="Assessments awaiting mark entry"
              columns={[
                { key: 'name', label: 'Assessment' },
                { key: 'class', label: 'Class' },
                { key: 'date', label: 'Date', hideBelow: 'sm' },
                { key: 'marks', label: 'Marks', numeric: true },
                { key: 'state', label: 'Status' },
              ]}
            >
              {awaitingEntry.rows.map((assessment) => (
                <Row key={assessment.id}>
                  <Cell strong>
                    <RowLink href={`/assessments/${assessment.id}`}>{assessment.name}</RowLink>
                  </Cell>
                  <Cell>{m2oLabel(assessment.class_id)}</Cell>
                  <Cell hideBelow="sm">{formatDate(assessment.date)}</Cell>
                  <Cell numeric>{assessment.mark_count}</Cell>
                  <Cell>
                    <StatusBadge state={assessment.state} size="sm" />
                  </Cell>
                </Row>
              ))}
            </DataTable>
          ) : null}
        </Panel>

        <Panel
          title="Attendance today"
          icon="attendance"
          href="/attendance"
          hint={
            recordedToday
              ? `${recordedToday} recorded across your classes`
              : 'Recorded in the classes you can see'
          }
          restricted={attendanceToday === null}
          empty={
            attendanceToday && attendanceToday.length === 0
              ? {
                  title: 'Nothing recorded today',
                  hint: 'Generate a roster from the attendance screen to take the register.',
                }
              : undefined
          }
        >
          {attendanceToday && attendanceToday.length > 0 ? (
            <StateBreakdown
              groups={attendanceToday}
              hrefFor={(group) => `/attendance?status=${group.value}`}
            />
          ) : null}
        </Panel>

        <Panel
          title="My assignments"
          icon="assignments"
          href="/assignments"
          hint="What you are timetabled to teach, and for which term."
          restricted={teacherId !== null && assignments === null}
          empty={
            !teacherId
              ? {
                  title: 'No teaching profile linked',
                  hint: 'Assignments hang off a teaching profile, which hangs off your staff record.',
                }
              : assignments && assignments.rows.length === 0
                ? {
                    title: 'No assignments yet',
                    hint: 'A registrar assigns you to a subject and class for a given term.',
                  }
                : undefined
          }
        >
          {assignments && assignments.rows.length > 0 ? (
            <DataTable
              caption="Your teaching assignments"
              columns={[
                { key: 'subject', label: 'Subject' },
                { key: 'class', label: 'Class' },
                { key: 'term', label: 'Term', hideBelow: 'sm' },
                { key: 'role', label: 'Role', hideBelow: 'lg' },
                { key: 'periods', label: 'Periods', numeric: true },
                { key: 'state', label: 'Status' },
              ]}
            >
              {assignments.rows.slice(0, 8).map((row) => (
                <Row key={row.id}>
                  <Cell strong>
                    <RowLink href={`/assignments/${row.id}`}>{m2oLabel(row.subject_id)}</RowLink>
                  </Cell>
                  <Cell>{m2oLabel(row.class_id)}</Cell>
                  <Cell hideBelow="sm">{m2oLabel(row.term_id)}</Cell>
                  <Cell hideBelow="lg">{formatSelection(row.responsibility)}</Cell>
                  <Cell numeric>{row.weekly_periods}</Cell>
                  <Cell>
                    <StatusBadge state={row.state} size="sm" />
                  </Cell>
                </Row>
              ))}
            </DataTable>
          ) : null}
        </Panel>

        <Panel
          title="My classes and subjects"
          icon="classes"
          hint="Only what your own active assignments cover."
          empty={
            myClasses.length === 0 && mySubjects.length === 0
              ? {
                  title: 'Nothing assigned yet',
                  hint: 'Your classes and subjects appear here once you hold an active assignment.',
                }
              : undefined
          }
        >
          {myClasses.length || mySubjects.length ? (
            <dl className="space-y-4 p-5 pt-1 text-[13px]">
              <div>
                <dt className="text-[11px] tracking-wide text-stone uppercase">Classes</dt>
                <dd className="mt-1.5 flex flex-wrap gap-1.5">
                  {myClasses.map(([classId, name]) => (
                    <span
                      key={classId}
                      className="rounded-[9999px] bg-paper px-2.5 py-1 text-[12px] text-graphite"
                    >
                      {name}
                    </span>
                  ))}
                </dd>
              </div>
              <div>
                <dt className="text-[11px] tracking-wide text-stone uppercase">Subjects</dt>
                <dd className="mt-1.5 flex flex-wrap gap-1.5">
                  {mySubjects.map(([subjectId, name]) => (
                    <span
                      key={subjectId}
                      className="rounded-[9999px] bg-paper px-2.5 py-1 text-[12px] text-graphite"
                    >
                      {name}
                    </span>
                  ))}
                </dd>
              </div>
            </dl>
          ) : null}
        </Panel>

        {announcements && announcements.rows.length > 0 ? (
          <Panel
            title="Announcements"
            icon="announcements"
            href="/announcements"
            hint="Live now and addressed to you."
            className="lg:col-span-2"
          >
            <ul className="space-y-2 p-5 pt-1">
              {announcements.rows.map((item) => (
                <li key={item.id} className="flex items-baseline justify-between gap-4">
                  <RowLink href={`/announcements/${item.id}`}>{item.name}</RowLink>
                  <span className="shrink-0 text-[11px] text-stone">
                    {formatDate(item.publish_datetime || undefined)}
                  </span>
                </li>
              ))}
            </ul>
          </Panel>
        ) : null}
      </div>
    </>
  )
}
