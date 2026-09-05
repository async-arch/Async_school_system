/**
 * Terms and the academic vocabularies — verified against Odoo, not the page.
 *
 * These two screens exist because the models behind them were listed on
 * /configuration and creatable nowhere. `school.term` was the consequential
 * one: assessments, marks, report cards and teaching assignments are all filed
 * under a term, so on a fresh database the whole assessment half of the
 * product was unreachable.
 *
 * Every assertion reads the record back out of Odoo. The one that matters most
 * is the shift clock: Odoo stores 08:30 as the float 8.5, the form speaks
 * HH:MM, and a wrong conversion does not fail loudly — it silently moves a
 * shift by half an hour.
 *
 *   ODOO_BASE_URL / ODOO_DB   the Odoo to read back from
 *   E2E_PASSWORD              shared demo password
 *   E2E_REGISTRAR_LOGIN       a user with create/write on terms and vocabularies
 *   E2E_EXAM_LOGIN            optional: a read-only role, to check the disabled form
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
  console.log('\nacademic configuration: SKIPPED — needs E2E_REGISTRAR_LOGIN and E2E_ALLOW_WRITES=yes')
  process.exit(0)
}

// Write intent is not permission: the destination has to be a safe one too.
assertWritable(ODOO, 'the academic configuration suite')

const sid = await odooLogin(LOGIN)
const stamp = Date.now().toString().slice(-6)
const cleanup = []

/*
  Archive rather than delete. The Registrar holds create and write on these
  models and deliberately not unlink — Odoo refuses a delete that would orphan
  the records already pointing at a term or a section, and archiving is the
  retirement path the screens themselves teach. Running this suite as an
  administrator would hide that, so it cleans up the way its own user can.
*/
const archive = (model, id) => odoo(sid, model, 'write', [[id], { active: false }])

const browser = await chromium.launch({ channel: 'chrome', headless: true })
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await context.newPage()

await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
await page.fill('#login', LOGIN)
await page.fill('#password', PASSWORD)
await page.click('#submit-login')
await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 90_000 })

/* ------------------------------------------------------------------ terms --- */

console.log('\nterms: a term can be created at all')

const [year] = await odoo(sid, 'school.academic.year', 'search_read', [], {
  domain: [['state', 'in', ['draft', 'open']]],
  fields: ['name', 'date_start', 'date_end'],
  limit: 1,
  order: 'date_start desc',
})
check('an academic year exists to put a term in', Boolean(year), year?.name ?? '')

if (year) {
  const termName = `E2E Term ${stamp}`
  await page.goto(`${BASE}/configuration/terms`, { waitUntil: 'domcontentloaded' })

  await page.fill('#new-name', termName)
  await page.selectOption('#new-year', String(year.id))
  await page.fill('#new-start', year.date_start)
  await page.fill('#new-end', year.date_end)
  await page.click('button:has-text("Add term")')
  await page.waitForTimeout(1500)

  const [created] = await odoo(sid, 'school.term', 'search_read', [], {
    domain: [['name', '=', termName]],
    fields: ['name', 'academic_year_id', 'date_start', 'date_end', 'sequence', 'active'],
  })
  check('Odoo holds the term the form submitted', Boolean(created), termName)

  if (created) {
    cleanup.push(() => archive('school.term', created.id))
    check('it belongs to the year that was chosen', created.academic_year_id?.[0] === year.id)
    check('its start date is stored exactly as entered', created.date_start === year.date_start,
      `${created.date_start} vs ${year.date_start}`)
    check('its end date is stored exactly as entered', created.date_end === year.date_end,
      `${created.date_end} vs ${year.date_end}`)
    check('it is active', created.active === true)

    // The term is now usable as the input to the next stage.
    const usable = await odoo(sid, 'school.term', 'search_count', [
      [['id', '=', created.id], ['academic_year_id', '=', year.id]],
    ])
    check('an assessment could be filed under it', usable === 1)

    console.log('\nterms: an edit reaches Odoo')
    const renamed = `${termName} renamed`
    await page.goto(`${BASE}/configuration/terms`, { waitUntil: 'domcontentloaded' })
    const row = page.locator('tbody tr', { has: page.locator(`input[value="${termName}"]`) })
    await row.locator('input[name="name"]').fill(renamed)
    await row.locator('button:has-text("Save")').click()
    await page.waitForTimeout(1500)

    const [after] = await odoo(sid, 'school.term', 'read', [[created.id], ['name']])
    check('the rename persisted', after?.name === renamed, after?.name ?? '')
  }

  console.log("\nterms: Odoo's own constraint is surfaced, not swallowed")
  const outside = new Date(year.date_end)
  outside.setFullYear(outside.getFullYear() + 2)
  const outsideIso = outside.toISOString().slice(0, 10)

  await page.goto(`${BASE}/configuration/terms`, { waitUntil: 'domcontentloaded' })
  await page.fill('#new-name', `E2E Invalid ${stamp}`)
  await page.selectOption('#new-year', String(year.id))
  await page.fill('#new-start', year.date_start)
  await page.fill('#new-end', outsideIso)
  await page.click('button:has-text("Add term")')
  await page.waitForTimeout(1500)

  const shown = (await page.locator('main').textContent()) ?? ''
  check('the out-of-year term was refused', /cannot end after its academic year/i.test(shown))
  check('no traceback reached the browser', !/Traceback|odoo\.exceptions/i.test(shown))

  const leaked = await odoo(sid, 'school.term', 'search_count', [
    [['name', '=', `E2E Invalid ${stamp}`]],
  ])
  check('and nothing was written', leaked === 0)
}

/* ----------------------------------------------------------- vocabularies --- */

console.log('\nvocabularies: a section can be added')

const sectionName = `E2E-${stamp}`
await page.goto(`${BASE}/configuration/vocabulary/sections`, { waitUntil: 'domcontentloaded' })
await page.fill('#new-name', sectionName)
await page.click('button:has-text("Add section")')
await page.waitForTimeout(1500)

const [section] = await odoo(sid, 'school.section', 'search_read', [], {
  domain: [['name', '=', sectionName]],
  fields: ['name', 'sequence', 'active'],
  context: { active_test: false },
})
check('Odoo holds the section', Boolean(section), sectionName)
if (section) {
  cleanup.push(() => archive('school.section', section.id))
  check('it is active', section.active === true)
}

console.log('\nvocabularies: a clock time survives the round trip as a float')

const shiftName = `E2E Shift ${stamp}`
await page.goto(`${BASE}/configuration/vocabulary/shifts`, { waitUntil: 'domcontentloaded' })
await page.fill('#new-name', shiftName)
await page.fill('#new-code', `E2E${stamp}`)
await page.fill('#new-time_start', '08:30')
await page.fill('#new-time_end', '12:45')
await page.click('button:has-text("Add shift")')
await page.waitForTimeout(1500)

const [shift] = await odoo(sid, 'school.shift', 'search_read', [], {
  domain: [['name', '=', shiftName]],
  fields: ['name', 'code', 'time_start', 'time_end'],
  context: { active_test: false },
})
check('Odoo holds the shift', Boolean(shift), shiftName)
if (shift) {
  cleanup.push(() => archive('school.shift', shift.id))
  // 08:30 is 8.5 and 12:45 is 12.75. This is the assertion the screen exists for.
  check('08:30 was stored as 8.5', Math.abs(shift.time_start - 8.5) < 1e-9, String(shift.time_start))
  check('12:45 was stored as 12.75', Math.abs(shift.time_end - 12.75) < 1e-9, String(shift.time_end))

  // And it comes back to the form as the same wall-clock time.
  await page.goto(`${BASE}/configuration/vocabulary/shifts`, { waitUntil: 'domcontentloaded' })
  const shiftRow = page.locator('tbody tr', { has: page.locator(`input[value="${shiftName}"]`) })
  check(
    'the form redraws it as 08:30',
    (await shiftRow.locator('input[name="time_start"]').inputValue()) === '08:30',
  )
}

console.log("\nvocabularies: Odoo's uniqueness rule is surfaced")

await page.goto(`${BASE}/configuration/vocabulary/streams`, { waitUntil: 'domcontentloaded' })
const [existingStream] = await odoo(sid, 'school.stream', 'search_read', [], {
  fields: ['code'],
  limit: 1,
})
if (existingStream) {
  await page.fill('#new-name', `E2E Duplicate ${stamp}`)
  await page.fill('#new-code', existingStream.code)
  await page.click('button:has-text("Add stream")')
  await page.waitForTimeout(1500)
  const streamShown = (await page.locator('main').textContent()) ?? ''
  check('the duplicate code was refused', /unique/i.test(streamShown))
  check('no traceback reached the browser', !/Traceback|odoo\.exceptions/i.test(streamShown))
}

/* -------------------------------------------------------------- read-only --- */

/*
  A role that may read these models but not write them must get the list with
  its inputs disabled and no add form — not a form that submits into a 403.
  The Exam Officer holds read on school.term and school.section and write on
  neither, which makes it the honest case to check.
*/
const EXAM_LOGIN = process.env.E2E_EXAM_LOGIN
if (EXAM_LOGIN) {
  console.log('\na read-only role is not offered a form it cannot submit')
  const readerContext = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const reader = await readerContext.newPage()
  await reader.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
  await reader.fill('#login', EXAM_LOGIN)
  await reader.fill('#password', PASSWORD)
  await reader.click('#submit-login')
  await reader.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 90_000 })

  await reader.goto(`${BASE}/configuration/vocabulary/sections`, { waitUntil: 'domcontentloaded' })
  check(
    'the add form is absent',
    (await reader.locator('button:has-text("Add section")').count()) === 0,
  )
  check('the save buttons are absent', (await reader.locator('button:has-text("Save")').count()) === 0)
  const firstInput = reader.locator('tbody input[name="name"]').first()
  if ((await firstInput.count()) > 0) {
    check('the existing rows are disabled', await firstInput.isDisabled())
  }
  const readerShown = (await reader.locator('main').textContent()) ?? ''
  check('and the screen says why', /may read this list but not change it/i.test(readerShown))

  await readerContext.close()
} else {
  console.log('\nread-only role: SKIPPED — set E2E_EXAM_LOGIN to check it')
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
console.log(failures === 0 ? '\nacademic configuration: ok' : `\nacademic configuration: ${failures} FAILED`)
process.exit(failures === 0 ? 0 : 1)
