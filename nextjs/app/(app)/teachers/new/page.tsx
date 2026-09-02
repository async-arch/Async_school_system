import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Card, EmptyState, ErrorState, LinkButton, Note, PageHeader } from '@/components/ui'
import { Icon } from '@/components/icons'
import { formatSelection } from '@/lib/format'
import { toOdooError } from '@/lib/odoo/errors'
import { canCreateTeacher, listEligibleStaff, teacherFieldMeta } from '@/lib/odoo/models/teacher'
import { TeacherForm } from '../teacher-form'

export const metadata = { title: 'New teaching profile · Async School' }

/**
 * A teaching profile cannot be created from nothing: Odoo requires an active
 * staff record that is either in the academic department or holds a teaching
 * responsibility.
 *
 * The page names the staff who fall just short, because the failure mode
 * otherwise is silent — somebody registers a colleague, comes here, sees a
 * populated list without them in it, and cannot tell whether the record saved
 * or the rule excluded them. A draft staff member is one click from eligible;
 * saying so is the difference between a dead end and a next step.
 */
export default async function NewTeacherPage() {
  let candidates, meta, canCreate
  try {
    ;[candidates, meta, canCreate] = await Promise.all([
      listEligibleStaff(),
      teacherFieldMeta(),
      canCreateTeacher(),
    ])
  } catch (cause) {
    return (
      <>
        <PageHeader title="New teaching profile" />
        <ErrorState {...toOdooError(cause).toClient()} retryHref="/teachers" />
      </>
    )
  }

  if (!canCreate) redirect('/teachers')

  const { eligible, blocked } = candidates

  return (
    <>
      <PageHeader
        title="New teaching profile"
        subtitle="A profile hangs off an existing staff record. Odoo assigns the teacher number and creates the teaching login."
        breadcrumbs={[{ label: 'Teachers', href: '/teachers' }, { label: 'New' }]}
      />

      {blocked.length > 0 ? (
        <Card className="mb-4 border border-[var(--color-status-progress)]/20 bg-[var(--color-status-progress-bg)] shadow-none">
          <div className="flex gap-3">
            <span className="mt-0.5 shrink-0 text-[var(--color-status-progress)]">
              <Icon name="alert" size={18} />
            </span>
            <div className="min-w-0">
              <p className="text-[13px] font-medium text-[var(--color-status-progress)]">
                {blocked.length === 1
                  ? 'One staff member is not eligible yet'
                  : `${blocked.length} staff members are not eligible yet`}
              </p>
              <p className="mt-1 text-[12px] text-graphite">
                Odoo only accepts a teaching profile on an active staff member who is in the
                academic department or holds a teaching responsibility.
              </p>
              <ul className="mt-3 space-y-1.5">
                {blocked.slice(0, 6).map(({ staff, reason }) => (
                  <li key={staff.id} className="text-[12px]">
                    <Link
                      href={`/staff/${staff.id}`}
                      className="font-medium text-graphite hover:text-action-blue"
                    >
                      {staff.name}
                    </Link>
                    {staff.staff_id ? (
                      <span className="tabular text-stone"> · {staff.staff_id}</span>
                    ) : null}
                    <span className="text-slate"> — {reason}</span>
                    {staff.department ? (
                      <span className="text-stone"> ({formatSelection(staff.department)})</span>
                    ) : null}
                  </li>
                ))}
              </ul>
              {blocked.length > 6 ? (
                <p className="mt-2 text-[11px] text-stone">
                  and {blocked.length - 6} more — see the staff list.
                </p>
              ) : null}
            </div>
          </div>
        </Card>
      ) : null}

      <Card className="max-w-4xl">
        {eligible.length === 0 ? (
          <EmptyState
            icon="teachers"
            title="No staff member is eligible yet"
            hint={
              blocked.length > 0
                ? 'Activate one of the staff records listed above, then come back.'
                : 'Odoo accepts a teaching profile only on an active, employed staff member who is in the academic department or holds a teaching responsibility.'
            }
            action={
              <LinkButton
                href={blocked.length > 0 ? `/staff/${blocked[0].staff.id}` : '/staff/new'}
                variant="primary"
                icon={blocked.length > 0 ? 'staff' : 'plus'}
                size="sm"
              >
                {blocked.length > 0 ? `Open ${blocked[0].staff.name}` : 'Register a staff member'}
              </LinkButton>
            }
          />
        ) : (
          <>
            <TeacherForm
              mode="create"
              values={{
                teaching_status: 'active',
                qualification: '',
                specialization: '',
                years_of_experience: '',
                max_weekly_workload: '',
                available_days: '',
              }}
              eligibleStaff={eligible.map((staff) => ({
                id: staff.id,
                name: staff.name,
                staff_id: String(staff.staff_id || ''),
                department: String(staff.department || ''),
                email: String(staff.email || ''),
              }))}
              teachingStatuses={meta.teaching_status?.selection ?? []}
            />
            <Note>
              Not seeing somebody you just registered? A staff record starts in Draft, and Odoo
              will not accept a teaching profile until it is activated — open their staff record
              and activate it.
            </Note>
          </>
        )}
      </Card>
    </>
  )
}
