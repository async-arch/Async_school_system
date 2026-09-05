/**
 * What each role is offered, written out in full.
 *
 * Navigation drifted from the backend once already: the menu credited four ACL
 * rows a merge had deleted, so it advertised access nobody had. The reverse
 * then happened after those rows were restored — the backend widened and the
 * menu stayed narrow, hiding seven screens from a Director who could read all
 * of them.
 *
 * Neither drift is visible in a diff of either file alone, so this states the
 * matrix as data. The second table is the measured effective ACL, taken from a
 * running Odoo with implied groups resolved. Changing what a role is offered
 * means changing the first table; if that makes it disagree with the second,
 * the ACL is what needs the edit.
 *
 * Run: node scripts/test-navigation-access.mjs
 */
import assert from 'node:assert/strict'
import { visibleSections, landingPath, primaryRoleLabel } from '../lib/navigation.ts'

const ROLE_FLAGS = {
  admin: 'isAdmin',
  director: 'isDirector',
  registrar: 'isRegistrar',
  teacher: 'isTeacher',
  frontoffice: 'isFrontOffice',
  exam: 'isExamOfficer',
  hr: 'isHr',
}

const NONE = Object.fromEntries(Object.values(ROLE_FLAGS).map((flag) => [flag, false]))
const only = (role) => ({ ...NONE, [ROLE_FLAGS[role]]: true })
const ROLES = Object.keys(ROLE_FLAGS)

const offered = (role) =>
  new Set(visibleSections(only(role)).flatMap((section) => section.items.map((item) => item.href)))

/* ------------------------------------------------- what each role is offered --- */

const EXPECTED = {
  admin: [
    '/dashboard', '/students', '/guardians', '/enrollments', '/staff', '/teachers',
    '/schedule', '/attendance', '/assignments', '/assessments', '/marks',
    '/report-cards', '/promotion', '/documents', '/announcements', '/programs',
    '/classes', '/subjects', '/academic-years', '/configuration', '/rooms',
    '/branches', '/configuration/grading',
  ],
  // Read-only oversight. Everything it is offered, it can read unscoped.
  director: [
    '/dashboard', '/students', '/guardians', '/enrollments', '/staff', '/teachers',
    '/schedule', '/attendance', '/assignments', '/assessments', '/marks',
    '/report-cards', '/announcements', '/programs', '/classes', '/branches',
  ],
  registrar: [
    '/dashboard', '/students', '/guardians', '/enrollments', '/staff', '/teachers',
    '/schedule', '/attendance', '/assignments', '/assessments', '/marks',
    '/report-cards', '/promotion', '/documents', '/announcements', '/programs',
    '/classes', '/subjects', '/academic-years', '/configuration', '/branches',
  ],
  teacher: [
    '/dashboard', '/students', '/guardians', '/enrollments', '/staff', '/teachers',
    '/schedule', '/attendance', '/assignments', '/assessments', '/marks',
    '/promotion', '/announcements', '/programs', '/classes', '/subjects',
    '/academic-years', '/rooms', '/branches',
  ],
  frontoffice: ['/dashboard', '/students', '/guardians', '/staff', '/announcements', '/branches'],
  exam: [
    '/dashboard', '/students', '/enrollments', '/teachers', '/assignments',
    '/assessments', '/marks', '/report-cards', '/classes', '/subjects',
    '/academic-years', '/configuration/grading',
  ],
  hr: ['/dashboard', '/staff', '/documents', '/branches'],
}

for (const role of ROLES) {
  const actual = [...offered(role)].sort()
  const expected = [...EXPECTED[role]].sort()
  assert.deepEqual(actual, expected, `${role} is offered the wrong set of routes`)
}

/* ------------------------------ the routes agree with the effective backend --- */

/*
  Measured against a running Odoo 19 with implied groups resolved — see
  addons/school_management/tests/test_authorization_policy.py, which asserts the
  same matrix from the other side. `-` means the role holds no ACL row at all.
*/
const READABLE = {
  '/students': ['admin', 'director', 'registrar', 'teacher', 'frontoffice', 'exam'],
  '/guardians': ['admin', 'director', 'registrar', 'teacher', 'frontoffice'],
  '/enrollments': ['admin', 'director', 'registrar', 'teacher', 'exam'],
  '/staff': ['admin', 'director', 'registrar', 'teacher', 'frontoffice', 'hr'],
  '/teachers': ['admin', 'director', 'registrar', 'teacher', 'exam'],
  '/schedule': ['admin', 'director', 'registrar', 'teacher'],
  '/attendance': ['admin', 'director', 'registrar', 'teacher'],
  '/assignments': ['admin', 'director', 'registrar', 'teacher', 'exam'],
  '/assessments': ['admin', 'director', 'registrar', 'teacher', 'exam'],
  '/marks': ['admin', 'director', 'registrar', 'teacher', 'exam'],
  '/report-cards': ['admin', 'director', 'registrar', 'teacher', 'exam'],
  '/promotion': ['admin', 'registrar', 'teacher'],
  '/documents': ['admin', 'registrar', 'hr'],
  '/announcements': ['admin', 'director', 'registrar', 'teacher', 'frontoffice'],
  '/programs': ['admin', 'director', 'registrar', 'teacher'],
  '/classes': ['admin', 'director', 'registrar', 'teacher', 'exam'],
  '/subjects': ['admin', 'registrar', 'teacher', 'exam'],
  '/academic-years': ['admin', 'registrar', 'teacher', 'exam'],
  '/rooms': ['admin', 'teacher'],
  '/branches': ['admin', 'director', 'registrar', 'teacher', 'frontoffice', 'hr'],
  '/configuration/grading': ['admin', 'exam'],
  '/configuration': ['admin', 'registrar'],
  '/dashboard': ROLES,
}

// Nobody may be offered a door that opens onto a refusal.
for (const role of ROLES) {
  for (const href of offered(role)) {
    assert.ok(
      READABLE[href]?.includes(role),
      `${role} is offered ${href} but holds no read access to it`,
    )
  }
}

/*
  The one place the menu is deliberately narrower than the ACL.

  A teacher can read school.report.card, but that model carries no record rule,
  so the rows are every report card in the school rather than their own
  classes'. Hiding the link is not what makes that safe — only a record rule
  would — so this asserts the omission is the known one and not a fresh gap.
*/
const KNOWN_NARROWER = new Set(['teacher:/report-cards'])
for (const [href, roles] of Object.entries(READABLE)) {
  for (const role of roles) {
    const key = `${role}:${href}`
    if (KNOWN_NARROWER.has(key)) {
      assert.ok(!offered(role).has(href), `${key} is documented as hidden but is offered`)
      continue
    }
    assert.ok(offered(role).has(href), `${role} can read ${href} but is not offered it`)
  }
}

/* --------------------------------------------- every role lands somewhere real --- */

for (const role of ROLES) {
  const landing = landingPath(only(role))
  const path = landing.split('?')[0]
  assert.ok(
    offered(role).has(path),
    `${role} lands on ${landing}, which its own navigation does not offer`,
  )
  assert.ok(
    READABLE[path]?.includes(role),
    `${role} lands on ${landing}, which it cannot read`,
  )
}

// Somebody with no school group still gets a page rather than a dead end.
assert.equal(landingPath(NONE), '/dashboard')

/* ------------------------------------------------------------- consistency --- */

// A role holding several groups sees at least what each of them sees alone.
for (const high of ROLES) {
  for (const low of ROLES) {
    const both = { ...NONE, [ROLE_FLAGS[high]]: true, [ROLE_FLAGS[low]]: true }
    const combined = new Set(
      visibleSections(both).flatMap((s) => s.items.map((i) => i.href)),
    )
    for (const href of [...offered(high), ...offered(low)]) {
      assert.ok(combined.has(href), `${high}+${low} lost ${href}`)
    }
  }
}

// The administrator implies every other role, so it must be offered everything.
const everything = new Set(Object.keys(READABLE))
for (const href of everything) {
  assert.ok(offered('admin').has(href), `the administrator is not offered ${href}`)
}

// No section survives with nothing in it.
for (const role of ROLES) {
  for (const section of visibleSections(only(role))) {
    assert.ok(section.items.length > 0, `${role} has an empty "${section.title}" section`)
  }
}

// Only presentational fields cross to the client — never a predicate.
for (const section of visibleSections(only('admin'))) {
  for (const item of section.items) {
    assert.deepEqual(
      Object.keys(item).sort().filter((k) => k !== 'description'),
      ['href', 'icon', 'label'],
      'a navigation item is carrying more than its presentation to the client',
    )
  }
}

assert.equal(primaryRoleLabel(only('director')), 'Director')

console.log('navigation-access: ok')
