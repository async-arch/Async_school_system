'use client'

import Link from 'next/link'
import { useActionState, useMemo, useState } from 'react'
import { Button, Note } from '@/components/ui'
import {
  FormActions,
  FormError,
  FormSection,
  ReadOnlyField,
  SelectField,
  TextField,
  type Option,
} from '@/components/ui/form'
import { createTeacherAction, updateTeacherAction, type TeacherFormState } from './actions'

export interface EligibleStaff {
  id: number
  name: string
  staff_id: string
  department: string
  email: string
}

export interface TeacherFormValues {
  id?: number
  teacher_id?: string
  staff_label?: string
  teaching_status: string
  qualification: string
  specialization: string
  years_of_experience: string
  max_weekly_workload: string
  available_days: string
}

/**
 * One form for creating and editing a teaching profile.
 *
 * The difference between the two modes is which staff member the profile
 * belongs to. On create it is chosen; on edit it is shown and not editable,
 * because re-pointing a profile at a different person would silently rewrite
 * the ownership of every assignment and mark hanging off it.
 *
 * Only staff Odoo would accept are offered — active, employed, and either in
 * the academic department or holding a teaching responsibility, which is
 * `_check_staff_active` expressed as a domain. Odoo still runs the check.
 */
export function TeacherForm({
  mode,
  values,
  eligibleStaff,
  teachingStatuses,
}: {
  mode: 'create' | 'edit'
  values: TeacherFormValues
  eligibleStaff: EligibleStaff[]
  teachingStatuses: Option[]
}) {
  const action = mode === 'create' ? createTeacherAction : updateTeacherAction
  const [state, formAction, pending] = useActionState<TeacherFormState, FormData>(action, {})
  const prior = state.values ?? {}
  const value = (field: keyof TeacherFormValues) =>
    prior[field] !== undefined ? prior[field] : String(values[field] ?? '')

  const [staffId, setStaffId] = useState(value('staff_id' as keyof TeacherFormValues) || '')
  const errors = state.fieldErrors ?? {}

  const chosen = useMemo(
    () => eligibleStaff.find((staff) => String(staff.id) === staffId),
    [eligibleStaff, staffId],
  )

  return (
    <form action={formAction} className="space-y-6">
      {mode === 'edit' && values.id ? <input type="hidden" name="id" value={values.id} /> : null}
      <FormError>{state.error}</FormError>

      <FormSection
        title="Staff member"
        hint="A teaching profile always belongs to a staff record — that is what Odoo scopes teaching permissions from."
      >
        {mode === 'create' ? (
          <>
            <SelectField
              label="Staff member"
              name="staff_id"
              required
              options={eligibleStaff.map((staff) => ({
                value: String(staff.id),
                label: staff.staff_id ? `${staff.name} · ${staff.staff_id}` : staff.name,
              }))}
              value={staffId}
              onChange={(event) => setStaffId(event.target.value)}
              error={errors.staff_id}
              hint={
                eligibleStaff.length
                  ? 'Only active academic staff, or staff holding a teaching responsibility, appear here.'
                  : 'No eligible staff. Register and activate a staff member in the academic department first.'
              }
            />
            <ReadOnlyField
              label="Email on the staff record"
              value={chosen?.email}
              hint="Odoo needs this before it can create the teaching login."
            />
          </>
        ) : (
          <>
            <ReadOnlyField label="Staff member" value={values.staff_label} />
            <ReadOnlyField
              label="Teacher number"
              value={values.teacher_id}
              hint="Assigned by Odoo's TCH- sequence."
            />
          </>
        )}
      </FormSection>

      <FormSection title="Teaching profile">
        <SelectField
          label="Teaching status"
          name="teaching_status"
          options={teachingStatuses}
          defaultValue={value('teaching_status') || 'active'}
          error={errors.teaching_status}
          hint="Suspending the staff record sets this to inactive automatically."
        />
        <TextField
          label="Qualification"
          name="qualification"
          defaultValue={value('qualification')}
          placeholder="BSc Mathematics"
        />
        <TextField
          label="Specialisation"
          name="specialization"
          defaultValue={value('specialization')}
          placeholder="Mathematics, Physics"
        />
        <TextField
          label="Years of experience"
          name="years_of_experience"
          type="number"
          min={0}
          defaultValue={value('years_of_experience')}
        />
        <TextField
          label="Maximum weekly periods"
          name="max_weekly_workload"
          type="number"
          min={0}
          defaultValue={value('max_weekly_workload')}
          hint="Odoo refuses an assignment that would take this teacher past it. Leave blank for no limit."
        />
        <TextField
          label="Available days"
          name="available_days"
          defaultValue={value('available_days')}
          placeholder="Mon, Tue, Thu"
        />
      </FormSection>

      {mode === 'create' ? (
        <Note>
          Creating the profile also creates the teaching login, against the email on the staff
          record, and Odoo emails a password reset. No password passes through this application.
          If the staff record has no email, Odoo refuses and says so.
        </Note>
      ) : null}

      <FormActions>
        <Button type="submit" pending={pending}>
          {pending
            ? mode === 'create'
              ? 'Creating…'
              : 'Saving…'
            : mode === 'create'
              ? 'Create teaching profile'
              : 'Save changes'}
        </Button>
        <Link
          href={mode === 'edit' && values.id ? `/teachers/${values.id}` : '/teachers'}
          className="rounded-[9999px] border border-silver px-5 py-2.5 text-[13px] hover:bg-paper"
        >
          Cancel
        </Link>
      </FormActions>
    </form>
  )
}
