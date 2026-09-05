/**
 * Turning a submitted form into Odoo values, without Odoo.
 *
 * Two things here have bitten this project before and are worth pinning down.
 *
 * A clock time is a float in Odoo — 8.5 is 08:30 — and `<input type="time">`
 * speaks HH:MM. A wrong conversion does not fail loudly; it silently moves a
 * shift by half an hour.
 *
 * An unchecked checkbox submits nothing at all. If the collector treated a
 * missing key as false it would clear flags nobody touched, and if it skipped
 * the field entirely on an edit it could never be cleared. The rule is that a
 * boolean is written only when the form actually rendered it, which is what
 * the paired hidden input guarantees.
 *
 * Run: node scripts/test-vocabulary-values.mjs
 */
import assert from 'node:assert/strict'

/*
  Mirrors lib/format.ts clockToFloat and lib/odoo/models/vocabulary.ts
  collectVocabulary. Both are `server-only` modules and cannot be imported
  from a plain node script, so the logic under test is restated here and the
  assertions are what keep the two honest — the same arrangement
  test-attendance-diff.mjs and test-mark-diff.mjs already use.
*/

function clockToFloat(value) {
  const trimmed = value.trim()
  if (!trimmed) return 0
  const match = /^(\d{1,2}):(\d{2})$/.exec(trimmed)
  if (!match) return null
  const hours = Number(match[1])
  const minutes = Number(match[2])
  if (hours > 23 || minutes > 59) return null
  return hours + minutes / 60
}

function collect(fields, submitted) {
  const read = (name) => String(submitted[name] ?? '')
  const present = (name) => Object.prototype.hasOwnProperty.call(submitted, name)

  const values = {}
  const fieldErrors = {}

  for (const field of fields) {
    const raw = read(field.name).trim()
    switch (field.kind) {
      case 'boolean':
        if (present(field.name)) values[field.name] = raw === 'true'
        break
      case 'integer': {
        if (!raw) {
          if (field.required) fieldErrors[field.name] = `${field.label} is required.`
          break
        }
        const parsed = Number(raw)
        if (!Number.isInteger(parsed)) {
          fieldErrors[field.name] = `${field.label} must be a whole number.`
          break
        }
        values[field.name] = parsed
        break
      }
      case 'clock': {
        const parsed = clockToFloat(raw)
        if (parsed === null) {
          fieldErrors[field.name] = `${field.label} must be a time, such as 08:30.`
          break
        }
        values[field.name] = parsed
        break
      }
      default: {
        if (!raw) {
          if (field.required) fieldErrors[field.name] = `${field.label} is required.`
          else values[field.name] = false
          break
        }
        values[field.name] = raw
      }
    }
  }

  if (Object.keys(fieldErrors).length > 0) return { fieldErrors }
  return { values }
}

/* --------------------------------------------------------------- clocks --- */

assert.equal(clockToFloat('08:30'), 8.5)
assert.equal(clockToFloat('00:00'), 0)
assert.equal(clockToFloat('23:59'), 23 + 59 / 60)
assert.equal(clockToFloat('8:05'), 8 + 5 / 60, 'a single-digit hour is still a time')
assert.equal(clockToFloat('  09:15  '), 9.25, 'surrounding space is not a syntax error')

// Empty is "no time set", which the shift model treats as 0, not as invalid.
assert.equal(clockToFloat(''), 0)
assert.equal(clockToFloat('   '), 0)

// Anything that is not HH:MM is refused rather than coerced to something.
for (const bad of ['half eight', '8', '08:5', '25:00', '08:60', '08:30:00', '-1:00']) {
  assert.equal(clockToFloat(bad), null, `${bad} must not parse`)
}

// The round trip a shift row makes: Odoo float -> input value -> Odoo float.
const formatClock = (value) => {
  const hours = Math.floor(value)
  const minutes = Math.round((value - hours) * 60)
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
}
for (const float of [0, 7.5, 8.25, 12, 13.75, 17.5, 23.5]) {
  assert.equal(clockToFloat(formatClock(float)), float, `${float} must survive the round trip`)
}

/* ------------------------------------------------------------- booleans --- */

const SHIFT = [
  { name: 'name', label: 'Name', kind: 'text', required: true },
  { name: 'code', label: 'Code', kind: 'text', required: true },
  { name: 'time_start', label: 'Starts at', kind: 'clock' },
  { name: 'time_end', label: 'Ends at', kind: 'clock' },
  { name: 'sequence', label: 'Sequence', kind: 'integer' },
  { name: 'active', label: 'Active', kind: 'boolean' },
]

{
  const { values } = collect(SHIFT, {
    name: 'Morning',
    code: 'AM',
    time_start: '08:00',
    time_end: '12:30',
    sequence: '10',
    active: 'true',
  })
  assert.deepEqual(values, {
    name: 'Morning',
    code: 'AM',
    time_start: 8,
    time_end: 12.5,
    sequence: 10,
    active: true,
  })
}

{
  // The box was rendered and cleared: the hidden pair sends "false".
  const { values } = collect(SHIFT, {
    name: 'Morning',
    code: 'AM',
    time_start: '',
    time_end: '',
    sequence: '',
    active: 'false',
  })
  assert.equal(values.active, false, 'clearing Active must write false')
  assert.equal(values.time_start, 0, 'an empty clock is 0, the model’s "unset"')
  assert.ok(!('sequence' in values), 'an untouched optional integer is not written')
}

{
  // The field was never rendered — a read-only role, say. It must not be written.
  const { values } = collect(SHIFT, { name: 'Morning', code: 'AM' })
  assert.ok(!('active' in values), 'a field the form never rendered must not be written')
}

/* --------------------------------------------------------------- errors --- */

{
  const { values, fieldErrors } = collect(SHIFT, { name: '', code: 'AM' })
  assert.equal(values, undefined, 'nothing is written when a required field is missing')
  assert.equal(fieldErrors.name, 'Name is required.')
  assert.ok(!fieldErrors.code)
}

{
  const { fieldErrors } = collect(SHIFT, { name: 'Morning', code: 'AM', time_start: 'noon' })
  assert.match(fieldErrors.time_start, /must be a time/)
}

{
  const { fieldErrors } = collect(SHIFT, { name: 'Morning', code: 'AM', sequence: '1.5' })
  assert.match(fieldErrors.sequence, /whole number/)
}

{
  // An optional text field cleared in the form is false in Odoo, not ''.
  const OPTIONAL = [{ name: 'code', label: 'Code', kind: 'text' }]
  const { values } = collect(OPTIONAL, { code: '' })
  assert.equal(values.code, false)
}

console.log('vocabulary-values: ok')
