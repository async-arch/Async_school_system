import 'server-only'
import { create, hasAccess, searchRead, write } from '@/lib/odoo/client'
import { orNullOnRefusal } from '@/lib/odoo/errors'
import { selectionOptions } from '@/lib/odoo/selections'
import { clockToFloat } from '@/lib/format'
import type { Page } from '@/lib/odoo/types'

/**
 * The small academic vocabularies — grades, sections, streams, shifts, job
 * titles and document types.
 *
 * All six were listed on /configuration and creatable nowhere, so a school
 * could see the sections it had and could not add one. They are near-identical
 * name/code/sequence/active records, which is why this is one spec table and
 * one screen rather than six copies of the same form: adding a vocabulary here
 * is a table entry, not a route.
 *
 * Who may change them is Odoo's answer and it differs per model — the
 * Registrar has create and write on grades, sections, streams, shifts and job
 * titles, but `school.document.type` grants writes to the administrator alone.
 * Every screen asks `hasAccess` for the model it is actually on, and Odoo
 * refuses again on submit regardless.
 *
 * Unique codes, the one-grade-per-level rule, the shift time order — all of it
 * stays in Odoo. Nothing here re-implements a constraint; the field specs only
 * describe what to draw and how to turn a form value into an Odoo one.
 */

export type FieldKind = 'text' | 'integer' | 'boolean' | 'selection' | 'clock'

export interface VocabularyField {
  name: string
  label: string
  kind: FieldKind
  required?: boolean
  help?: string
}

export interface VocabularySpec {
  model: string
  /** Plural, for the page heading. */
  title: string
  /** Singular, for "Add a section". */
  singular: string
  hint: string
  fields: VocabularyField[]
  order: string
  /** Computed fields shown in the table but never in the form. */
  readOnly?: Array<{ name: string; label: string }>
}

export const VOCABULARIES = {
  grades: {
    model: 'school.grade',
    title: 'Grades',
    singular: 'grade',
    hint: 'Grade 1 to 12. The level is what Odoo checks the entry-age rule against, and only one grade may hold each level.',
    order: 'sequence, name',
    fields: [
      { name: 'name', label: 'Name', kind: 'text', required: true },
      { name: 'code', label: 'Code', kind: 'text', required: true },
      { name: 'level', label: 'Level', kind: 'selection', required: true },
      { name: 'sequence', label: 'Sequence', kind: 'integer' },
      { name: 'active', label: 'Active', kind: 'boolean' },
    ],
  },
  sections: {
    model: 'school.section',
    title: 'Sections',
    singular: 'section',
    hint: 'The letter after a grade — A, B, C. One class exists per grade and section.',
    order: 'sequence, name',
    readOnly: [{ name: 'class_count', label: 'Classes' }],
    fields: [
      { name: 'name', label: 'Section', kind: 'text', required: true },
      { name: 'sequence', label: 'Sequence', kind: 'integer' },
      { name: 'active', label: 'Active', kind: 'boolean' },
    ],
  },
  streams: {
    model: 'school.stream',
    title: 'Streams',
    singular: 'stream',
    hint: 'Natural and Social Science. Odoo allows a stream on Grades 11 and 12 only.',
    order: 'sequence, name',
    fields: [
      { name: 'name', label: 'Name', kind: 'text', required: true },
      { name: 'code', label: 'Code', kind: 'text', required: true },
      { name: 'sequence', label: 'Sequence', kind: 'integer' },
      { name: 'active', label: 'Active', kind: 'boolean' },
    ],
  },
  shifts: {
    model: 'school.shift',
    title: 'Shifts',
    singular: 'shift',
    hint: 'Morning and afternoon sittings. Leave both times empty for a shift that has no fixed hours.',
    order: 'sequence, name',
    fields: [
      { name: 'name', label: 'Name', kind: 'text', required: true },
      { name: 'code', label: 'Code', kind: 'text', required: true },
      { name: 'time_start', label: 'Starts at', kind: 'clock' },
      { name: 'time_end', label: 'Ends at', kind: 'clock' },
      { name: 'sequence', label: 'Sequence', kind: 'integer' },
      { name: 'active', label: 'Active', kind: 'boolean' },
    ],
  },
  'job-titles': {
    model: 'school.job.title',
    title: 'Job titles',
    singular: 'job title',
    hint: 'What a staff member is appointed as. A title is unique within its department.',
    order: 'name',
    fields: [
      { name: 'name', label: 'Job title', kind: 'text', required: true },
      { name: 'department', label: 'Department', kind: 'selection', required: true },
      { name: 'active', label: 'Active', kind: 'boolean' },
    ],
  },
  'document-types': {
    model: 'school.document.type',
    title: 'Document types',
    singular: 'document type',
    hint: 'What a document can be. Document rules then decide which of these a registration requires.',
    order: 'name',
    fields: [
      { name: 'name', label: 'Name', kind: 'text', required: true },
      { name: 'code', label: 'Code', kind: 'text', required: true },
      { name: 'owner_type', label: 'Belongs to', kind: 'selection', required: true },
      {
        name: 'expires',
        label: 'Expires',
        kind: 'boolean',
        help: 'Documents of this type carry an expiry date.',
      },
      {
        name: 'sensitive',
        label: 'Sensitive',
        kind: 'boolean',
        help: 'Restricts who may read the uploaded file.',
      },
      { name: 'active', label: 'Active', kind: 'boolean' },
    ],
  },
} as const satisfies Record<string, VocabularySpec>

export type VocabularyKey = keyof typeof VOCABULARIES

export function getVocabulary(key: string): VocabularySpec | null {
  return (VOCABULARIES as Record<string, VocabularySpec>)[key] ?? null
}

export const VOCABULARY_KEYS = Object.keys(VOCABULARIES) as VocabularyKey[]

/* ------------------------------------------------------------- reading --- */

export interface VocabularyRow {
  id: number
  [field: string]: unknown
}

function fieldNames(spec: VocabularySpec): string[] {
  return [
    ...spec.fields.map((field) => field.name),
    ...(spec.readOnly ?? []).map((field) => field.name),
  ]
}

/**
 * Every row, archived ones included.
 *
 * `active_test: false` is Odoo's own switch for that; a domain on `active` is
 * silently ignored. A vocabulary screen has to show the archived entries,
 * because un-archiving one is the whole reason somebody opens it.
 */
export function listVocabulary(spec: VocabularySpec): Promise<Page<VocabularyRow>> {
  return searchRead<VocabularyRow>(spec.model, fieldNames(spec), {
    limit: 200,
    order: spec.order,
    context: { active_test: false },
    withTotal: false,
  })
}

/** Selection choices come from Odoo, so a level added to the module appears here. */
export async function vocabularyChoices(
  spec: VocabularySpec,
): Promise<Record<string, Array<{ value: string; label: string }>>> {
  const selections = spec.fields.filter((field) => field.kind === 'selection')
  const entries = await Promise.all(
    selections.map(
      async (field) => [field.name, await selectionOptions(spec.model, field.name)] as const,
    ),
  )
  return Object.fromEntries(entries)
}

export async function vocabularyAccess(
  spec: VocabularySpec,
): Promise<{ canCreate: boolean; canWrite: boolean }> {
  const [canCreate, canWrite] = await Promise.all([
    hasAccess(spec.model, 'create'),
    hasAccess(spec.model, 'write'),
  ])
  return { canCreate, canWrite }
}

/** Null rather than a throw, so one restricted vocabulary is a stated boundary. */
export function countVocabulary(spec: VocabularySpec): Promise<Page<VocabularyRow> | null> {
  return orNullOnRefusal(listVocabulary(spec))
}

/* ------------------------------------------------------------- writing --- */

export interface FieldErrors {
  [field: string]: string
}

/**
 * Turn one submitted form into Odoo values.
 *
 * Only the fields the spec declares are read, so a hand-posted extra field
 * never reaches Odoo. The checks here are the ones a form can answer — a
 * missing required value, a clock that is not a time — and exist to save a
 * round trip. Uniqueness, the level rule and the time order all stay with
 * Odoo, which answers in its own words.
 */
export function collectVocabulary(
  spec: VocabularySpec,
  read: (name: string) => string,
  present: (name: string) => boolean,
): { values?: Record<string, unknown>; fieldErrors?: FieldErrors } {
  const values: Record<string, unknown> = {}
  const fieldErrors: FieldErrors = {}

  for (const field of spec.fields) {
    const raw = read(field.name).trim()

    switch (field.kind) {
      case 'boolean':
        // An unchecked box submits nothing, so only write what was rendered.
        if (present(field.name)) values[field.name] = raw === 'true'
        break

      case 'integer': {
        if (!raw) {
          if (field.required) fieldErrors[field.name] = `${field.label} is required.`
          break
        }
        const parsed = Number(raw)
        if (!Number.isInteger(parsed)) {
          fieldErrors[field.name] = `${field.label} must be a whole number.`
          break
        }
        values[field.name] = parsed
        break
      }

      case 'clock': {
        const parsed = clockToFloat(raw)
        if (parsed === null) {
          fieldErrors[field.name] = `${field.label} must be a time, such as 08:30.`
          break
        }
        values[field.name] = parsed
        break
      }

      default: {
        if (!raw) {
          if (field.required) fieldErrors[field.name] = `${field.label} is required.`
          // An optional text field cleared in the form is false in Odoo, not ''.
          else values[field.name] = false
          break
        }
        values[field.name] = raw
      }
    }
  }

  if (Object.keys(fieldErrors).length > 0) return { fieldErrors }
  return { values }
}

export function createVocabulary(
  spec: VocabularySpec,
  values: Record<string, unknown>,
): Promise<number> {
  return create(spec.model, values)
}

export function updateVocabulary(
  spec: VocabularySpec,
  id: number,
  values: Record<string, unknown>,
): Promise<boolean> {
  return write(spec.model, [id], values)
}
