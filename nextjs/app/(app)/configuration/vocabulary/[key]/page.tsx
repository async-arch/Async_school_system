import { notFound } from 'next/navigation'
import { Breadcrumbs, ErrorState, Note, PageHeader } from '@/components/ui'
import { formatClock } from '@/lib/format'
import { toOdooError } from '@/lib/odoo/errors'
import {
  VOCABULARY_KEYS,
  getVocabulary,
  listVocabulary,
  vocabularyAccess,
  vocabularyChoices,
  type VocabularyRow,
  type VocabularySpec,
} from '@/lib/odoo/models/vocabulary'
import { VocabularyManager, type RowView } from './vocabulary-manager'

/**
 * One screen for six vocabularies, driven by the spec table in
 * lib/odoo/models/vocabulary.ts. Adding a seventh is an entry there.
 *
 * Whether the person can change anything is asked of Odoo per model, because
 * the answer differs: the Registrar may manage grades, sections, streams,
 * shifts and job titles, but document types are the administrator's. A role
 * that can only read gets the list with its inputs disabled and no add form,
 * and Odoo would refuse the write in any case.
 */

export async function generateStaticParams() {
  return VOCABULARY_KEYS.map((key) => ({ key }))
}

export async function generateMetadata({ params }: PageProps<'/configuration/vocabulary/[key]'>) {
  const spec = getVocabulary((await params).key)
  return { title: `${spec?.title ?? 'Configuration'} · Async School` }
}

/** The form value for one field: what an input needs as its defaultValue. */
function formValue(spec: VocabularySpec, row: VocabularyRow, name: string): string {
  const raw = row[name]
  const field = spec.fields.find((candidate) => candidate.name === name)

  if (field?.kind === 'boolean') return raw ? 'true' : 'false'
  // An unset clock is 0, which is a real time — show it as empty, not 00:00.
  if (field?.kind === 'clock') return typeof raw === 'number' && raw > 0 ? formatClock(raw) : ''
  if (raw === false || raw === null || raw === undefined) return ''
  return String(raw)
}

export default async function VocabularyPage({
  params,
}: PageProps<'/configuration/vocabulary/[key]'>) {
  const { key } = await params
  const spec = getVocabulary(key)
  if (!spec) notFound()

  let rows: RowView[]
  let choices: Record<string, Array<{ value: string; label: string }>>
  let access: { canCreate: boolean; canWrite: boolean }
  try {
    const [page, resolvedChoices, resolvedAccess] = await Promise.all([
      listVocabulary(spec),
      vocabularyChoices(spec),
      vocabularyAccess(spec),
    ])
    choices = resolvedChoices
    access = resolvedAccess
    rows = page.rows.map((row) => ({
      id: row.id,
      values: Object.fromEntries(
        spec.fields.map((field) => [field.name, formValue(spec, row, field.name)]),
      ),
      readOnly: Object.fromEntries(
        (spec.readOnly ?? []).map((column) => [
          column.name,
          row[column.name] === false || row[column.name] === undefined
            ? '—'
            : String(row[column.name]),
        ]),
      ),
    }))
  } catch (cause) {
    return (
      <>
        <PageHeader title={spec.title} />
        <ErrorState {...toOdooError(cause).toClient()} retryHref="/configuration" />
      </>
    )
  }

  return (
    <>
      <Breadcrumbs
        trail={[{ label: 'Configuration', href: '/configuration' }, { label: spec.title }]}
      />
      <PageHeader title={spec.title} subtitle={spec.hint} />

      <VocabularyManager
        vocabulary={key}
        singular={spec.singular}
        fields={spec.fields.map((field) => ({ ...field }))}
        readOnlyColumns={[...(spec.readOnly ?? [])]}
        rows={rows}
        choices={choices}
        canCreate={access.canCreate}
        canWrite={access.canWrite}
      />

      {!access.canWrite ? (
        <Note>
          Your role may read this list but not change it. That is the school system&apos;s own
          answer, and an administrator can widen it.
        </Note>
      ) : (
        <Note>
          Clearing <strong>Active</strong> archives an entry: it stops being offered on new records
          and stays on the ones that already use it. Odoo refuses a delete that would orphan
          existing records, so archiving is the way to retire one.
        </Note>
      )}
    </>
  )
}
