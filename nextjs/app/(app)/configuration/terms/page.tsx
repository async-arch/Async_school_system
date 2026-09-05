import { Breadcrumbs, ErrorState, Note, PageHeader } from '@/components/ui'
import { hasAccess } from '@/lib/odoo/client'
import { toOdooError } from '@/lib/odoo/errors'
import { listAcademicYears } from '@/lib/odoo/models/school'
import { listTerms } from '@/lib/odoo/models/operations'
import { m2oId } from '@/lib/odoo/types'
import { TermsManager, type TermView, type YearOption } from './terms-manager'

export const metadata = { title: 'Terms · Async School' }

/**
 * Terms — the one academic vocabulary that is not a vocabulary.
 *
 * Every assessment, mark list, report card and teaching assignment is filed
 * under a term, and until now a term could be created nowhere in this
 * application: a school could open an academic year and then had no way to
 * divide it. That made the whole assessment half of the product unreachable
 * on a fresh database.
 *
 * It gets its own screen rather than joining the generic vocabulary manager
 * because it is the only one with a parent and a date range Odoo checks
 * against that parent.
 */
export default async function TermsPage() {
  let terms: TermView[]
  let years: YearOption[]
  let canCreate: boolean
  let canWrite: boolean

  try {
    const [termPage, yearPage, create, write] = await Promise.all([
      listTerms(),
      listAcademicYears({ limit: 50, order: 'date_start desc' }),
      hasAccess('school.term', 'create'),
      hasAccess('school.term', 'write'),
    ])
    canCreate = create
    canWrite = write
    years = yearPage.rows.map((year) => ({ id: year.id, name: year.name }))
    terms = termPage.rows.map((term) => ({
      id: term.id,
      name: term.name,
      academicYearId: String(m2oId(term.academic_year_id) ?? ''),
      // Odoo dates are already ISO calendar dates; passed through untouched so
      // no browser timezone can shift a term boundary by a day.
      dateStart: term.date_start || '',
      dateEnd: term.date_end || '',
      sequence: String(term.sequence ?? 10),
      active: Boolean(term.active),
    }))
  } catch (cause) {
    return (
      <>
        <PageHeader title="Terms" />
        <ErrorState {...toOdooError(cause).toClient()} retryHref="/configuration" />
      </>
    )
  }

  return (
    <>
      <Breadcrumbs trail={[{ label: 'Configuration', href: '/configuration' }, { label: 'Terms' }]} />
      <PageHeader
        title="Terms"
        subtitle="Each term belongs to one academic year and must fall inside it. Assessments, marks and report cards are all filed under one."
      />

      <TermsManager terms={terms} years={years} canCreate={canCreate} canWrite={canWrite} />

      {years.length === 0 ? (
        <Note>
          There is no academic year to put a term in yet. Create one first — a term cannot exist
          without a year to belong to.
        </Note>
      ) : !canWrite ? (
        <Note>
          Your role may read terms but not change them. That is the school system&apos;s own
          answer, and an administrator can widen it.
        </Note>
      ) : null}
    </>
  )
}
