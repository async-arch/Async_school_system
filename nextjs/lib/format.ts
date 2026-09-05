/**
 * One set of formatting rules for the whole application.
 *
 * Odoo hands back a small number of wire shapes — `YYYY-MM-DD` dates,
 * `YYYY-MM-DD HH:MM:SS` datetimes, floats for clock times, snake_case
 * selection codes — and every screen used to render them slightly
 * differently. These helpers are the single answer to "how is that shown".
 *
 * Formatting is deliberately deterministic and locale-independent. Most of
 * these values are rendered in server components and hydrated in the browser;
 * `toLocaleDateString` would resolve differently on each side and produce a
 * hydration mismatch. Odoo also stores datetimes in UTC, so nothing here
 * shifts a timezone — the value shown is the value stored.
 *
 * Client components import this too, so it must stay free of `server-only`.
 */

import { isoToEthiopianLabel } from '@/lib/ethiopian-date'

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
] as const

/** Odoo returns `false` for an unset field of any type. */
export type OdooValue<T> = T | false | null | undefined

export const DASH = '—'

function isBlank(value: unknown): boolean {
  return value === false || value === null || value === undefined || value === ''
}

/** `2026-09-01` → `1 Sep 2026`. Anything unparseable is returned as-is. */
export function formatDate(value: OdooValue<string>): string {
  if (isBlank(value)) return DASH
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value))
  if (!match) return String(value)
  const [, year, month, day] = match
  const monthName = MONTHS[Number(month) - 1]
  if (!monthName) return String(value)
  return `${Number(day)} ${monthName} ${year}`
}

/** `2026-09-01 14:30:00` → `1 Sep 2026, 14:30`. Stored UTC, shown unshifted. */
export function formatDateTime(value: OdooValue<string>): string {
  if (isBlank(value)) return DASH
  const raw = String(value)
  const time = /[ T](\d{2}):(\d{2})/.exec(raw)
  const date = formatDate(raw)
  if (!time || date === raw) return date
  return `${date}, ${time[1]}:${time[2]}`
}

/** A start/end pair as one phrase, collapsing a same-day range. */
export function formatDateRange(start: OdooValue<string>, end: OdooValue<string>): string {
  if (isBlank(start) && isBlank(end)) return DASH
  if (isBlank(end)) return `From ${formatDate(start)}`
  if (isBlank(start)) return `Until ${formatDate(end)}`
  const from = formatDate(start)
  const to = formatDate(end)
  return from === to ? from : `${from} – ${to}`
}

/** Odoo stores clock times as a float: 8.5 is 08:30. */
export function formatClock(value: OdooValue<number>): string {
  if (typeof value !== 'number' || Number.isNaN(value)) return DASH
  const hours = Math.floor(value)
  const minutes = Math.round((value - hours) * 60)
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
}

export function formatTimeRange(start: OdooValue<number>, end: OdooValue<number>): string {
  if (typeof start !== 'number' && typeof end !== 'number') return DASH
  return `${formatClock(start)}–${formatClock(end)}`
}

/**
 * The inverse of `formatClock`, for a form that writes a clock time back.
 *
 * `<input type="time">` yields "08:30", and Odoo wants 8.5. An empty input is
 * 0 rather than null, because that is the value the shift model's
 * `CHECK(time_end = 0 OR time_end > time_start)` treats as "not set".
 * Anything that is not a well-formed HH:MM is null, so a caller can tell a
 * blank apart from a value it should refuse.
 */
export function clockToFloat(value: string): number | null {
  const trimmed = value.trim()
  if (!trimmed) return 0
  const match = /^(\d{1,2}):(\d{2})$/.exec(trimmed)
  if (!match) return null
  const hours = Number(match[1])
  const minutes = Number(match[2])
  if (hours > 23 || minutes > 59) return null
  return hours + minutes / 60
}

/**
 * A selection code as prose: `pending_verification` → `Pending verification`.
 *
 * Where a screen can afford the round trip it should prefer Odoo's own
 * `fields_get` labels, which are translated. This is the fallback for the many
 * places that read a code alongside other fields and should not pay for a
 * second call.
 */
export function formatSelection(value: OdooValue<string>): string {
  if (isBlank(value)) return DASH
  const words = String(value).replace(/_/g, ' ').trim()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

export function formatPercent(value: OdooValue<number>, digits = 1): string {
  if (typeof value !== 'number' || Number.isNaN(value)) return DASH
  return `${value.toFixed(digits)}%`
}

/** A score against its maximum: `43 / 50`. */
export function formatScore(score: OdooValue<number>, max: OdooValue<number>): string {
  if (typeof score !== 'number') return DASH
  return typeof max === 'number' ? `${trimNumber(score)} / ${trimNumber(max)}` : trimNumber(score)
}

/** Drops a trailing `.0` so whole marks read as whole numbers. */
export function trimNumber(value: OdooValue<number>): string {
  if (typeof value !== 'number' || Number.isNaN(value)) return DASH
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2)))
}

export function formatCount(value: OdooValue<number>): string {
  if (typeof value !== 'number' || Number.isNaN(value)) return DASH
  return value.toLocaleString('en-GB')
}

/** Any Odoo string field, with `false` rendered as an em dash. */
export function formatText(value: OdooValue<string | number>): string {
  return isBlank(value) ? DASH : String(value)
}

/** `n record(s)` — the subtitle every list screen uses. */
export function pluralise(count: number, singular: string, plural = `${singular}s`): string {
  return `${count.toLocaleString('en-GB')} ${count === 1 ? singular : plural}`
}

/** Today in Odoo's date format, for default filter values. */
export function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

/** Odoo's `day_of_week` selection is '0' (Monday) through '6' (Sunday). */
export const WEEKDAY_NAMES = [
  'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday',
] as const

export function weekdayName(code: OdooValue<string | number>): string {
  if (isBlank(code)) return DASH
  return WEEKDAY_NAMES[Number(code)] ?? DASH
}

/** Odoo's weekday code for today, matching `day_of_week`. */
export function todayWeekdayCode(): string {
  // JavaScript weeks start on Sunday; Odoo's selection starts on Monday.
  return String((new Date().getDay() + 6) % 7)
}

/* ------------------------------------------------- Ethiopian calendar --- */

/**
 * The school runs on the Ethiopian calendar, so that is the date a user reads
 * first. Odoo stores and validates Gregorian, and its own backend UI shows
 * Gregorian, so every screen carries the Gregorian date alongside — see
 * `DateText` in `@/components/ui`, which renders the pair.
 *
 * These stay pure string helpers for the places that need a date inside a
 * sentence, a subtitle or a page title.
 */

/** `2026-09-11` → `Meskerem 1, 2019`. Anything unparseable is returned as-is. */
export function formatEthiopianDate(value: OdooValue<string>): string {
  if (isBlank(value)) return DASH
  return isoToEthiopianLabel(String(value)) ?? String(value)
}

/** `2026-09-11 14:30:00` → `Meskerem 1, 2019, 14:30`. Stored UTC, shown unshifted. */
export function formatEthiopianDateTime(value: OdooValue<string>): string {
  if (isBlank(value)) return DASH
  const raw = String(value)
  const date = formatEthiopianDate(raw)
  const time = /[ T](\d{2}):(\d{2})/.exec(raw)
  if (!time || date === raw) return date
  return `${date}, ${time[1]}:${time[2]}`
}

/** Both calendars in one string, for titles and subtitles that cannot nest markup. */
export function formatDualDate(value: OdooValue<string>): string {
  if (isBlank(value)) return DASH
  const ethiopian = formatEthiopianDate(value)
  const gregorian = formatDate(value)
  return ethiopian === gregorian ? gregorian : `${ethiopian} (${gregorian})`
}

export function formatEthiopianDateRange(
  start: OdooValue<string>,
  end: OdooValue<string>,
): string {
  if (isBlank(start) && isBlank(end)) return DASH
  if (isBlank(end)) return `From ${formatEthiopianDate(start)}`
  if (isBlank(start)) return `Until ${formatEthiopianDate(end)}`
  const from = formatEthiopianDate(start)
  const to = formatEthiopianDate(end)
  return from === to ? from : `${from} – ${to}`
}
