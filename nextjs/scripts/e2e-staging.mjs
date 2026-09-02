/**
 * End-to-end checks against the running app + STAGING Odoo.
 *
 * Drives the system Chrome via playwright-core (no bundled browser download).
 * Deliberately not a unit test: the point is to prove that authorisation
 * survives the whole path — browser → Next.js → Odoo → record rules — using
 * the synthetic staging accounts.
 *
 *   node scripts/e2e-staging.mjs <baseUrl>
 *
 * Credentials come from the environment so none are committed:
 *   E2E_TEACHER_LOGIN / E2E_REGISTRAR_LOGIN / E2E_PASSWORD
 */
import { chromium } from 'playwright-core'

const BASE = process.argv[2] ?? 'http://localhost:3100'
const PASSWORD = process.env.E2E_PASSWORD
const TEACHER = process.env.E2E_TEACHER_LOGIN
const REGISTRAR = process.env.E2E_REGISTRAR_LOGIN

if (!PASSWORD || !TEACHER || !REGISTRAR) {
  console.error('Set E2E_PASSWORD, E2E_TEACHER_LOGIN and E2E_REGISTRAR_LOGIN.')
  process.exit(2)
}

let passed = 0
let failed = 0

function check(name, condition, detail = '') {
  if (condition) {
    passed++
    console.log(`  PASS  ${name}${detail ? ` — ${detail}` : ''}`)
  } else {
    failed++
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

async function signIn(context, login) {
  const page = await context.newPage()
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
  await page.fill('#login', login)
  await page.fill('#password', PASSWORD)
  await Promise.all([
    page.waitForURL('**/dashboard', { timeout: 90_000 }).catch(() => {}),
    page.click('#submit-login'),
  ])
  return page
}

const browser = await chromium.launch({ channel: 'chrome', headless: true })

try {
  /* ---------------------------------------------------- rejected login --- */
  console.log('\n[1] Authentication')
  {
    const context = await browser.newContext()
    const page = await context.newPage()
    await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
    await page.fill('#login', TEACHER)
    await page.fill('#password', 'definitely-the-wrong-password')
    await page.click('#submit-login')
    // Scoped to our own element: Next.js injects its own empty [role=alert].
    await page.waitForSelector('#login-error', { timeout: 60_000 })
    const message = (await page.textContent('#login-error'))?.trim() ?? ''
    check('bad password is rejected', /incorrect/i.test(message), JSON.stringify(message))
    check(
      'rejection leaks no traceback',
      !/Traceback|usr\/lib\/python|odoo\.exceptions/i.test(message),
    )
    check('stays signed out', page.url().includes('/login'))
    await context.close()
  }

  /* ------------------------------------------------------ teacher scope --- */
  console.log('\n[2] Teacher — record-rule scope')
  const teacherContext = await browser.newContext()
  const teacherPage = await signIn(teacherContext, TEACHER)
  check('teacher reaches the dashboard', teacherPage.url().includes('/dashboard'), teacherPage.url())

  const cookies = await teacherContext.cookies()
  const appCookie = cookies.find((c) => c.name === 'school_session')
  check('session cookie exists', Boolean(appCookie))
  check('session cookie is httpOnly', appCookie?.httpOnly === true)
  check('no raw Odoo session_id cookie in the browser', !cookies.some((c) => c.name === 'session_id'))
  const odooIdVisible = await teacherPage.evaluate(() => document.cookie)
  check('cookie is invisible to client JS', !odooIdVisible.includes('school_session'), JSON.stringify(odooIdVisible))

  await teacherPage.goto(`${BASE}/students`, { waitUntil: 'domcontentloaded' })
  const teacherBody = (await teacherPage.textContent('body')) ?? ''
  const teacherRows = await teacherPage.locator('tbody tr').count()
  check('teacher sees a scoped student list', teacherRows > 0, `${teacherRows} row(s)`)
  check('teacher page leaks no traceback', !/Traceback|usr\/lib\/python/i.test(teacherBody))

  /* ---------------------------------------------------- registrar scope --- */
  console.log('\n[3] Registrar — wider scope, and the known-dead mark rule')
  const registrarContext = await browser.newContext()
  const registrarPage = await signIn(registrarContext, REGISTRAR)
  check('registrar reaches the dashboard', registrarPage.url().includes('/dashboard'))

  await registrarPage.goto(`${BASE}/students`, { waitUntil: 'domcontentloaded' })
  const registrarRows = await registrarPage.locator('tbody tr').count()
  check(
    'registrar sees at least as many students as the teacher',
    registrarRows >= teacherRows,
    `registrar ${registrarRows} vs teacher ${teacherRows}`,
  )
  check(
    'record-rule isolation holds (registrar strictly wider)',
    registrarRows > teacherRows,
    `${registrarRows} > ${teacherRows}`,
  )

  // The shell renders a sidebar nav and a mobile nav; read them all.
  const navText = async (page) => (await page.locator('nav').allTextContents()).join(' ')
  const registrarNav = await navText(registrarPage)
  // rule_mark_all_registrar now has its ACL row, so this must be offered.
  check('Marks is offered to registrar (rule_mark_all_registrar repaired)', registrarNav.includes('Marks'))
  const teacherNav = await navText(teacherPage)
  check('Marks is offered to teacher', teacherNav.includes('Marks'))

  /* ------------------------------------------------------------ logout --- */
  console.log('\n[4] Logout')
  // Sign out moved from the sidebar footer into the header account menu.
  await teacherPage.click('header button[aria-haspopup="menu"]')
  await teacherPage.click('[role="menu"] button:has-text("Sign out")')
  await teacherPage.waitForURL('**/login', { timeout: 60_000 }).catch(() => {})
  check('logout returns to /login', teacherPage.url().includes('/login'))
  const afterLogout = await teacherContext.cookies()
  check('session cookie cleared', !afterLogout.some((c) => c.name === 'school_session' && c.value))

  await teacherPage.goto(`${BASE}/dashboard`, { waitUntil: 'domcontentloaded' })
  check('dashboard no longer reachable', teacherPage.url().includes('/login'))

  await teacherContext.close()
  await registrarContext.close()
} finally {
  await browser.close()
}

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed === 0 ? 0 : 1)
