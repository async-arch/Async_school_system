import { notFound } from 'next/navigation'
import { formatClock, formatSelection, formatText } from '@/lib/format'
import { ErrorState, LinkButton, PageHeader } from '@/components/ui'
import { WorkflowDetail } from '@/components/workflow-detail'
import { toOdooError } from '@/lib/odoo/errors'
import { canWriteSchedule, getScheduleDetail, WEEKDAYS } from '@/lib/odoo/models/operations'
import { m2oLabel } from '@/lib/odoo/types'

export const metadata = { title: 'Timetable slot · Async School' }

export default async function ScheduleDetailPage({ params }: PageProps<'/schedule/[id]'>) {
  const id = Number((await params).id)
  if (!Number.isFinite(id)) notFound()

  let slot, canWrite
  try {
    ;[slot, canWrite] = await Promise.all([getScheduleDetail(id), canWriteSchedule()])
  } catch (cause) {
    return (
      <>
        <PageHeader title="Timetable slot" />
        <ErrorState {...toOdooError(cause).toClient()} />
      </>
    )
  }
  if (!slot) notFound()

  const state = String(slot.state || '')

  return (
    <WorkflowDetail
      title={`${m2oLabel(slot.subject_id)} · ${m2oLabel(slot.class_id)}`}
      subtitle={`${WEEKDAYS[Number(slot.day_of_week)] ?? ''} ${formatClock(slot.start_time)}–${formatClock(slot.end_time)}`}
      backHref="/schedule"
      backLabel="Back to timetable"
      workflow="schedule"
      id={slot.id}
      state={state}
      canWrite={canWrite}
      revalidate={[`/schedule/${slot.id}`, '/schedule', '/schedule/grid']}
      note="Cancelling releases the teacher, class and room for that slot. Odoo blocks any double booking."
      actions={
        canWrite ? (
          <LinkButton href={`/schedule/${slot.id}/edit`} icon="timetable">
            Edit
          </LinkButton>
        ) : undefined
      }
      fields={[
        { label: 'Class', value: m2oLabel(slot.class_id) },
        { label: 'Subject', value: m2oLabel(slot.subject_id) },
        { label: 'Teacher', value: m2oLabel(slot.teacher_id) },
        { label: 'Term', value: m2oLabel(slot.term_id) },
        { label: 'Academic year', value: m2oLabel(slot.academic_year_id) },
        { label: 'Room', value: m2oLabel(slot.room_id) },
        { label: 'Day', value: WEEKDAYS[Number(slot.day_of_week)] ?? '—' },
        { label: 'Starts', value: formatClock(slot.start_time) },
        { label: 'Ends', value: formatClock(slot.end_time) },
        { label: 'Type', value: formatSelection(slot.schedule_type) },
        /*
          The assignment is the record every other field on this slot has to
          agree with, so it is worth showing rather than leaving implicit.
        */
        { label: 'Teacher assignment', value: m2oLabel(slot.teacher_assignment_id) },
        { label: 'Notes', value: formatText(slot.notes) },
        // Only meaningful once a lesson has actually moved.
        ...(slot.reschedule_reason
          ? [{ label: 'Reschedule reason', value: formatText(slot.reschedule_reason) }]
          : []),
      ]}
    />
  )
}
