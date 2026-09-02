import { redirect } from 'next/navigation'
import { Card, EmptyState, ErrorState, LinkButton, PageHeader } from '@/components/ui'
import { toOdooError } from '@/lib/odoo/errors'
import { canCreateTeacher, listEligibleStaff, teacherFieldMeta } from '@/lib/odoo/models/teacher'
import { TeacherForm } from '../teacher-form'

export const metadata = { title: 'New teaching profile · Async School' }

/**
 * A teaching profile cannot be created from nothing: Odoo requires an active
 * staff record that is either in the academic department or holds a teaching
 * responsibility. When none qualifies, the page says so and points at the step
 * that comes first rather than offering a form that cannot be submitted.
 */
export default async function NewTeacherPage() {
  let eligible, meta, canCreate
  try {
    ;[eligible, meta, canCreate] = await Promise.all([
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

  return (
    <>
      <PageHeader
        title="New teaching profile"
        subtitle="A profile hangs off an existing staff record. Odoo assigns the teacher number and creates the teaching login."
        breadcrumbs={[{ label: 'Teachers', href: '/teachers' }, { label: 'New' }]}
      />
      <Card className="max-w-4xl">
        {eligible.length === 0 ? (
          <EmptyState
            icon="teachers"
            title="No staff member is eligible yet"
            hint="Odoo accepts a teaching profile only on an active, employed staff member who is in the academic department or holds a teaching responsibility."
            action={
              <LinkButton href="/staff/new" variant="primary" icon="plus" size="sm">
                Register a staff member
              </LinkButton>
            }
          />
        ) : (
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
        )}
      </Card>
    </>
  )
}
