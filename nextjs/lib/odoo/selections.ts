import 'server-only'
import { cache } from 'react'
import { callKw } from './client'
import { orNullOnRefusal } from './errors'

/**
 * Selection choices, read from Odoo rather than restated here.
 *
 * A filter dropdown has to offer exactly the values the model accepts. Copying
 * the list into TypeScript means it silently goes stale the next time somebody
 * adds a state — which has happened three times already in this module. Asking
 * `fields_get` costs one small call and also returns Odoo's own labels, which
 * are the translated ones.
 *
 * `cache` dedupes within a single request, so a screen that filters on three
 * selection fields of the same model still makes one call per field, not per
 * component that asks.
 */
export const selectionOptions = cache(
  async (model: string, field: string): Promise<Array<{ value: string; label: string }>> => {
    const meta = await orNullOnRefusal(
      callKw<Record<string, { selection?: Array<[string, string]> }>>(
        model,
        'fields_get',
        [[field]],
        { attributes: ['selection'] },
      ),
    )
    // A role that cannot read the model gets no filter rather than an error;
    // the list itself will already be explaining the refusal.
    return (meta?.[field]?.selection ?? []).map(([value, label]) => ({ value, label }))
  },
)

/** Several selection fields of one model, in one place. */
export async function selectionFilters(
  model: string,
  fields: readonly string[],
): Promise<Record<string, Array<{ value: string; label: string }>>> {
  const entries = await Promise.all(
    fields.map(async (field) => [field, await selectionOptions(model, field)] as const),
  )
  return Object.fromEntries(entries)
}
