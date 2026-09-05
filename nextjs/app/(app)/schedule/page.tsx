import Link from 'next/link'
import { LinkButton, StatusBadge } from '@/components/ui'
import { ResourceList } from '@/components/resource-list'
import { RowLink } from '@/components/ui/table'
import { formatSelection, formatTimeRange, weekdayName } from '@/lib/format'
import { toOdooOrder } from '@/lib/list-query'
import { classOptions, subjectOptions } from '@/lib/odoo/filter-options'
import { hasAccess } from '@/lib/odoo/client'
import { listSchedule } from '@/lib/odoo/models/operations'
import { selectionOptions } from '@/lib/odoo/selections'
import { m2oLabel } from '@/lib/odoo/types'

export const metadata = { title: 'Timetable · Async School' }

export default async function SchedulePage({ searchParams }: PageProps<'/schedule'>) {
  const [states, days, types, classes, subjects, canBuild] = await Promise.all([
    selectionOptions('school.class.schedule', 'state'),
    selectionOptions('school.class.schedule', 'day_of_week'),
    selectionOptions('school.class.schedule', 'schedule_type'),
    classOptions(),
    subjectOptions(),
    hasAccess('school.class.schedule', 'create'),
  ])

  return (
    <ResourceList
      title="Timetable"
      icon="timetable"
      basePath="/schedule"
      searchParams={searchParams}
      subtitle="Recurring weekly slots. Odoo refuses a double booking of a teacher, class or room."
      filters={[
        { key: 'class', label: 'Class', options: classes },
        { key: 'day', label: 'Day', options: days },
        { key: 'subject', label: 'Subject', options: subjects },
        { key: 'status', label: 'Status', options: states.length ? states : types },
      ]}
      action={
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href="/schedule/grid"
            className="rounded-[9999px] border border-silver px-4 py-2 text-[13px] hover:bg-paper"
          >
            Grid view
          </Link>
          {canBuild ? (
            <>
              {/* The one-off sits beside the bulk path, not instead of it. */}
              <Link
                href="/schedule/new"
                className="rounded-[9999px] border border-silver px-4 py-2 text-[13px] hover:bg-paper"
              >
                Add a period
              </Link>
              <LinkButton href="/schedule/build" variant="primary" icon="plus">
                Build a day
              </LinkButton>
            </>
          ) : null}
        </div>
      }
      load={(query) =>
        listSchedule({
          filters: query.filters,
          order: toOdooOrder(query),
          limit: query.limit,
          offset: query.offset,
        })
      }
      rowHref={(row) => `/schedule/${row.id}`}
      emptyTitle="No timetable slots visible"
      emptyHint="Teachers see only their own slots."
      columns={[
        {
          key: 'day',
          label: 'Day',
          sortField: 'day_of_week',
          render: (row) => <RowLink href={`/schedule/${row.id}`}>{weekdayName(row.day_of_week)}</RowLink>,
        },
        {
          key: 'time',
          label: 'Time',
          sortField: 'start_time',
          render: (row) => (
            <span className="tabular">{formatTimeRange(row.start_time, row.end_time)}</span>
          ),
        },
        { key: 'class', label: 'Class', render: (row) => m2oLabel(row.class_id) },
        { key: 'subject', label: 'Subject', render: (row) => m2oLabel(row.subject_id) },
        {
          key: 'teacher',
          label: 'Teacher',
          hideBelow: 'md',
          render: (row) => m2oLabel(row.teacher_id),
        },
        { key: 'room', label: 'Room', hideBelow: 'lg', render: (row) => m2oLabel(row.room_id) },
        {
          key: 'type',
          label: 'Type',
          hideBelow: 'lg',
          render: (row) => formatSelection(row.schedule_type),
        },
        {
          key: 'state',
          label: 'Status',
          render: (row) => <StatusBadge state={row.state} model="school.class.schedule" />,
        },
      ]}
    />
  )
}
