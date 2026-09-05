/**
 * Every door the sidebar offers actually opens — checked per role, in a real
 * browser, against real Odoo.
 *
 * `test-navigation-access.mjs` asserts the matrix as data, but it compares the
 * predicates against a table of ACLs written by hand. This closes the loop the
 * only way that cannot go stale: it signs in as each role, reads the links the
 * application itself rendered, and visits every one.
 *
 * A route fails if it answers non-200, leaks a traceback, or renders the
 * page-level permission refusal. A *panel* saying "Not available to your role"
 * is fine and expected — a dashboard spans models one role may not hold, and
 * that is the backend working. Only a whole page refused is a broken promise,
 * because the menu offered it.
 *
 * Read-only: this suite never writes, so it is safe to point at any
 * environment, including a production smoke check.
 *
 *   node scripts/e2e-navigation-access.mjs <baseUrl>
 *
 * Env: E2E_PASSWORD plus whichever of E2E_{ADMIN,DIRECTOR,REGISTRAR,TEACHER,
 * FRONTOFFICE,EXAM,HR}_LOGIN you have. Roles with no login are skipped.
 */
import { chromium } from 'playwright-core'

const BASE = process.argv[2] ?? 'http://localhost:3100'
const PASSWORD = process.env.E2E_PASSWORD

const ROLES = {
  admin: process.env.E2E_ADMIN_LOGIN ?? process.env.E2E_LOGIN,
  director: process.env.E2E_DIRECTOR_LOGIN,
  registrar: process.env.E2E_REGISTRAR_LOGIN,
  teacher: process.env.E2E_TEACHER_LOGIN,
  frontoffice: process.env.E2E_FRONTOFFICE_LOGIN,
  exam: process.env.E2E_EXAM_LOGIN,
  hr: process.env.E2E_HR_LOGIN,
}

/** What the menu is expected to offer, mirroring test-navigation-access.mjs. */
const EXPECTED_COUNT = {
  admin: 23,
  director: 16,
  registrar: 21,
  teacher: 19,
  frontoffice: 6,
  exam: 12,
  hr: 4,
}

const LEAK = /Traceback|\/usr\/lib\/python|psycopg2|odoo\.exceptions|session_id=/i
/* The page-level refusal. The panel-level one carries no such sentence. */
const REFUSED = /You do not have permission to view or change this/i

if (!PASSWORD) {
  console.error('Set E2E_PASSWORD before running this script.')
  process.exit(2)
}

let failures = 0
const check = (label, ok, extra = '') => {
  if (!ok) failures++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`)
}

const browser = await chromium.launch({ channel: 'chrome', headless: true })

for (const [role, login] of Object.entries(ROLES)) {
  if (!login) {
    console.log(`\n${role}: SKIPPED — no login configured`)
    continue
  }

  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await context.newPage()

  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
  await page.fill('#login', login)
  await page.fill('#password', PASSWORD)
  await page.click('#submit-login')
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 90_000 })

  console.log(`\n${role} (${login})`)

  // The landing page is the first thing this role ever sees.
  const landed = new URL(page.url()).pathname
  const landingBody = (await page.textContent('body')) ?? ''
  check(`lands on ${landed} without a refusal`, !REFUSED.test(landingBody))

  // Read the links the application itself drew, not a list restated here.
  const offered = await page
    .locator('aside#primary-navigation nav a[href]')
    .evaluateAll((nodes) => [...new Set(nodes.map((n) => n.getAttribute('href')))])

  const expected = EXPECTED_COUNT[role]
  check(
    `the sidebar offers ${expected} entries`,
    offered.length === expected,
    `got ${offered.length}: ${offered.join(' ')}`,
  )

  for (const href of offered) {
    const response = await page.goto(`${BASE}${href}`, { waitUntil: 'domcontentloaded' })
    // The dashboard streams; wait for the heading rather than the URL.
    await page.locator('main h1').first().waitFor({ timeout: 30_000 }).catch(() => {})
    const body = (await page.textContent('body')) ?? ''
    const status = response?.status() ?? 0

    const leaked = LEAK.test(body)
    const refused = REFUSED.test(body)
    const ok = status === 200 && !leaked && !refused

    check(
      href.padEnd(24),
      ok,
      [
        `http=${status}`,
        refused ? 'REFUSED — offered but not permitted' : '',
        leaked ? 'LEAK!' : '',
      ]
        .filter(Boolean)
        .join(' '),
    )
  }

  await context.close()
}

await browser.close()
console.log(
  failures === 0
    ? '\nnavigation access: ok — every offered route opened'
    : `\nnavigation access: ${failures} FAILED`,
)
process.exit(failures === 0 ? 0 : 1)
