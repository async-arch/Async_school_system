'use client'

import { useActionState } from 'react'
import { Button, Card, cx } from '@/components/ui'
import { Field, FormActions, FormError, INPUT_CLASS, INPUT_INVALID } from '@/components/ui/form'
import { createSlotAction, updateSlotAction, type SlotFormState } from './slot-actions'

/**
 * One timetable slot, created or edited.
 *
 * On create the assignment is the first question, because everything else
 * about the lesson follows from it — the class, the subject, the term and the
 * teacher are all read off that record on the server. On edit it is shown but
 * fixed: moving a slot to a different teacher or subject is a different lesson,
 * not an edit of this one.
 *
 * A slot already on the published timetable carries a reschedule reason box.
 * Odoo refuses the move without one, and the server — not this form — decides
 * whether a given save actually is a move.
 */

export interface AssignmentChoice {
  id: number
  label: string
}

export interface SlotDefaults {
  assignmentId: string
  assignmentLabel?: string
  dayOfWeek: string
  startTime: string
  endTime: string
  roomId: string
  scheduleType: string
  notes: string
}

const DAYS = [
  ['0', 'Monday'],
  ['1', 'Tuesday'],
  ['2', 'Wednesday'],
  ['3', 'Thursday'],
  ['4', 'Friday'],
  ['5', 'Saturday'],
  ['6', 'Sunday'],
] as const

export function SlotForm({
  mode,
  id,
  defaults,
  assignments,
  rooms,
  types,
  /** Published or completed: a change of day or time needs a reason. */
  live = false,
}: {
  mode: 'create' | 'edit'
  id?: number
  defaults: SlotDefaults
  assignments: AssignmentChoice[]
  rooms: Array<{ id: number; name: string }>
  types: Array<{ value: string; label: string }>
  live?: boolean
}) {
  const [state, action, pending] = useActionState<SlotFormState, FormData>(
    mode === 'create' ? createSlotAction : updateSlotAction,
    {},
  )

  const value = (field: keyof SlotDefaults) => state.values?.[field] ?? defaults[field]
  // Never a stored value — only whatever the last rejected submit carried.
  const resubmitted = (field: string) => state.values?.[field] ?? ''
  const error = (field: string) => state.fieldErrors?.[field]

  /*
    React 19 resets a `<form>` once its action returns — including when the
    action returns a validation error. That reset put the stored day back into
    this form after a refused save, so somebody asked for a reschedule reason
    would see the day they had just picked silently revert to the old one,
    supply the reason, and save the *original* day believing it had moved.

    So nothing about the submission is kept in client state. Every field is
    re-seeded from `value()` — the rejected submission first, the record
    otherwise — and `formKey` changes on each response so React rebuilds the
    inputs with those values rather than the reset ones.

    Whether a change counts as a reschedule is decided only on the server,
    which compares against the stored record. The client cannot get that wrong
    because it no longer tries.
  */
  const formKey = state.values ? JSON.stringify(state.values) : 'initial'

  return (
    <form action={action}>
      {mode === 'edit' ? <input type="hidden" name="id" value={id} /> : null}

      <Card>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Field
              label="Teacher assignment"
              htmlFor="assignmentId"
              required
              error={error('assignmentId')}
              hint={
                mode === 'edit'
                  ? 'Fixed. A different teacher, subject or class is a different lesson — cancel this slot and create that one.'
                  : 'The class, subject, term and teacher all come from this. Only active assignments are offered.'
              }
            >
              {mode === 'edit' ? (
                <>
                  <input
                    id="assignmentId"
                    className={cx(INPUT_CLASS, 'bg-paper text-stone')}
                    value={defaults.assignmentLabel ?? ''}
                    readOnly
                    disabled
                  />
                  <input type="hidden" name="assignmentId" value={defaults.assignmentId} />
                </>
              ) : (
                <select
                  id="assignmentId"
                  name="assignmentId"
                  key={`assignment-${formKey}`}
                  defaultValue={value('assignmentId')}
                  className={cx(INPUT_CLASS, error('assignmentId') && INPUT_INVALID)}
                >
                  <option value="">Choose an assignment…</option>
                  {assignments.map((assignment) => (
                    <option key={assignment.id} value={assignment.id}>
                      {assignment.label}
                    </option>
                  ))}
                </select>
              )}
            </Field>
          </div>

          <Field label="Day" htmlFor="dayOfWeek" required error={error('dayOfWeek')}>
            <select
              id="dayOfWeek"
              name="dayOfWeek"
              key={`day-${formKey}`}
              defaultValue={value('dayOfWeek')}
              className={cx(INPUT_CLASS, error('dayOfWeek') && INPUT_INVALID)}
            >
              {DAYS.map(([code, label]) => (
                <option key={code} value={code}>
                  {label}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Room" htmlFor="roomId" error={error('roomId')} hint="Optional.">
            <select
              id="roomId"
              name="roomId"
              key={`room-${formKey}`}
              defaultValue={value('roomId')}
              className={cx(INPUT_CLASS, error('roomId') && INPUT_INVALID)}
            >
              <option value="">No room</option>
              {rooms.map((room) => (
                <option key={room.id} value={room.id}>
                  {room.name}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Starts" htmlFor="startTime" required error={error('startTime')}>
            <input
              id="startTime"
              name="startTime"
              type="time"
              key={`start-${formKey}`}
              defaultValue={value('startTime')}
              className={cx(INPUT_CLASS, error('startTime') && INPUT_INVALID)}
            />
          </Field>

          <Field label="Ends" htmlFor="endTime" required error={error('endTime')}>
            <input
              id="endTime"
              name="endTime"
              type="time"
              key={`end-${formKey}`}
              defaultValue={value('endTime')}
              className={cx(INPUT_CLASS, error('endTime') && INPUT_INVALID)}
            />
          </Field>

          <Field label="Type" htmlFor="scheduleType" error={error('scheduleType')}>
            <select
              id="scheduleType"
              name="scheduleType"
              key={`type-${formKey}`}
              defaultValue={value('scheduleType') || 'regular'}
              className={cx(INPUT_CLASS, error('scheduleType') && INPUT_INVALID)}
            >
              {types.map((type) => (
                <option key={type.value} value={type.value}>
                  {type.label}
                </option>
              ))}
            </select>
          </Field>

          <div className="sm:col-span-2">
            <Field label="Notes" htmlFor="notes" error={error('notes')}>
              <textarea
                id="notes"
                name="notes"
                rows={2}
                key={`notes-${formKey}`}
                defaultValue={value('notes')}
                className={cx(INPUT_CLASS, 'resize-y')}
              />
            </Field>
          </div>

          {live ? (
            <div className="sm:col-span-2">
              <Field
                label="Reschedule reason"
                htmlFor="rescheduleReason"
                error={error('rescheduleReason')}
                hint="Required only if you change the day or the times. Odoo records the move and keeps the previous day and times in the log."
              >
                <textarea
                  id="rescheduleReason"
                  name="rescheduleReason"
                  rows={2}
                  key={`reason-${formKey}`}
                  defaultValue={resubmitted('rescheduleReason')}
                  className={cx(
                    INPUT_CLASS,
                    'resize-y',
                    error('rescheduleReason') && INPUT_INVALID,
                  )}
                />
              </Field>
            </div>
          ) : null}
        </div>

        {state.error ? (
          <div className="mt-4">
            <FormError>{state.error}</FormError>
          </div>
        ) : null}

        <FormActions>
          <Button type="submit" variant="primary" disabled={pending}>
            {pending ? 'Saving…' : mode === 'create' ? 'Create period' : 'Save changes'}
          </Button>
        </FormActions>
      </Card>
    </form>
  )
}
