'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

import { requireSession } from '@/lib/odoo/auth'
import { toOdooError } from '@/lib/odoo/errors'
import { clockToFloat } from '@/lib/format'
import {
  createSlot,
  getScheduleDetail,
  listAssignmentOptions,
  updateSlot,
} from '@/lib/odoo/models/operations'

/**
 * Creating and editing one timetable slot.
 *
 * Odoo owns every rule these forms touch and states them well — "Room 3 is
 * already booked at this time by …", "End time must be after the start time",
 * "The schedule must use one exact active teacher assignment", "Give a
 * reschedule reason". Those messages are passed through rather than restated.
 * The checks below only save a round trip.
 *
 * The assignment is resolved server-side from the id the form posted, and the
 * class, subject, term and teacher are taken from that record rather than from
 * the browser. A hand-posted class id therefore cannot reach Odoo at all.
 */

export interface SlotFormState {
  error?: string
  fieldErrors?: Record<string, string>
  values?: Record<string, string>
}

const FORM_FIELDS = [
  'assignmentId',
  'dayOfWeek',
  'startTime',
  'endTime',
  'roomId',
  'scheduleType',
  'notes',
  'rescheduleReason',
] as const

/** The types the model accepts. Odoo re-checks the selection regardless. */
const SCHEDULE_TYPES = new Set([
  'regular',
  'tutorial',
  'laboratory',
  'examination',
  'makeup',
  'other',
])

const DAYS = new Set(['0', '1', '2', '3', '4', '5', '6'])

function text(form: FormData, key: string): string {
  return String(form.get(key) ?? '').trim()
}

function submitted(form: FormData): Record<string, string> {
  return Object.fromEntries(FORM_FIELDS.map((field) => [field, String(form.get(field) ?? '')]))
}

interface Timing {
  dayOfWeek: string
  startTime: number
  endTime: number
  roomId?: number
  scheduleType: string
  notes: string
}

function collectTiming(form: FormData): {
  timing?: Timing
  fieldErrors?: Record<string, string>
} {
  const fieldErrors: Record<string, string> = {}

  const dayOfWeek = text(form, 'dayOfWeek')
  if (!DAYS.has(dayOfWeek)) fieldErrors.dayOfWeek = 'Choose a day of the week.'

  const startTime = clockToFloat(text(form, 'startTime'))
  const endTime = clockToFloat(text(form, 'endTime'))
  if (startTime === null || !text(form, 'startTime')) {
    fieldErrors.startTime = 'Give the period a start time.'
  }
  if (endTime === null || !text(form, 'endTime')) {
    fieldErrors.endTime = 'Give the period an end time.'
  }
  if (
    startTime !== null &&
    endTime !== null &&
    text(form, 'startTime') &&
    text(form, 'endTime') &&
    endTime <= startTime
  ) {
    // Mirrors CHECK(end_time > start_time); Odoo still enforces it.
    fieldErrors.endTime = 'The period has to end after it starts.'
  }

  const rawRoom = text(form, 'roomId')
  const roomId = rawRoom ? Number(rawRoom) : 0
  if (rawRoom && (!Number.isInteger(roomId) || roomId <= 0)) {
    fieldErrors.roomId = 'That room could not be identified.'
  }

  const scheduleType = text(form, 'scheduleType') || 'regular'
  if (!SCHEDULE_TYPES.has(scheduleType)) fieldErrors.scheduleType = 'Choose a period type.'

  if (Object.keys(fieldErrors).length > 0) return { fieldErrors }

  return {
    timing: {
      dayOfWeek,
      startTime: startTime as number,
      endTime: endTime as number,
      roomId: roomId > 0 ? roomId : undefined,
      scheduleType,
      notes: text(form, 'notes'),
    },
  }
}

/* ---------------------------------------------------------------- create --- */

export async function createSlotAction(
  _previous: SlotFormState,
  form: FormData,
): Promise<SlotFormState> {
  await requireSession()

  const { timing, fieldErrors } = collectTiming(form)

  const assignmentId = Number(text(form, 'assignmentId'))
  const errors = { ...(fieldErrors ?? {}) }
  if (!Number.isInteger(assignmentId) || assignmentId <= 0) {
    errors.assignmentId = 'Choose the teacher assignment this period belongs to.'
  }
  if (Object.keys(errors).length > 0) return { fieldErrors: errors, values: submitted(form) }

  /*
    The class, subject, term and teacher come from the assignment record, never
    from the form. Odoo's `_onchange_teacher_assignment_id` does this in the
    backend UI and does not fire over JSON-RPC.
  */
  const assignment = (await listAssignmentOptions()).find((option) => option.id === assignmentId)
  if (!assignment) {
    return {
      error: 'That teacher assignment is no longer active, so a period cannot be built on it.',
      values: submitted(form),
    }
  }

  let id: number
  try {
    id = await createSlot(timing!, assignment)
  } catch (cause) {
    return { error: toOdooError(cause).message, values: submitted(form) }
  }

  revalidatePath('/schedule')
  revalidatePath('/schedule/grid')
  redirect(`/schedule/${id}`)
}

/* ------------------------------------------------------------------ edit --- */

export async function updateSlotAction(
  _previous: SlotFormState,
  form: FormData,
): Promise<SlotFormState> {
  await requireSession()

  const id = Number(text(form, 'id'))
  if (!Number.isInteger(id) || id <= 0) return { error: 'That slot could not be identified.' }

  const { timing, fieldErrors } = collectTiming(form)
  if (fieldErrors) return { fieldErrors, values: submitted(form) }

  const slot = await getScheduleDetail(id)
  if (!slot) return { error: 'That slot no longer exists.' }

  /*
    Moving a slot that is already on the published timetable is a reschedule,
    which Odoo will not accept without a reason. Only an actual move counts —
    changing the room or the notes is an ordinary edit, and a draft slot has
    not been promised to anyone yet.
  */
  const moved =
    timing!.dayOfWeek !== String(slot.day_of_week) ||
    timing!.startTime !== slot.start_time ||
    timing!.endTime !== slot.end_time
  const live = slot.state === 'published' || slot.state === 'completed'
  const reason = text(form, 'rescheduleReason')

  if (moved && live && !reason) {
    return {
      fieldErrors: {
        rescheduleReason:
          'Say why this lesson is moving. The previous day and times stay in the record.',
      },
      values: submitted(form),
    }
  }

  try {
    await updateSlot(id, timing!, moved && live ? { reason } : undefined)
  } catch (cause) {
    return { error: toOdooError(cause).message, values: submitted(form) }
  }

  revalidatePath('/schedule')
  revalidatePath('/schedule/grid')
  revalidatePath(`/schedule/${id}`)
  redirect(`/schedule/${id}`)
}
