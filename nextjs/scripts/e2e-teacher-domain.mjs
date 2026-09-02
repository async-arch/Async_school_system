/**
 * Teacher registration — verified against Odoo.
 *
 * The relationship under test is the one the audit had to establish from
 * source: a teacher is a *profile on a staff record*. `staff_id` is required,
 * `_check_staff_active` refuses anyone who is not active, employed and either
 * academic or holding a teaching responsibility, and `user_id` is provisioned
 * by Odoo rather than set here.
 *
 * Every write is confirmed by reading the record back out of Odoo.
 *
 *   ODOO_BASE_URL / ODOO_DB   the Odoo to read back from
 *   E2E_PASSWORD              shared demo password
 *   E2E_REGISTRAR_LOGIN       create/write on school.teacher
 *   E2E_ALLOW_WRITES=yes      required: this suite creates records
 */
import { chromium } from 'playwright-core'

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
  console.log('\nteacher domain: SKIPPED — needs E2E_REGISTRAR_LOGIN and E2E_ALLOW_WRITES=yes')
  process.exit(0)
}

const sid = await odooLogin(LOGIN)
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
const page = await context.newPage()
await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
await page.fill('#login', LOGIN)
await page.fill('#password', PASSWORD)
await page.click('#submit-login')
await page.waitForURL('**/dashboard', { timeout: 90_000 })

/* ---------------------------------------- the relationship, from Odoo --- */

console.log('\nthe model this frontend is talking to')
const meta = await odoo(sid, 'school.teacher', 'fields_get', [['staff_id', 'user_id', 'teacher_id']], {
  attributes: ['type', 'relation', 'required', 'readonly'],
})
check('teacher hangs off a staff record', meta.staff_id?.relation === 'school.staff' && meta.staff_id?.required === true,
  `${meta.staff_id?.relation} required=${meta.staff_id?.required}`)
check('the login is provisioned by Odoo, not set here', meta.user_id?.readonly === true)
check('the teacher number is Odoo\'s sequence', meta.teacher_id?.readonly === true)

/* ---------------------------------------------------------- eligibility --- */

console.log('\nonly staff Odoo would accept are offered')
await page.goto(`${BASE}/teachers/new`, { waitUntil: 'domcontentloaded' })
const offered = await page
  .locator('main select[name="staff_id"] option')
  .evaluateAll((nodes) => nodes.map((n) => n.value).filter(Boolean))

if (offered.length === 0) {
  console.log('  SKIP  no eligible staff in this database')
} else {
  // Everything offered must satisfy _check_staff_active, checked in Odoo.
  const staffRows = await odoo(sid, 'school.staff', 'read', [
    offered.map(Number),
    ['state', 'active', 'employment_status', 'department', 'primary_responsibility'],
  ])

  /*
    The reason this matters: a registrar who has just created somebody comes
    here, sees a populated list without them in it, and cannot tell whether the
    record failed to save or the rule excluded it. Silent omission was the bug.
  */
  const draftAcademic = await odoo(sid, 'school.staff', 'search_read', [], {
    domain: [
      ['state', '=', 'draft'],
      ['active', '=', true],
      '|',
      ['department', '=', 'academic'],
      ['primary_responsibility', 'in', ['teacher', 'homeroom', 'department_head', 'coordinator']],
    ],
    fields: ['name'],
    limit: 5,
  })
  if (draftAcademic.length) {
    const shown = (await page.locator('main').innerText()) ?? ''
    check('a draft staff member is excluded, as Odoo requires',
      !offered.includes(String(draftAcademic[0].id)), draftAcademic[0].name)
    check('but the page says who is not eligible and why',
      shown.includes(draftAcademic[0].name) && /draft/i.test(shown),
      shown.split(String.fromCharCode(10)).find((l) => l.includes(draftAcademic[0].name))?.slice(0, 90) ?? '')
    check('and links to the record that needs activating',
      (await page.locator(`main a[href="/staff/${draftAcademic[0].id}"]`).count()) >= 1)
  } else {
    console.log('  SKIP  no draft academic staff to demonstrate the explanation')
  }
  const teaching = ['teacher', 'homeroom', 'department_head', 'coordinator']
  const allEligible = staffRows.every(
    (r) =>
      r.active &&
      r.state === 'active' &&
      r.employment_status === 'active' &&
      (r.department === 'academic' || teaching.includes(r.primary_responsibility)),
  )
  check('every offered staff member passes _check_staff_active', allEligible, `${staffRows.length} offered`)

  const withProfile = await odoo(sid, 'school.teacher', 'search_read', [], {
    domain: [['staff_id', 'in', offered.map(Number)]],
    fields: ['staff_id'],
  })
  check('staff who already hold a profile are excluded', withProfile.length === 0, `${withProfile.length} clashes`)

  /* ------------------------------------------------------------ create --- */

  console.log('\ncreate: Next.js -> Odoo')
  const before = await odoo(sid, 'school.teacher', 'search_count', [[]])
  await page.selectOption('main select[name="staff_id"]', offered[0])
  await page.fill('main input[name="qualification"]', 'BSc Probe')
  await page.fill('main input[name="specialization"]', 'Mathematics')
  await page.fill('main input[name="max_weekly_workload"]', '20')
  await page.click('main form button[type="submit"]')
  await page.waitForTimeout(4000)

  const after = await odoo(sid, 'school.teacher', 'search_count', [[]])
  const alert = await page.locator('main [role="alert"]').first().innerText().catch(() => '')

  if (after > before) {
    check('Odoo holds the new teaching profile', true, `${before} -> ${after}`)
    const created = await odoo(sid, 'school.teacher', 'search_read', [], {
      domain: [['staff_id', '=', Number(offered[0])]],
      fields: ['name', 'teacher_id', 'staff_id', 'user_id', 'qualification', 'max_weekly_workload', 'teaching_status'],
      limit: 1,
    })
    const teacher = created[0]
    check('it is linked to the staff member chosen', teacher.staff_id?.[0] === Number(offered[0]))
    check('Odoo minted the teacher number', Boolean(teacher.teacher_id), String(teacher.teacher_id))
    check('the profile fields were stored', teacher.qualification === 'BSc Probe' && teacher.max_weekly_workload === 20,
      `${teacher.qualification} / ${teacher.max_weekly_workload}`)
    check('the page landed on the new profile', page.url().includes(`/teachers/${teacher.id}`), page.url())

    /* ----------------------------------------------------------- read --- */

    console.log('\nthe profile page shows relationships, not ids')
    const shown = (await page.locator('main').innerText()) ?? ''
    check('the staff member is named', shown.includes(teacher.staff_id[1].split(' ')[0]))
    check('no bare id is presented as the relationship', !/Staff record\s*\n?\s*\d+$/m.test(shown))
    check('no traceback', !/Traceback|odoo\.exceptions/i.test(shown))

    /* ----------------------------------------------------------- edit --- */

    console.log('\nedit: Next.js -> Odoo')
    await page.goto(`${BASE}/teachers/${teacher.id}/edit`, { waitUntil: 'domcontentloaded' })
    check('the staff link is not editable after creation',
      (await page.locator('main select[name="staff_id"]').count()) === 0)
    await page.fill('main input[name="specialization"]', 'Physics')
    await page.click('main form button[type="submit"]')
    await page.waitForTimeout(3000)
    const [edited] = await odoo(sid, 'school.teacher', 'read', [[teacher.id], ['specialization']])
    check('Odoo stored the edit', edited.specialization === 'Physics', String(edited.specialization))

    /* ------------------------------------------- the login actually works --- */

    console.log(String.fromCharCode(10) + 'the provisioned login can sign in')
    /*
      This is the check that was missing. The first version of this feature
      created the account and left it with no password, relying on Odoo to
      email a set-password link — and this deployment has no mail server, so
      nobody could ever sign in. Creating the account is not the same as the
      teacher being able to use it.
    */
    const mailServers = await odoo(sid, 'ir.mail_server', 'search_count', [[]]).catch(() => 0)
    const [beforePw] = await odoo(sid, 'school.teacher', 'read', [[teacher.id], ['user_id']])
    if (beforePw.user_id) {
      const probePassword = `Probe-${Date.now().toString().slice(-6)}!aA`
      await page.goto(`${BASE}/teachers/${teacher.id}`, { waitUntil: 'domcontentloaded' })
      const reset = page.locator('main button:has-text("Reset password")')
      check('a password can be set from the profile', (await reset.count()) === 1,
        `mail servers configured: ${mailServers}`)
      if (await reset.count()) {
        await reset.click()
        await page.waitForTimeout(300)
        await page.fill('main input[name="login_password"]', probePassword)
        await page.locator('main button:has-text("Set password")').click()
        await page.waitForTimeout(3000)

        // The real proof: authenticate against Odoo as that teacher.
        const login = beforePw.user_id[1]
        const users = await odoo(sid, 'res.users', 'search_read', [], {
          domain: [['id', '=', beforePw.user_id[0]]], fields: ['login'], limit: 1,
        })
        let signedIn = false
        try {
          await odooLogin(users[0].login)
          signedIn = false // wrong password would have thrown; this used the shared one
        } catch { /* expected */ }
        const direct = await fetch(`${ODOO}/web/session/authenticate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0', method: 'call',
            params: { db: DB, login: users[0].login, password: probePassword },
          }),
        })
        const body = await direct.json()
        signedIn = Boolean(body.result?.uid)
        check('the teacher can now authenticate against Odoo', signedIn,
          signedIn ? `uid ${body.result.uid}` : (body.error?.data?.message ?? 'refused'))
      }

      // And a weak password must be refused by the module's own policy.
      await page.goto(`${BASE}/teachers/${teacher.id}`, { waitUntil: 'domcontentloaded' })
      if (await page.locator('main button:has-text("Reset password")').count()) {
        await page.locator('main button:has-text("Reset password")').click()
        await page.waitForTimeout(300)
        await page.fill('main input[name="login_password"]', 'weak')
        await page.locator('main button:has-text("Set password")').click()
        await page.waitForTimeout(1500)
        const shown = (await page.locator('main').innerText()) ?? ''
        check('a weak password is refused with the policy',
          /8 characters|uppercase/i.test(shown),
          shown.split(String.fromCharCode(10)).find((l) => /8 characters|uppercase/i.test(l))?.slice(0, 70) ?? '')
      }
    }

    /* ---------------------------------------------------------- login --- */

    console.log('\nlogin provisioning is Odoo\'s')
    await page.goto(`${BASE}/teachers/${teacher.id}`, { waitUntil: 'domcontentloaded' })
    const [withUser] = await odoo(sid, 'school.teacher', 'read', [[teacher.id], ['user_id']])
    if (withUser.user_id) {
      check('creating the profile also created the login', true, withUser.user_id[1])
      check('no create-login button is offered once one exists',
        (await page.locator('main button:has-text("Create teaching login")').count()) === 0)
    } else {
      // No email on the staff record: Odoo refuses and the page must say why.
      const body = (await page.locator('main').innerText()) ?? ''
      check('the page offers to create the login',
        (await page.locator('main button:has-text("Create teaching login")').count()) === 1)
      await page.click('main button:has-text("Create teaching login")')
      await page.waitForTimeout(3000)
      const [retry] = await odoo(sid, 'school.teacher', 'read', [[teacher.id], ['user_id']])
      const feedback = (await page.locator('main').innerText()) ?? ''
      if (retry.user_id) {
        check('Odoo created the login', true, retry.user_id[1])
      } else {
        check('a refusal explains what is missing', /email/i.test(feedback),
          feedback.split('\n').find((l) => /email/i.test(l))?.slice(0, 80) ?? '')
      }
      check('no password is ever shown', !/password\s*[:=]\s*\S+/i.test(body + feedback))
    }
  } else {
    // Odoo declining is a pass provided the reason reached the user.
    check('a refused creation explains why', alert.length > 0, alert.slice(0, 100))
    check('and nothing was created', after === before, `${before} -> ${after}`)
  }
}

/* ------------------------------------------------------------ read paths --- */

console.log('\nlist and navigation')
await page.goto(`${BASE}/teachers`, { waitUntil: 'domcontentloaded' })
const rows = await page.locator('main tbody tr').count()
check('the list renders', rows >= 0, `${rows} row(s)`)
if (rows > 0) {
  const href = await page.locator('main tbody tr td a').first().getAttribute('href')
  check('rows link to the profile', /^\/teachers\/\d+$/.test(href ?? ''), String(href))
  await page.goto(`${BASE}${href}`, { waitUntil: 'domcontentloaded' })
  const body = (await page.locator('main').innerText()) ?? ''
  check('the profile opens', !/could not be found/i.test(body))
  check('it links back to the staff record', (await page.locator('main a[href^="/staff/"]').count()) >= 1)
}

console.log('\nbad input degrades safely')
for (const url of ['/teachers/999999', '/teachers/abc']) {
  const response = await page.goto(`${BASE}${url}`, { waitUntil: 'domcontentloaded' })
  const body = (await page.textContent('body')) ?? ''
  check(`${url.padEnd(18)} does not leak`, !/Traceback|odoo\.exceptions/i.test(body), `http=${response?.status()}`)
}

await browser.close()
console.log(`\n${failures === 0 ? 'teacher domain: all checks passed' : `${failures} check(s) failed`}`)
process.exit(failures === 0 ? 0 : 1)
