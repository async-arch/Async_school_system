/**
 * The teacher dashboard — scoped to the signed-in teacher, verified against Odoo.
 *
 * The claim under test is not "the page renders". It is that what a teacher
 * sees is derived from *their own* Odoo identity and assignments, and that a
 * second teacher signing in sees a different set. A dashboard that showed every
 * class in the school would pass a rendering test and be wrong.
 *
 * Two teachers are compared where two are available, because isolation cannot
 * be demonstrated with one.
 *
 *   ODOO_BASE_URL / ODOO_DB   the Odoo to read back from
 *   E2E_PASSWORD              shared demo password
 *   E2E_TEACHER_LOGIN         a teacher with a staff record
 *   E2E_TEACHER2_LOGIN        a second, differently scoped teacher (optional)
 *   E2E_REGISTRAR_LOGIN       used only to read the school-wide totals
 */
import { chromium } from 'playwright-core'

const BASE = process.argv[2] ?? 'http://localhost:3100'
const ODOO = process.env.ODOO_BASE_URL ?? 'http://localhost:8070'
const DB = process.env.ODOO_DB ?? 'school'
const PASSWORD = process.env.E2E_PASSWORD
const TEACHER = process.env.E2E_TEACHER_LOGIN
const TEACHER2 = process.env.E2E_TEACHER2_LOGIN
const REGISTRAR = process.env.E2E_REGISTRAR_LOGIN

let failures = 0
const check = (label, ok, extra = '') => {
  if (!ok) failures++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`)
}

async function odooLogin(login) {
  const response = await fetch(`${ODOO}/web/session/authenticate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'call', params: { db: DB, login, password: PASSWORD } }),
  })
  const body = await response.json()
  const sid = (response.headers.getSetCookie?.() ?? [])
    .map((c) => /session_id=([^;]+)/.exec(c)?.[1])
    .filter(Boolean)[0]
  if (!sid) throw new Error(`could not authenticate ${login}`)
  return { sid, uid: body.result?.uid }
}

async function odoo(sid, model, method, args = [], kwargs = {}) {
  const response = await fetch(`${ODOO}/web/dataset/call_kw`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: `session_id=${sid}` },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'call', params: { model, method, args, kwargs } }),
  })
  const body = await response.json()
  if (body.error) throw new Error(`${body.error.data?.name}: ${body.error.data?.message}`)
  return body.result
}

if (!TEACHER) {
  console.log('\nteacher dashboard: SKIPPED — needs E2E_TEACHER_LOGIN')
  process.exit(0)
}

const browser = await chromium.launch({ channel: 'chrome', headless: true })

/**
 * Remove the names a teacher is entitled to see, then look for anything else.
 *
 * A plain substring test gives false positives here: this school has a class
 * called "Grade 3" and another called "SRS Demo Grade 3", and the shorter name
 * is contained in the longer one. Stripping what is allowed first means a hit
 * in the remainder is a real leak.
 */
function textWithout(text, allowed) {
  return [...allowed]
    .sort((a, b) => b.length - a.length)
    .reduce((acc, name) => acc.split(name).join(' '), text)
}

/** Sign in through the app and read what the dashboard shows. */
async function dashboardFor(login) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1200 } })
  const page = await context.newPage()
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
  await page.fill('#login', login)
  await page.fill('#password', PASSWORD)
  await page.click('#submit-login')
  await page.waitForURL('**/dashboard', { timeout: 90_000 })
  const text = (await page.locator('main').innerText()) ?? ''
  const chips = await page.locator('main dd span').allTextContents()
  const assignmentRows = await page
    .locator('main table tbody tr')
    .evaluateAll((rows) => rows.map((r) => r.textContent ?? ''))
  return { context, page, text, chips, assignmentRows }
}

/* ------------------------------------------------- identity comes from Odoo --- */

console.log('\nthe dashboard is built from this teacher\'s own Odoo identity')
const { sid } = await odooLogin(TEACHER)
const uid = (await odoo(sid, 'res.users', 'search_read', [], {
  domain: [['login', '=', TEACHER]],
  fields: ['school_teacher_id', 'school_taught_class_ids', 'school_department'],
  limit: 1,
}))[0]
check('Odoo resolves a teaching profile for this login', Boolean(uid.school_teacher_id),
  uid.school_teacher_id ? uid.school_teacher_id[1] : 'none')

const teacherId = uid.school_teacher_id ? uid.school_teacher_id[0] : null
const ownAssignments = teacherId
  ? await odoo(sid, 'school.teacher.assignment', 'search_read', [], {
      domain: [['teacher_id', '=', teacherId], ['state', '=', 'active']],
      fields: ['subject_id', 'class_id', 'term_id'],
    })
  : []

const first = await dashboardFor(TEACHER)
check('the page renders without leaking', !/Traceback|odoo\.exceptions|psycopg2/i.test(first.text))
check('it greets the teacher by role', /Teacher/.test(first.text))

/* -------------------------------------------------------- academic context --- */

const currentYear = await odoo(sid, 'school.academic.year', 'search_read', [], {
  domain: [['is_current', '=', true]],
  fields: ['name'],
  limit: 1,
})
if (currentYear.length) {
  check('the current academic year is shown', first.text.includes(currentYear[0].name),
    currentYear[0].name)
} else {
  console.log('  SKIP  no academic year is flagged current')
}

/* ---------------------------------------------------- assignments and scope --- */

console.log('\nwhat it shows comes from this teacher\'s assignments')
check('an assignments panel is present', /My assignments/.test(first.text))
check('a classes and subjects panel is present', /My classes and subjects/.test(first.text))

if (ownAssignments.length) {
  const subjects = [...new Set(ownAssignments.map((a) => a.subject_id?.[1]).filter(Boolean))]
  const classes = [...new Set(ownAssignments.map((a) => a.class_id?.[1]).filter(Boolean))]
  check('every subject Odoo says they teach is shown',
    subjects.every((name) => first.text.includes(name)), subjects.join(', ') || 'none')
  check('every class Odoo says they teach is shown',
    classes.every((name) => first.text.includes(name)), classes.join(', ') || 'none')

  // The important half: nothing beyond their own scope.
  if (REGISTRAR) {
    const { sid: rsid } = await odooLogin(REGISTRAR)
    const allClasses = await odoo(rsid, 'school.class', 'search_read', [], {
      domain: [['active', '=', true]],
      fields: ['name'],
      limit: 200,
    })
    const foreign = allClasses.map((c) => c.name).filter((name) => !classes.includes(name))
    const remainder = textWithout(first.text, [...classes, ...subjects])
    const leaked = foreign.filter((name) => remainder.includes(name))
    check('no class outside their assignments appears', leaked.length === 0,
      leaked.length ? `leaked: ${leaked.slice(0, 3).join(', ')}` : `${foreign.length} checked`)
  }
} else {
  check('with no assignments it explains rather than showing nothing',
    /No assignments yet|No teaching profile/.test(first.text))
}

/* ------------------------------------------------------------- isolation --- */

if (TEACHER2 && TEACHER2 !== TEACHER) {
  console.log('\ntwo teachers see different dashboards')
  const second = await dashboardFor(TEACHER2)
  const { sid: sid2 } = await odooLogin(TEACHER2)
  const uid2 = (await odoo(sid2, 'res.users', 'search_read', [], {
    domain: [['login', '=', TEACHER2]],
    fields: ['school_teacher_id'],
    limit: 1,
  }))[0]
  const teacher2Id = uid2.school_teacher_id ? uid2.school_teacher_id[0] : null

  check('the second login resolves a different teaching profile',
    teacher2Id !== null && teacher2Id !== teacherId, `${teacherId} vs ${teacher2Id}`)

  if (teacher2Id && teacher2Id !== teacherId) {
    const theirs = await odoo(sid2, 'school.teacher.assignment', 'search_read', [], {
      domain: [['teacher_id', '=', teacher2Id], ['state', '=', 'active']],
      fields: ['class_id'],
    })
    const theirClasses = [...new Set(theirs.map((a) => a.class_id?.[1]).filter(Boolean))]
    const myClasses = [...new Set(ownAssignments.map((a) => a.class_id?.[1]).filter(Boolean))]
    const onlyTheirs = theirClasses.filter((c) => !myClasses.includes(c))

    if (onlyTheirs.length) {
      const remainder = textWithout(first.text, myClasses)
      const leaked = onlyTheirs.filter((name) => remainder.includes(name))
      check("the first teacher cannot see the second's classes", leaked.length === 0,
        leaked.length ? `leaked: ${leaked.join(', ')}` : `${onlyTheirs.length} checked`)
    } else {
      console.log('  SKIP  the two teachers share every class')
    }
    check('the two dashboards differ', first.text !== second.text)
  }
  await second.context.close()
} else {
  console.log('\n  SKIP  isolation needs E2E_TEACHER2_LOGIN')
}

/* ------------------------------------------------------------ navigation --- */

console.log('\nnavigation matches what Odoo allows')
const navLinks = await first.page.locator('#primary-navigation nav a').evaluateAll((links) =>
  links.map((l) => l.getAttribute('href')),
)
check('the teacher gets a scoped menu, not everything',
  navLinks.length > 0 && !navLinks.includes('/configuration'),
  `${navLinks.length} items`)

// Anything offered must actually open for this role.
let broken = []
for (const href of navLinks.slice(0, 20)) {
  const response = await first.page.goto(`${BASE}${href}`, { waitUntil: 'domcontentloaded' })
  const body = (await first.page.textContent('body')) ?? ''
  if ((response?.status() ?? 0) !== 200 || /Traceback|odoo\.exceptions/i.test(body)) {
    broken.push(`${href} (${response?.status()})`)
  }
}
check('every menu item the teacher is offered opens', broken.length === 0, broken.join(', '))

await first.context.close()
await browser.close()
console.log(`\n${failures === 0 ? 'teacher dashboard: all checks passed' : `${failures} check(s) failed`}`)
process.exit(failures === 0 ? 0 : 1)
