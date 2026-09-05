import Link from 'next/link'
import { Card, CardHeader, Cell, DataTable, DateText, EmptyState, ErrorState, PageHeader, Row } from '@/components/ui'
import { RowLink } from '@/components/ui/table'
import { formatClock, formatSelection } from '@/lib/format'
import { toOdooError } from '@/lib/odoo/errors'
import { hasAccess } from '@/lib/odoo/client'
import { listAcademicYears } from '@/lib/odoo/models/school'
import { listConfig, listCurriculum, listTerms, type SimpleRow } from '@/lib/odoo/models/operations'
import {
  listSetupClasses,
  listSetupGrades,
  listSetupSections,
  listSetupSubjects,
} from '@/lib/odoo/models/setup'
import { ClassSubjectsForm, GradeSectionsForm, SchoolSetupForm } from './setup-forms'
import { m2oId, m2oLabel, type Many2one } from '@/lib/odoo/types'
import type { Page } from '@/lib/odoo/types'

export const metadata = { title: 'Configuration · Async School' }

/**
 * The academic vocabularies every picker draws on: grades, sections, streams,
 * shifts, campuses, rooms, terms and the class curriculum.
 *
 * Each block degrades on its own — several are readable only by some roles, so
 * one refusal must not take the page down.
 */

function VocabularyCard({
  title,
  hint,
  head,
  rows,
  render,
  manageHref,
}: {
  title: string
  hint?: string
  head: string[]
  rows: Page<SimpleRow> | null
  render: (row: SimpleRow) => React.ReactNode
  /*
    Where this vocabulary can actually be changed. Only the ones with a
    management screen carry it — the rest are still read-only here, and
    offering a link to a page that does not exist would be worse than the
    honest absence of one.
  */
  manageHref?: string
}) {
  return (
    <Card padded={false}>
      <div className="p-6 pb-0">
        <CardHeader
          title={title}
          hint={hint}
          action={
            manageHref && rows !== null ? (
              <Link
                href={manageHref}
                className="shrink-0 text-[12px] text-action-blue hover:underline"
              >
                Manage
              </Link>
            ) : undefined
          }
        />
      </div>
      {rows === null ? (
        <EmptyState title="Not available to your role" />
      ) : rows.rows.length === 0 ? (
        <EmptyState title={`No ${title.toLowerCase()} recorded`} />
      ) : (
        <DataTable columns={head}>
          {rows.rows.map((row) => (
            <Row key={row.id}>{render(row)}</Row>
          ))}
        </DataTable>
      )}
    </Card>
  )
}

/** An unset shift time is 0, which `formatClock` would draw as a real 00:00. */
const time = (value: unknown) =>
  typeof value === 'number' && value > 0 ? formatClock(value) : '—'

export default async function ConfigurationPage() {
  let grades, sections, streams, shifts, campuses, rooms, terms, curriculum
  let setupGrades, setupSections, setupSubjects, setupClasses, setupYears, canSetUp
  try {
    ;[grades, sections, streams, shifts, campuses, rooms, terms, curriculum] = await Promise.all([
      listConfig('grades'),
      listConfig('sections'),
      listConfig('streams'),
      listConfig('shifts'),
      listConfig('campuses'),
      listConfig('rooms'),
      listTerms(),
      listCurriculum(),
    ])
    ;[setupGrades, setupSections, setupSubjects, setupClasses, setupYears, canSetUp] =
      await Promise.all([
        listSetupGrades(),
        listSetupSections(),
        listSetupSubjects(),
        listSetupClasses(),
        listAcademicYears({ limit: 50, order: 'date_start desc' }),
        hasAccess('school.class', 'create'),
      ])
  } catch (cause) {
    return (
      <>
        <PageHeader title="Configuration" />
        <ErrorState {...toOdooError(cause).toClient()} />
      </>
    )
  }

  const currentByClass: Record<number, number[]> = {}
  for (const row of curriculum.rows) {
    const classId = m2oId(row.class_id)
    const subjectId = m2oId(row.subject_id)
    if (classId === null || subjectId === null) continue
    ;(currentByClass[classId] ??= []).push(subjectId)
  }

  const named = (rows: Array<{ id: number; name: string }> | undefined) =>
    (rows ?? []).map((row) => ({ id: row.id, name: row.name }))

  return (
    <>
      <PageHeader
        title="Configuration"
        subtitle="The academic structure every other screen draws on. Odoo owns the constraints between these."
        action={
          <div className="flex flex-wrap items-center gap-2">
            {[
              { href: '/configuration/grading', label: 'Grading schemes' },
              { href: '/configuration/questionnaire', label: 'Questionnaire' },
              { href: '/configuration/document-rules', label: 'Document rules' },
              // Neither is an academic vocabulary, so neither has a card
              // below; both are still configuration a school has to set.
              { href: '/configuration/vocabulary/job-titles', label: 'Job titles' },
              { href: '/configuration/vocabulary/document-types', label: 'Document types' },
            ].map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="rounded-[9999px] border border-silver px-4 py-2 text-[13px] hover:bg-paper"
              >
                {link.label}
              </Link>
            ))}
          </div>
        }
      />

      <div className="space-y-4">
        {canSetUp ? (
          <>
            <Card padded={false}>
              <div className="p-6 pb-4">
                <CardHeader
                  title="Open an academic year"
                  hint="Creates the year, splits it into terms, and builds one class per grade and section."
                />
              </div>
              <SchoolSetupForm grades={named(setupGrades?.rows)} />
            </Card>

            <Card padded={false}>
              <div className="p-6 pb-4">
                <CardHeader
                  title="Add sections to a grade"
                  hint="For a grade that gained a stream or an extra class mid-year."
                />
              </div>
              <GradeSectionsForm
                grades={named(setupGrades?.rows)}
                years={setupYears.rows.map((year) => ({ id: year.id, name: year.name }))}
                sections={named(setupSections?.rows)}
              />
            </Card>

            <Card padded={false}>
              <div className="p-6 pb-4">
                <CardHeader
                  title="Set the subjects a class studies"
                  hint="The curriculum every mark list and report card is generated from."
                />
              </div>
              <ClassSubjectsForm
                classes={(setupClasses?.rows ?? []).map((row) => ({
                  id: row.id,
                  name: `${m2oLabel(row.academic_year_id)} · ${row.name}`,
                }))}
                subjects={named(setupSubjects?.rows)}
                currentByClass={currentByClass}
              />
            </Card>
          </>
        ) : null}

        <Card padded={false}>
          <div className="p-6 pb-0">
            <CardHeader
              title="Terms"
              hint="Each term belongs to one academic year and must fall inside it."
              action={
                <Link
                  href="/configuration/terms"
                  className="shrink-0 text-[12px] text-action-blue hover:underline"
                >
                  Manage
                </Link>
              }
            />
          </div>
          {terms.rows.length === 0 ? (
            <EmptyState title="No terms recorded" />
          ) : (
            <DataTable columns={['Term', 'Academic year', 'Starts', 'Ends', 'Sequence']}>
              {terms.rows.map((row) => (
                <Row key={row.id}>
                  <Cell strong>{row.name}</Cell>
                  <Cell>{m2oLabel(row.academic_year_id)}</Cell>
                  <Cell>{<DateText value={row.date_start} />}</Cell>
                  <Cell>{<DateText value={row.date_end} />}</Cell>
                  <Cell numeric>{row.sequence}</Cell>
                </Row>
              ))}
            </DataTable>
          )}
        </Card>

        <div className="grid gap-4 lg:grid-cols-2">
          <VocabularyCard
            title="Grades"
            manageHref="/configuration/vocabulary/grades"
            hint="Grade 1 to 12, each with a level Odoo uses for the age rule."
            head={['Grade', 'Code', 'Level', 'Active']}
            rows={grades}
            render={(row) => (
              <>
                <Cell strong>{String(row.name)}</Cell>
                <Cell>{String(row.code ?? '—')}</Cell>
                <Cell>{String(row.level ?? '—')}</Cell>
                <Cell>{row.active ? 'Yes' : 'No'}</Cell>
              </>
            )}
          />
          <VocabularyCard
            title="Sections"
            manageHref="/configuration/vocabulary/sections"
            head={['Section', 'Classes', 'Sequence', 'Active']}
            rows={sections}
            render={(row) => (
              <>
                <Cell strong>{String(row.name)}</Cell>
                <Cell numeric>{String(row.class_count ?? 0)}</Cell>
                <Cell numeric>{String(row.sequence ?? '—')}</Cell>
                <Cell>{row.active ? 'Yes' : 'No'}</Cell>
              </>
            )}
          />
          <VocabularyCard
            title="Streams"
            manageHref="/configuration/vocabulary/streams"
            hint="Available to Grades 11 and 12 only — Odoo enforces that."
            head={['Stream', 'Code', 'Active']}
            rows={streams}
            render={(row) => (
              <>
                <Cell strong>{String(row.name)}</Cell>
                <Cell>{String(row.code ?? '—')}</Cell>
                <Cell>{row.active ? 'Yes' : 'No'}</Cell>
              </>
            )}
          />
          <VocabularyCard
            title="Shifts"
            manageHref="/configuration/vocabulary/shifts"
            head={['Shift', 'Code', 'Starts', 'Ends']}
            rows={shifts}
            render={(row) => (
              <>
                <Cell strong>{String(row.name)}</Cell>
                <Cell>{String(row.code ?? '—')}</Cell>
                <Cell numeric>{time(row.time_start)}</Cell>
                <Cell numeric>{time(row.time_end)}</Cell>
              </>
            )}
          />
          <VocabularyCard
            title="Campuses"
            manageHref="/branches"
            head={['Campus', 'Code', 'Active']}
            rows={campuses}
            render={(row) => (
              <>
                <Cell strong>{String(row.name)}</Cell>
                <Cell>{String(row.code ?? '—')}</Cell>
                <Cell>{row.active ? 'Yes' : 'No'}</Cell>
              </>
            )}
          />
          <VocabularyCard
            title="Rooms"
            manageHref="/rooms"
            head={['Room', 'Code', 'Type', 'Capacity']}
            rows={rooms}
            render={(row) => (
              <>
                <Cell strong>{String(row.name)}</Cell>
                <Cell>{String(row.code ?? '—')}</Cell>
                <Cell>{String(row.room_type ?? '—')}</Cell>
                <Cell numeric>{String(row.capacity ?? '—')}</Cell>
              </>
            )}
          />
        </div>

        <Card padded={false}>
          <div className="p-6 pb-0">
            <CardHeader
              title="Curriculum"
              hint="What each class studies. Subject enrolments are derived from these when an enrolment activates."
            />
          </div>
          {curriculum.rows.length === 0 ? (
            <EmptyState title="No curriculum recorded" />
          ) : (
            <DataTable columns={['Class', 'Subject', 'Type', 'Maximum', 'Pass mark', 'Active']}>
              {curriculum.rows.map((row) => (
                <Row key={row.id}>
                  <Cell strong>
                    {/*
                      The row links to the one thing about a curriculum line
                      that is worth changing: what the subject is marked out of
                      and what passes it. Both are what every mark list and
                      report card is generated against.
                    */}
                    <RowLink href={`/curriculum/${row.id}/edit`}>
                      {m2oLabel(row.class_id as Many2one)}
                    </RowLink>
                  </Cell>
                  <Cell>{m2oLabel(row.subject_id as Many2one)}</Cell>
                  <Cell>{formatSelection(row.subject_type)}</Cell>
                  <Cell numeric>{row.maximum_mark}</Cell>
                  <Cell numeric>{row.pass_mark}</Cell>
                  <Cell>{row.active ? 'Yes' : 'No'}</Cell>
                </Row>
              ))}
            </DataTable>
          )}
        </Card>
      </div>
    </>
  )
}
