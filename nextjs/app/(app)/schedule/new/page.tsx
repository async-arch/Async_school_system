import { Breadcrumbs, ErrorState, Note, PageHeader, RestrictedState } from '@/components/ui'
import { toOdooError } from '@/lib/odoo/errors'
import {
  canCreateSchedule,
  listAssignmentOptions,
  type AssignmentOption,
} from '@/lib/odoo/models/operations'
import { listRooms } from '@/lib/odoo/models/timetable'
import { selectionOptions } from '@/lib/odoo/selections'
import { SlotForm } from '../slot-form'

export const metadata = { title: 'New period · Async School' }

/**
 * One timetable period, on its own.
 *
 * The day builder is how a timetable normally gets built — a whole day at
 * once, times chained by Odoo. This is for the single lesson the builder
 * cannot express: a makeup class, an exam sitting, a period added after the
 * fact. Both end up as the same `school.class.schedule` row.
 */
export default async function NewSlotPage() {
  let assignments: AssignmentOption[]
  let rooms: Array<{ id: number; name: string }>
  let types: Array<{ value: string; label: string }>
  let canCreate: boolean

  try {
    const [assignmentList, roomPage, typeList, allowed] = await Promise.all([
      listAssignmentOptions(),
      listRooms(),
      selectionOptions('school.class.schedule', 'schedule_type'),
      canCreateSchedule(),
    ])
    assignments = assignmentList
    rooms = (roomPage?.rows ?? []).map((room) => ({ id: room.id, name: room.name }))
    types = typeList
    canCreate = allowed
  } catch (cause) {
    return (
      <>
        <PageHeader title="New period" />
        <ErrorState {...toOdooError(cause).toClient()} retryHref="/schedule" />
      </>
    )
  }

  if (!canCreate) {
    return (
      <>
        <PageHeader title="New period" />
        <RestrictedState what="Creating a timetable period" />
      </>
    )
  }

  return (
    <>
      <Breadcrumbs
        trail={[{ label: 'Timetable', href: '/schedule' }, { label: 'New period' }]}
      />
      <PageHeader
        title="New period"
        subtitle="A one-off lesson. For a whole day of periods, use the day builder instead."
      />

      {assignments.length === 0 ? (
        <Note>
          There is no active teaching assignment to build a period on. A slot must name the exact
          assignment that covers its class, subject and term, so create that first.
        </Note>
      ) : (
        <SlotForm
          mode="create"
          assignments={assignments.map((a) => ({ id: a.id, label: a.label }))}
          rooms={rooms}
          types={types}
          defaults={{
            assignmentId: '',
            dayOfWeek: '0',
            startTime: '08:00',
            endTime: '08:45',
            roomId: '',
            scheduleType: 'regular',
            notes: '',
          }}
        />
      )}
    </>
  )
}
