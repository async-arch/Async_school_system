'use client'

import { useActionState } from 'react'
import { Badge, Button } from '@/components/ui'
import { createTeacherLoginAction, type TeacherFormState } from '../actions'

/**
 * Provisioning the teaching login.
 *
 * The button calls Odoo's own `action_create_login_user`. Everything that
 * matters happens there: the user is created against the staff email, added to
 * the teacher group, linked back to both records, and sent a password reset.
 * This component holds no credential and offers no way to set one.
 */
export function TeacherLogin({
  teacherId,
  userLabel,
  canWrite,
}: {
  teacherId: number
  userLabel: string
  canWrite: boolean
}) {
  const [state, formAction, pending] = useActionState<TeacherFormState, FormData>(
    createTeacherLoginAction,
    {},
  )

  if (userLabel) {
    return (
      <div className="space-y-2">
        <Badge tone="live">Login active</Badge>
        <p className="text-[13px] text-graphite">{userLabel}</p>
      </div>
    )
  }

  if (!canWrite) {
    return <p className="text-[12px] text-slate">No login yet. Your role cannot create one.</p>
  }

  return (
    <div className="space-y-3">
      <p className="text-[12px] text-slate">
        This teacher has no Odoo login, so they cannot sign in to see their classes.
      </p>
      {state.error ? (
        <p role="alert" className="rounded-[8px] bg-danger-bg px-3 py-2 text-[12px] text-danger">
          {state.error}
        </p>
      ) : null}
      {state.ok ? (
        <p role="status" className="rounded-[8px] bg-info-bg px-3 py-2 text-[12px] text-action-blue">
          {state.ok}
        </p>
      ) : null}
      <form action={formAction}>
        <input type="hidden" name="id" value={teacherId} />
        <Button type="submit" size="sm" icon="user" pending={pending} className="w-full">
          {pending ? 'Creating…' : 'Create teaching login'}
        </Button>
      </form>
    </div>
  )
}
