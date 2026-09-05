/**
 * Authoring one timetable slot — verified against Odoo, not the page.
 *
 * The day builder could create a whole day and nothing could then touch it: a
 * slot had no edit path, `action_reset_draft` was reachable from nowhere, and
 * the `rescheduled` state — which Odoo will not accept without a reason — could
 * not be entered at all. A cancelled period was a dead end.
 *
 * What this holds:
 *   - a Registrar can create a single period, and Odoo stores it against the
 *     exact assignment, with the class, subject, term and teacher derived from
 *     that record rather than trusted from the browser
 *   - editing writes the scheduling facts through
 *   - moving a published lesson records the reason and the `rescheduled` state
 *     in one write, which is the only way Odoo accepts it
 *   - Odoo's double-booking refusal reaches the user in its own words, and
 *     nothing is written when it does
 *   - a read-only role is offered no edit form
 *
 *   ODOO_BASE_URL / ODOO_DB   the Odoo to read back from
 *   E2E_PASSWORD              shared demo password
 *   E2E_REGISTRAR_LOGIN       a user with create/write on school.class.schedule
 *   E2E_TEACHER_LOGIN         optional: a read-only role, to check the refusal
 *   E2E_ALLOW_WRITES=yes      required: this suite creates records
 */
import { chromium } from 'playwright-core'
import { assertWritable, isMutatingMethod } from './production-guard.mjs'

const BASE = process.argv[2] ?? 'http://localhost:3100'
const ODOO = process.env.ODOO_BASE_URL ?? 'http://localhost:8070'
const DB = process.env.ODOO_DB ?? 'school'
const PASSWORD = process.env.E2E_PASSWORD
const LOGIN = process.env.E2E_REGISTRAR_LOGIN

let failures = 0
const check = (label, ok, extra = '') => {
  if (!ok) failures++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`)
}

async function odoo(sid, model, method, args = [], kwargs = {}) {
  if (isMutatingMethod(method)) assertWritable(ODOO, `${model}.${method}()`)
  const response = await fetch(`${ODOO}/web/dataset/call_kw`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: `session_id=${sid}` },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'call', params: { model, method, args, kwargs } }),
  })
  const body = await response.json()
  if (body.error) throw new Error(`${body.error.data?.name}: ${body.error.data?.message}`)
  return body.result
}

async function odooLogin(login) {
  const response = await fetch(`${ODOO}/web/session/authenticate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'call', params: { db: DB, login, password: PASSWORD } }),
  })
  const sid = (response.headers.getSetCookie?.() ?? [])
    .map((c) => /session_id=([^;]+)/.exec(c)?.[1])
    .filter(Boolean)[0]
  if (!sid) throw new Error('could not authenticate against Odoo')
  return sid
}

if (!LOGIN || process.env.E2E_ALLOW_WRITES !== 'yes') {
  console.log('\ntimetable authoring: SKIPPED — needs E2E_REGISTRAR_LOGIN and E2E_ALLOW_WRITES=yes')
  process.exit(0)
}

// Write intent is not permission: the destination has to be a safe one too.
assertWritable(ODOO, 'the timetable authoring suite')

const sid = await odooLogin(LOGIN)
const STAMP = Date.now().toString().slice(-6)
const MARKER = 'E2E-timetable'
const cleanup = []
/*
  Cancel rather than delete. The Registrar holds create and write on
  school.class.schedule and Odoo keeps timetable history; a cancelled slot
  releases its teacher, class and room, which is the retirement path the screen
  itself teaches.
*/
const retire = (id) => odoo(sid, 'school.class.schedule', 'action_cancel', [[id]])

/*
  Cancel anything an earlier run left behind before starting.

  A slot in any state but `cancelled` still holds its teacher, class and room,
  so a leftover from a previous run is a real double booking and Odoo is right
  to refuse the next one. Without this the suite passes once and then fails on
  every rerun, which reads as a product bug and is not one.
*/
const stale = await odoo(sid, 'school.class.schedule', 'search', [
  [['notes', 'like', MARKER], ['state', '!=', 'cancelled']],
])
if (stale.length) {
  await odoo(sid, 'school.class.schedule', 'action_cancel', [stale])
  console.log(`
cleared ${stale.length} slot(s) left by an earlier run`)
}

const browser = await chromium.launch({ channel: 'chrome', headless: true })
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await context.newPage()

await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
await page.fill('#login', LOGIN)
await page.fill('#password', PASSWORD)
await page.click('#submit-login')
await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 90_000 })

/* ----------------------------------------------------------------- create --- */

console.log('\na single period can be created at all')

const assignments = await odoo(sid, 'school.teacher.assignment', 'search_read', [], {
  domain: [['state', '=', 'active'], ['active', '=', true]],
  fields: ['class_id', 'subject_id', 'term_id', 'teacher_id'],
  limit: 1,
})
const assignment = assignments[0]
check('an active teacher assignment exists to build on', Boolean(assignment))

let slotId = null
if (assignment) {
  await page.goto(`${BASE}/schedule/new`, { waitUntil: 'domcontentloaded' })
  await page.selectOption('#assignmentId', String(assignment.id))
  await page.selectOption('#dayOfWeek', '5') // Saturday — the seed data leaves it clear
  await page.fill('#startTime', '15:30')
  await page.fill('#endTime', '16:15')
  await page.selectOption('#scheduleType', 'makeup')
  await page.fill('#notes', `${MARKER} makeup ${STAMP}`)
  await page.click('button:has-text("Create period")')
  await page.waitForURL(/\/schedule\/\d+$/, { timeout: 30_000 }).catch(() => {})

  const created = await odoo(sid, 'school.class.schedule', 'search_read', [], {
    domain: [['notes', '=', `${MARKER} makeup ${STAMP}`]],
    fields: [
      'class_id', 'subject_id', 'term_id', 'teacher_id', 'teacher_assignment_id',
      'academic_year_id', 'day_of_week', 'start_time', 'end_time', 'schedule_type', 'state',
    ],
  })
  const slot = created[0]
  check('Odoo holds the period the form submitted', Boolean(slot))

  if (slot) {
    slotId = slot.id
    cleanup.push(() => retire(slot.id))

    // The five fields derived from the assignment, not trusted from the browser.
    check('it names the exact assignment', slot.teacher_assignment_id?.[0] === assignment.id)
    check('its class came from the assignment', slot.class_id?.[0] === assignment.class_id?.[0])
    check('its subject came from the assignment', slot.subject_id?.[0] === assignment.subject_id?.[0])
    check('its term came from the assignment', slot.term_id?.[0] === assignment.term_id?.[0])
    check('its teacher came from the assignment', slot.teacher_id?.[0] === assignment.teacher_id?.[0])
    check('Odoo resolved the academic year itself', Boolean(slot.academic_year_id))

    // 15:30 is 15.5 and 16:15 is 16.25.
    check('15:30 was stored as 15.5', Math.abs(slot.start_time - 15.5) < 1e-9, String(slot.start_time))
    check('16:15 was stored as 16.25', Math.abs(slot.end_time - 16.25) < 1e-9, String(slot.end_time))
    check('the day is Saturday', String(slot.day_of_week) === '5')
    check('the type is makeup', slot.schedule_type === 'makeup')
    check('it starts in draft', slot.state === 'draft')
  }
}

/* ------------------------------------------------------------------- edit --- */

if (slotId) {
  console.log('\nan edit reaches Odoo')
  await page.goto(`${BASE}/schedule/${slotId}/edit`, { waitUntil: 'domcontentloaded' })
  await page.fill('#endTime', '16:30')
  await page.click('button:has-text("Save changes")')
  await page.waitForURL(/\/schedule\/\d+$/, { timeout: 30_000 }).catch(() => {})

  const [edited] = await odoo(sid, 'school.class.schedule', 'read', [[slotId], ['end_time', 'state']])
  check('the new end time persisted', Math.abs(edited.end_time - 16.5) < 1e-9, String(edited.end_time))
  check('a draft slot did not become rescheduled', edited.state === 'draft')

  console.log('\nthe assignment cannot be changed from the edit form')
  await page.goto(`${BASE}/schedule/${slotId}/edit`, { waitUntil: 'domcontentloaded' })
  check(
    'the assignment field is disabled',
    await page.locator('#assignmentId').isDisabled(),
  )
}

/* ------------------------------------------------------------- reschedule --- */

if (slotId) {
  console.log('\nmoving a published lesson requires a reason, and records it')
  await odoo(sid, 'school.class.schedule', 'action_publish', [[slotId]])

  // Moving it with no reason must be refused before anything is written.
  await page.goto(`${BASE}/schedule/${slotId}/edit`, { waitUntil: 'domcontentloaded' })
  await page.selectOption('#dayOfWeek', '6')
  await page.click('button:has-text("Save changes")')
  await page.waitForTimeout(1200)

  const [untouched] = await odoo(sid, 'school.class.schedule', 'read', [[slotId], ['day_of_week', 'state']])
  check('the move without a reason was refused', String(untouched.day_of_week) === '5')
  check('and the slot is still published', untouched.state === 'published')
  const refusal = (await page.locator('main').textContent()) ?? ''
  check('the form said why', /Say why this lesson is moving/i.test(refusal))

  /*
    The refusal must not have thrown away the change that caused it.

    This caught a real defect. React 19 resets a form once its action returns,
    including on a validation error, so the day snapped back to the stored one
    while the "give a reason" message stayed on screen. Supplying the reason
    would then have saved the *original* day, with nothing to say the move had
    been dropped.
  */
  check(
    'the refused move is still in the form',
    (await page.locator('#dayOfWeek').inputValue()) === '6',
  )
  check(
    'and so are the other fields',
    (await page.locator('#endTime').inputValue()) === '16:30',
  )

  // With a reason it goes through, in one write.
  await page.fill('#rescheduleReason', 'Hall booked for an assembly.')
  await page.click('button:has-text("Save changes")')
  await page.waitForURL(/\/schedule\/\d+$/, { timeout: 30_000 }).catch(() => {})

  const [moved] = await odoo(sid, 'school.class.schedule', 'read', [
    [slotId], ['day_of_week', 'state', 'reschedule_reason'],
  ])
  check('the lesson moved to Sunday', String(moved.day_of_week) === '6')
  check('Odoo recorded the rescheduled state', moved.state === 'rescheduled')
  check('and kept the reason', /assembly/i.test(String(moved.reschedule_reason || '')))
}

/* ------------------------------------------- Odoo refuses a double booking --- */

if (slotId && assignment) {
  console.log("\nOdoo's double-booking refusal reaches the user")
  const before = await odoo(sid, 'school.class.schedule', 'search_count', [[]])

  // Publish the moved slot so it holds its resources again, then clash with it.
  await odoo(sid, 'school.class.schedule', 'action_publish', [[slotId]])

  await page.goto(`${BASE}/schedule/new`, { waitUntil: 'domcontentloaded' })
  await page.selectOption('#assignmentId', String(assignment.id))
  await page.selectOption('#dayOfWeek', '6')
  await page.fill('#startTime', '15:45')
  await page.fill('#endTime', '16:15')
  await page.fill('#notes', `${MARKER} clash ${STAMP}`)
  await page.click('button:has-text("Create period")')
  await page.waitForTimeout(1500)

  const shown = (await page.locator('main').textContent()) ?? ''
  check('the clash was refused', /already booked at this time/i.test(shown))
  check('no traceback reached the browser', !/Traceback|odoo\.exceptions/i.test(shown))

  const after = await odoo(sid, 'school.class.schedule', 'search_count', [[]])
  check('and nothing was written', after === before, `${before} -> ${after}`)

  // If it was wrongly allowed, do not leave it behind to break the next run.
  const leaked = await odoo(sid, 'school.class.schedule', 'search', [
    [['notes', '=', `${MARKER} clash ${STAMP}`]],
  ])
  for (const id of leaked) cleanup.push(() => retire(id))
}

/* ------------------------------------------------------ reset to draft --- */

if (slotId) {
  console.log('\na cancelled slot is no longer a dead end')
  await odoo(sid, 'school.class.schedule', 'action_cancel', [[slotId]])

  await page.goto(`${BASE}/schedule/${slotId}`, { waitUntil: 'domcontentloaded' })
  const reset = page.locator('button:has-text("Return to draft")')
  check('the detail page offers a way back', (await reset.count()) > 0)

  if ((await reset.count()) > 0) {
    await reset.first().click()
    // The transition asks for confirmation before it runs.
    const confirm = page.locator('button:has-text("Confirm")')
    if ((await confirm.count()) > 0) await confirm.first().click()
    await page.waitForTimeout(1500)

    const [back] = await odoo(sid, 'school.class.schedule', 'read', [[slotId], ['state']])
    check('and Odoo took it back to draft', back.state === 'draft', String(back.state))
  }
}

/* ------------------------------------------------------------- read-only --- */

const TEACHER = process.env.E2E_TEACHER_LOGIN
if (TEACHER && slotId) {
  console.log('\na read-only role is offered no edit form')
  const readerContext = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const reader = await readerContext.newPage()
  await reader.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
  await reader.fill('#login', TEACHER)
  await reader.fill('#password', PASSWORD)
  await reader.click('#submit-login')
  await reader.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 90_000 })

  await reader.goto(`${BASE}/schedule/${slotId}/edit`, { waitUntil: 'domcontentloaded' })
  const readerShown = (await reader.locator('main').textContent()) ?? ''
  check(
    'the edit route explains the refusal rather than rendering a form',
    /Not available to your role/i.test(readerShown) ||
      /You do not have permission/i.test(readerShown),
  )
  check('and offers no save button', (await reader.locator('button:has-text("Save")').count()) === 0)
  await readerContext.close()
} else {
  console.log('\nread-only role: SKIPPED — set E2E_TEACHER_LOGIN to check it')
}

/* ---------------------------------------------------------------- cleanup --- */

console.log('\ncleanup')
for (const undo of cleanup.reverse()) {
  try {
    await undo()
  } catch (error) {
    console.log(`  note: cleanup step failed — ${error.message}`)
  }
}

await browser.close()
console.log(failures === 0 ? '\ntimetable authoring: ok' : `\ntimetable authoring: ${failures} FAILED`)
process.exit(failures === 0 ? 0 : 1)
