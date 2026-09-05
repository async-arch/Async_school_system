import { Breadcrumbs, ErrorState, Note, PageHeader, RestrictedState } from '@/components/ui'
import { toOdooError } from '@/lib/odoo/errors'
import { canCreatePromotionBatch, promotionFormOptions } from '@/lib/odoo/models/assessment'
import { PromotionForm } from '../promotion-form'

export const metadata = { title: 'New promotion batch · Async School' }

/**
 * The step that closes an academic year.
 *
 * A batch could be listed, opened and run, and created nowhere — so on a fresh
 * database calculate, approve and apply had nothing to act on and the year
 * could never be closed through this application.
 *
 * Only a Registrar or an Administrator may manage one. Odoo checks that itself
 * inside every one of the three actions, not only on create.
 */
export default async function NewPromotionBatchPage() {
  let options: Awaited<ReturnType<typeof promotionFormOptions>>
  let canCreate: boolean

  try {
    ;[options, canCreate] = await Promise.all([promotionFormOptions(), canCreatePromotionBatch()])
  } catch (cause) {
    return (
      <>
        <PageHeader title="New promotion batch" />
        <ErrorState {...toOdooError(cause).toClient()} retryHref="/promotion" />
      </>
    )
  }

  if (!canCreate) {
    return (
      <>
        <PageHeader title="New promotion batch" />
        <RestrictedState what="Creating a promotion batch" />
      </>
    )
  }

  const enoughYears = options.years.length >= 2

  return (
    <>
      <Breadcrumbs
        trail={[{ label: 'Promotion', href: '/promotion' }, { label: 'New batch' }]}
      />
      <PageHeader
        title="New promotion batch"
        subtitle="One grade, moving from the year that is ending into the next one."
      />

      {!enoughYears ? (
        <Note>
          A promotion needs two academic years — the one ending and the one students move into.
          Create the next year before starting a batch.
        </Note>
      ) : (
        <PromotionForm
          years={options.years.map((year) => ({
            id: year.id,
            name: year.name,
            date_start: year.date_start,
            date_end: year.date_end,
          }))}
          grades={options.grades.map((grade) => ({ id: grade.id, name: grade.name }))}
          classes={options.classes}
        />
      )}
    </>
  )
}
