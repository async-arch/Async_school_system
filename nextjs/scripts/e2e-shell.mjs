/**
 * The application shell, exercised in a real browser at two viewports.
 *
 * Covers what unit tests cannot: that the rail is genuinely fixed while the
 * page scrolls, that collapsing it moves the content with it, that the
 * preference survives a navigation, that the mobile drawer is inert while
 * closed, and that Escape and a route change both shut it.
 *
 * Set SHOTS to a directory to also write screenshots of each state.
 */
import { chromium } from 'playwright-core'
import { mkdirSync } from 'node:fs'

const BASE = process.argv[2] ?? 'http://localhost:3100'
const LOGIN = process.env.E2E_REGISTRAR_LOGIN
const PASSWORD = process.env.E2E_PASSWORD
const SHOTS = process.env.SHOTS
if (SHOTS) mkdirSync(SHOTS, { recursive: true })
/** Screenshots are an aid, not an assertion — skipped unless SHOTS is set. */
const capture = (page, name) => (SHOTS ? page.screenshot({ path: `${SHOTS}/${name}.png` }) : Promise.resolve())

let failures = 0
const check = (label, ok, extra = '') => {
  if (!ok) failures++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`)
}

const browser = await chromium.launch({ channel: 'chrome', headless: true })
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await context.newPage()

await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
await page.fill('#login', LOGIN)
await page.fill('#password', PASSWORD)
await page.click('#submit-login')
await page.waitForURL('**/dashboard', { timeout: 90_000 })

console.log('\ndesktop — expanded')
const rail = page.locator('#primary-navigation')
await check('rail visible', await rail.isVisible())
let box = await rail.boundingBox()
check('rail width 244', Math.round(box.width) === 244, `got ${Math.round(box.width)}`)
check('rail is fixed', (await rail.evaluate((el) => getComputedStyle(el).position)) === 'fixed')
check('drawer hidden on desktop', !(await page.locator('#mobile-navigation').isVisible()))
check('groups rendered', (await page.locator('#primary-navigation nav > div').count()) > 3)
check(
  'every link has an icon',
  (await page.locator('#primary-navigation nav a svg').count()) ===
    (await page.locator('#primary-navigation nav a').count()),
)
await capture(page, '01-desktop-expanded')

console.log('\ndesktop — collapse')
await page.click('#primary-navigation button[aria-controls="primary-navigation"]')
await page.waitForTimeout(400)
box = await rail.boundingBox()
check('rail width 64', Math.round(box.width) === 64, `got ${Math.round(box.width)}`)
const main = page.locator('main')
const mainBox = await main.boundingBox()
check('content follows the rail', Math.round(mainBox.x) === 64, `main.x=${Math.round(mainBox.x)}`)
check(
  'labels hidden, names kept for AT',
  (await page.locator('#primary-navigation nav a .sr-only').count()) > 0,
)
await capture(page, '02-desktop-collapsed')

console.log('\ncollapse preference survives navigation')
await page.goto(`${BASE}/students`, { waitUntil: 'domcontentloaded' })
box = await rail.boundingBox()
check('still collapsed after reload', Math.round(box.width) === 64, `got ${Math.round(box.width)}`)
check('active route marked', (await page.locator('#primary-navigation a[aria-current="page"]').count()) === 1)

console.log('\nsidebar stays put while the page scrolls')
await page.evaluate(() => window.scrollTo(0, 400))
await page.waitForTimeout(150)
const afterScroll = await rail.boundingBox()
check('rail y unchanged', Math.round(afterScroll.y) === 0, `y=${Math.round(afterScroll.y)}`)

// Back to expanded for the remaining checks and the screenshots.
await page.click('#primary-navigation button[aria-controls="primary-navigation"]')
await page.waitForTimeout(300)

console.log('\nkeyboard')
await page.goto(`${BASE}/dashboard`, { waitUntil: 'domcontentloaded' })
await page.keyboard.press('Tab')
const firstFocus = await page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? document.activeElement?.textContent?.trim())
check('first tab stop is in the shell', Boolean(firstFocus), `→ ${firstFocus}`)
const focusRing = await page.evaluate(() => getComputedStyle(document.activeElement).outlineWidth)
check('focus is visible', focusRing !== '0px', `outline ${focusRing}`)

console.log('\nsigning out is reachable without hunting for it')
const railSignOut = page.locator('#primary-navigation button:has-text("Sign out")')
check('sidebar offers sign out', (await railSignOut.count()) === 1)
check('and it is visible, not behind a menu', await railSignOut.isVisible())

// Collapsed it becomes icon-only, so the name has to survive for a screen
// reader and for the tooltip: an unlabelled icon is not a way out of an app.
await page.click('#primary-navigation button[aria-controls="primary-navigation"]')
await page.waitForTimeout(400)
check('still there when collapsed', await railSignOut.isVisible())
// The label is not removed when the rail collapses, only taken out of the
// visual flow, so the button is still findable by its accessible name.
const collapsedLabel = await railSignOut.locator('span').boundingBox()
check(
  'label is visually hidden when collapsed',
  (collapsedLabel?.width ?? 99) <= 2 && (collapsedLabel?.height ?? 99) <= 2,
  `${collapsedLabel?.width}x${collapsedLabel?.height}`,
)
check(
  'but keeps its accessible name',
  (await page.getByRole('button', { name: 'Sign out' }).count()) >= 1 &&
    (await railSignOut.getAttribute('title')) === 'Sign out',
)
await page.click('#primary-navigation button[aria-controls="primary-navigation"]')
await page.waitForTimeout(400)

console.log('\naccount menu')
await page.click('header button[aria-haspopup="menu"]')
check('menu opens', await page.locator('[role="menu"]').isVisible())
check('sign out present', await page.locator('[role="menu"] button:has-text("Sign out")').isVisible())
await page.keyboard.press('Escape')
await page.waitForTimeout(150)
check('escape closes it', (await page.locator('[role="menu"]').count()) === 0)

console.log('\nmobile — 390px')
const mobile = await browser.newContext({ viewport: { width: 390, height: 780 }, isMobile: true })
const mp = await mobile.newPage()
await mp.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
await mp.fill('#login', LOGIN)
await mp.fill('#password', PASSWORD)
await mp.click('#submit-login')
await mp.waitForURL('**/dashboard', { timeout: 90_000 })

check('rail hidden', !(await mp.locator('#primary-navigation').isVisible()))
check('drawer closed is inert', await mp.locator('#mobile-navigation').evaluate((el) => el.hasAttribute('inert')))
const overflow = await mp.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)
check('no horizontal overflow', overflow)
await capture(mp, '03-mobile-closed')

await mp.click('header button[aria-label="Open navigation"]')
await mp.waitForTimeout(350)
check('drawer opens', await mp.locator('#mobile-navigation').evaluate((el) => !el.hasAttribute('inert')))
check(
  'drawer offers sign out too',
  await mp.locator('#mobile-navigation button:has-text("Sign out")').isVisible(),
)
check('drawer on screen', Math.round((await mp.locator('#mobile-navigation').boundingBox()).x) === 0)
await capture(mp, '04-mobile-drawer')

await mp.keyboard.press('Escape')
await mp.waitForTimeout(350)
check('escape closes the drawer', await mp.locator('#mobile-navigation').evaluate((el) => el.hasAttribute('inert')))

await mp.click('header button[aria-label="Open navigation"]')
await mp.waitForTimeout(300)
await mp.click('#mobile-navigation a[href="/students"]')
await mp.waitForURL('**/students', { timeout: 30_000 })
await mp.waitForTimeout(350)
check('navigating closes the drawer', await mp.locator('#mobile-navigation').evaluate((el) => el.hasAttribute('inert')))
await capture(mp, '05-mobile-students')

console.log('\nthe sidebar button really signs out')
await page.goto(`${BASE}/dashboard`, { waitUntil: 'domcontentloaded' })
await page.click('#primary-navigation button:has-text("Sign out")')
await page.waitForURL('**/login', { timeout: 60_000 }).catch(() => {})
check('returns to the login form', page.url().includes('/login'), page.url())
check(
  'session cookie cleared',
  !(await context.cookies()).some((c) => c.name === 'school_session' && c.value),
)
await page.goto(`${BASE}/dashboard`, { waitUntil: 'domcontentloaded' })
check('dashboard no longer reachable', page.url().includes('/login'))

await browser.close()
console.log(`\n${failures === 0 ? 'shell: all checks passed' : `${failures} check(s) failed`}`)
process.exit(failures === 0 ? 0 : 1)
