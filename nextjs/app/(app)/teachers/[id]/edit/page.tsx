import { notFound, redirect } from 'next/navigation'
import { Card, ErrorState, PageHeader } from '@/components/ui'
import { toOdooError } from '@/lib/odoo/errors'
import { canWriteTeacher, getTeacher, teacherFieldMeta } from '@/lib/odoo/models/teacher'
import { m2oLabel } from '@/lib/odoo/types'
import { TeacherForm } from '../../teacher-form'

export const metadata = { title: 'Edit teacher · Async School' }

export default async function EditTeacherPage({ params }: PageProps<'/teachers/[id]/edit'>) {
  const id = Number((await params).id)
  if (!Number.isFinite(id)) notFound()

  let teacher, meta, canWrite
  try {
    ;[teacher, meta, canWrite] = await Promise.all([
      getTeacher(id),
      teacherFieldMeta(),
      canWriteTeacher(),
    ])
  } catch (cause) {
    return (
      <>
        <PageHeader title="Edit teacher" />
        <ErrorState {...toOdooError(cause).toClient()} retryHref={`/teachers/${id}`} />
      </>
    )
  }

  if (!teacher) notFound()
  if (!canWrite) redirect(`/teachers/${id}`)

  return (
    <>
      <PageHeader
        title={`Edit ${teacher.name}`}
        subtitle="The staff link and teacher number are Odoo's; everything below is the teaching profile."
        breadcrumbs={[
          { label: 'Teachers', href: '/teachers' },
          { label: teacher.name, href: `/teachers/${id}` },
          { label: 'Edit' },
        ]}
      />
      <Card className="max-w-4xl">
        <TeacherForm
          mode="edit"
          values={{
            id: teacher.id,
            teacher_id: String(teacher.teacher_id || ''),
            staff_label: m2oLabel(teacher.staff_id),
            teaching_status: String(teacher.teaching_status || ''),
            qualification: String(teacher.qualification || ''),
            specialization: String(teacher.specialization || ''),
            years_of_experience: teacher.years_of_experience
              ? String(teacher.years_of_experience)
              : '',
            max_weekly_workload: teacher.max_weekly_workload
              ? String(teacher.max_weekly_workload)
              : '',
            available_days: String(teacher.available_days || ''),
          }}
          eligibleStaff={[]}
          teachingStatuses={meta.teaching_status?.selection ?? []}
        />
      </Card>
    </>
  )
}
