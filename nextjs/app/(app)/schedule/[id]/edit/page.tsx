import { notFound } from 'next/navigation'
import { Breadcrumbs, ErrorState, Note, PageHeader, RestrictedState } from '@/components/ui'
import { formatClock } from '@/lib/format'
import { toOdooError } from '@/lib/odoo/errors'
import {
  canWriteSchedule,
  getScheduleDetail,
  listAssignmentOptions,
  type ScheduleDetail,
} from '@/lib/odoo/models/operations'
import { listRooms } from '@/lib/odoo/models/timetable'
import { selectionOptions } from '@/lib/odoo/selections'
import { m2oId, m2oLabel } from '@/lib/odoo/types'
import { SlotForm } from '../../slot-form'

export const metadata = { title: 'Edit period · Async School' }

/**
 * The scheduling facts of one slot: its day, its times, its room, its type.
 *
 * Not its assignment. `_check_teacher_assignment` requires the slot's class,
 * subject, term, year and teacher to match one exact active assignment, so
 * changing which lesson this is would mean rewriting five interlocking fields
 * at once. Cancelling and creating says the same thing and leaves a better
 * trail, which is what the form tells the user.
 */
export default async function EditSlotPage({ params }: PageProps<'/schedule/[id]/edit'>) {
  const id = Number((await params).id)
  if (!Number.isFinite(id)) notFound()

  let slot: ScheduleDetail | null
  let rooms: Array<{ id: number; name: string }>
  let types: Array<{ value: string; label: string }>
  let canWrite: boolean
  let assignmentLabel: string

  try {
    const [detail, roomPage, typeList, allowed] = await Promise.all([
      getScheduleDetail(id),
      listRooms(),
      selectionOptions('school.class.schedule', 'schedule_type'),
      canWriteSchedule(),
    ])
    slot = detail
    rooms = (roomPage?.rows ?? []).map((room) => ({ id: room.id, name: room.name }))
    types = typeList
    canWrite = allowed
    assignmentLabel = m2oLabel(detail?.teacher_assignment_id ?? false)

    // The stored label is terse; the one on the picker reads better.
    if (detail) {
      const match = (await listAssignmentOptions()).find(
        (option) => option.id === m2oId(detail.teacher_assignment_id),
      )
      if (match) assignmentLabel = match.label
    }
  } catch (cause) {
    return (
      <>
        <PageHeader title="Edit period" />
        <ErrorState {...toOdooError(cause).toClient()} retryHref="/schedule" />
      </>
    )
  }

  if (!slot) notFound()

  if (!canWrite) {
    return (
      <>
        <PageHeader title="Edit period" />
        <RestrictedState what="Changing a timetable period" />
      </>
    )
  }

  const state = String(slot.state || '')
  const live = state === 'published' || state === 'completed'

  return (
    <>
      <Breadcrumbs
        trail={[
          { label: 'Timetable', href: '/schedule' },
          { label: 'Period', href: `/schedule/${slot.id}` },
          { label: 'Edit' },
        ]}
      />
      <PageHeader
        title={`${m2oLabel(slot.subject_id)} · ${m2oLabel(slot.class_id)}`}
        subtitle="Odoo refuses a change that would double-book the teacher, the class or the room."
      />

      <SlotForm
        mode="edit"
        id={slot.id}
        live={live}
        assignments={[]}
        rooms={rooms}
        types={types}
        defaults={{
          assignmentId: String(m2oId(slot.teacher_assignment_id) ?? ''),
          assignmentLabel,
          dayOfWeek: String(slot.day_of_week || '0'),
          startTime: formatClock(slot.start_time),
          endTime: formatClock(slot.end_time),
          roomId: String(m2oId(slot.room_id) ?? ''),
          scheduleType: String(slot.schedule_type || 'regular'),
          notes: slot.notes || '',
        }}
      />

      {state === 'cancelled' ? (
        <Note>
          This slot is cancelled, so it currently holds no teacher, class or room. Returning it to
          draft from the period page makes it occupy them again, and Odoo will refuse that if
          something else has taken the time in the meantime.
        </Note>
      ) : null}
    </>
  )
}
