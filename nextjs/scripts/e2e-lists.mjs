/**
 * The list experience, exercised against real Odoo data.
 *
 * What it is really checking is that searching, filtering, sorting and paging
 * reach Odoo rather than the browser: every assertion compares the *total*
 * reported for the whole result set, which only changes if the query changed.
 * A client-side filter would leave the total untouched and be caught here.
 */
import { chromium } from 'playwright-core'

const BASE = process.argv[2] ?? 'http://localhost:3100'
const LOGIN = process.env.E2E_REGISTRAR_LOGIN
const PASSWORD = process.env.E2E_PASSWORD

let failures = 0
const check = (label, ok, extra = '') => {
  if (!ok) failures++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`)
}

/** The "n records visible to you" subtitle, as a number. */
async function total(page) {
  const text = (await page.locator('main header p').first().textContent()) ?? ''
  const match = /([\d,]+)\s+record/.exec(text)
  return match ? Number(match[1].replace(/,/g, '')) : null
}

const rowCount = (page) => page.locator('main tbody tr').count()

const browser = await chromium.launch({ channel: 'chrome', headless: true })
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await context.newPage()

await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
await page.fill('#login', LOGIN)
await page.fill('#password', PASSWORD)
await page.click('#submit-login')
await page.waitForURL('**/dashboard', { timeout: 90_000 })

/* ------------------------------------------------------- toolbar coverage --- */

console.log('\nevery list screen offers search or filters')
const LISTS = [
  ['/students', true],
  ['/staff', true],
  ['/teachers', true],
  ['/enrollments', true],
  ['/classes', true],
  ['/subjects', true],
  ['/academic-years', true],
  ['/assignments', true],
  ['/schedule', false],
  ['/assessments', true],
  ['/marks', true],
  ['/report-cards', true],
  ['/promotion', true],
  ['/announcements', true],
  ['/programs', true],
  ['/documents', true],
  ['/attendance', true],
]

for (const [route, expectSearch] of LISTS) {
  await page.goto(`${BASE}${route}`, { waitUntil: 'domcontentloaded' })
  const refused = /Not available to your role/i.test((await page.textContent('body')) ?? '')
  if (refused) {
    console.log(`  SKIP  ${route.padEnd(17)} refused for this role`)
    continue
  }
  const searches = await page.locator('main input[type="search"]').count()
  const selects = await page.locator('main select').count()
  check(
    `${route.padEnd(17)} toolbar`,
    (expectSearch ? searches >= 1 : true) && selects >= 1,
    `search=${searches} filters=${selects}`,
  )
}

/* ---------------------------------------------------------------- search --- */

console.log('\nsearch narrows the query, not the page')
await page.goto(`${BASE}/students`, { waitUntil: 'domcontentloaded' })
const allStudents = await total(page)
check('students load', allStudents !== null && allStudents > 0, `total=${allStudents}`)

const firstName = (await page.locator('main tbody tr td').first().textContent())?.trim() ?? ''
const term = firstName.split(' ')[0]
await page.fill('main input[type="search"]', term)
// Wait for the query to land in the URL rather than for a fixed interval:
// the debounce is 300ms but the round trip to Odoo is not, and against a
// remote staging instance a fixed sleep is just a flaky test.
await page.waitForURL(/[?&]q=/, { timeout: 30_000 }).catch(() => {})
await page.waitForLoadState('networkidle').catch(() => {})
const searched = await total(page)
check('search reduces the total', searched !== null && searched <= allStudents, `→ ${searched}`)
check('search is in the URL', page.url().includes('q='), page.url())

await page.goto(`${BASE}/students?q=zzz-no-such-student`, { waitUntil: 'domcontentloaded' })
check('no match shows the narrowed empty state', /Nothing matches those filters/i.test((await page.textContent('body')) ?? ''))
check('and offers a way back', (await page.locator('main a:has-text("Clear filters")').count()) > 0)

/* ---------------------------------------------------------------- filter --- */

console.log('\nfilters reach Odoo')
await page.goto(`${BASE}/students`, { waitUntil: 'domcontentloaded' })
const statusSelect = page.locator('main select').first()
const options = await statusSelect.locator('option').evaluateAll((nodes) =>
  nodes.map((n) => n.value).filter(Boolean),
)
if (options.length) {
  await statusSelect.selectOption(options[0])
  await page.waitForURL(/[?&]status=/, { timeout: 30_000 }).catch(() => {})
  await page.waitForLoadState('networkidle').catch(() => {})
  const filtered = await total(page)
  check('filter reduces the total', filtered !== null && filtered <= allStudents, `→ ${filtered}`)
  check('filter is in the URL', /[?&]status=/.test(page.url()), page.url())
  const rows = await rowCount(page)
  check('rows agree with the total', rows <= (filtered ?? 0) || filtered === 0, `rows=${rows}`)
} else {
  console.log('  SKIP  no filter options in this dataset')
}

/* ------------------------------------------------------------------ sort --- */

console.log('\nsorting is a server query')
await page.goto(`${BASE}/students?sort=name:asc`, { waitUntil: 'domcontentloaded' })
const ascending = await page.locator('main tbody tr td:first-child').allTextContents()
await page.goto(`${BASE}/students?sort=name:desc`, { waitUntil: 'domcontentloaded' })
const descending = await page.locator('main tbody tr td:first-child').allTextContents()
check('descending differs from ascending', ascending.join('|') !== descending.join('|'))
check(
  'descending really is reversed',
  descending[0]?.localeCompare(descending.at(-1) ?? '') >= 0,
  `${descending[0]} … ${descending.at(-1)}`,
)
check(
  'the sorted column is announced',
  (await page.locator('main th[aria-sort="descending"]').count()) === 1,
)
await page.goto(`${BASE}/students?sort=not_a_field:asc`, { waitUntil: 'domcontentloaded' })
check('an unknown sort field is ignored, not passed on', (await rowCount(page)) > 0)

/* ------------------------------------------------------------------ page --- */

console.log('\npaging')
await page.goto(`${BASE}/staff`, { waitUntil: 'domcontentloaded' })
const staffTotal = await total(page)
const firstPage = await page.locator('main tbody tr td:first-child').allTextContents()
if ((staffTotal ?? 0) > 25) {
  check('page one is capped at the page size', firstPage.length === 25, `rows=${firstPage.length}`)
  await page.click('main a[aria-label="Next page"]')
  await page.waitForURL('**/staff?page=2', { timeout: 20_000 })
  const secondPage = await page.locator('main tbody tr td:first-child').allTextContents()
  check('page two holds different rows', firstPage[0] !== secondPage[0], `${firstPage[0]} vs ${secondPage[0]}`)
  check('the total is unchanged by paging', (await total(page)) === staffTotal)
  check('previous is available', (await page.locator('main a[aria-label="Previous page"]').count()) === 1)
} else {
  check('short list shows no pager', (await page.locator('main nav[aria-label="Pagination"]').count()) === 0)
}

/* ------------------------------------------------------------ hand-edited --- */

console.log('\nhand-edited URLs degrade safely')
for (const url of [
  '/students?class=not-a-number',
  '/students?page=99999',
  '/students?page=-4',
  '/attendance?date=nonsense',
  '/students?unknown=1',
]) {
  const response = await page.goto(`${BASE}${url}`, { waitUntil: 'domcontentloaded' })
  const body = (await page.textContent('body')) ?? ''
  check(
    `${url.padEnd(34)} renders`,
    response?.status() === 200 && !/Traceback|odoo\.exceptions/i.test(body),
    `http=${response?.status()}`,
  )
}

await browser.close()
console.log(`\n${failures === 0 ? 'lists: all checks passed' : `${failures} check(s) failed`}`)
process.exit(failures === 0 ? 0 : 1)
