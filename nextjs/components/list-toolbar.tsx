'use client'

import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { useEffect, useState, useTransition } from 'react'
import { Icon } from '@/components/icons'
import { cx } from '@/components/ui'

/**
 * Search and filter controls for a list screen.
 *
 * Everything writes to the URL and lets the server component re-query Odoo.
 * Nothing filters client-side: the row set is scoped by record rules and paged,
 * so the browser only ever holds one page and narrowing it locally would give
 * a confidently wrong answer.
 */

export interface FilterOption {
  value: string
  label: string
}

export interface FilterSpec {
  /** The query-string key, matching what the page parsed. */
  key: string
  label: string
  options: FilterOption[]
  /** Shown as the "no filter" choice. */
  allLabel?: string
}

function pushParams(
  router: ReturnType<typeof useRouter>,
  pathname: string,
  params: URLSearchParams,
  changes: Record<string, string | undefined>,
) {
  const next = new URLSearchParams(params)
  for (const [key, value] of Object.entries(changes)) {
    if (value) next.set(key, value)
    else next.delete(key)
  }
  // Any change to what is being looked for starts again at the first page.
  next.delete('page')
  const query = next.toString()
  router.replace(query ? `${pathname}?${query}` : pathname)
}

export function SearchField({ placeholder = 'Search' }: { placeholder?: string }) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const [value, setValue] = useState(params.get('q') ?? '')
  const [pending, startTransition] = useTransition()

  useEffect(() => {
    const current = params.get('q') ?? ''
    if (value === current) return
    const timer = setTimeout(() => {
      startTransition(() => pushParams(router, pathname, params, { q: value || undefined }))
    }, 300)
    return () => clearTimeout(timer)
  }, [value, params, pathname, router])

  return (
    <div className="relative min-w-0 flex-1 sm:max-w-xs">
      <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-stone">
        <Icon name="search" size={14} />
      </span>
      <input
        type="search"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className={cx(
          'w-full rounded-[8px] border border-silver bg-white py-2 pr-8 pl-9',
          'text-[13px] text-graphite placeholder:text-stone',
          'focus:border-action-blue focus:outline-none',
        )}
      />
      {pending ? (
        <span
          role="status"
          aria-label="Searching"
          className="absolute top-1/2 right-3 -translate-y-1/2"
        >
          <span className="block h-3 w-3 animate-spin rounded-full border-[1.5px] border-stone border-t-transparent" />
        </span>
      ) : null}
    </div>
  )
}

export function FilterSelect({ filter }: { filter: FilterSpec }) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const [, startTransition] = useTransition()
  const value = params.get(filter.key) ?? ''

  return (
    <label className="flex min-w-0 items-center gap-2">
      <span className="sr-only">{filter.label}</span>
      <select
        value={value}
        onChange={(event) =>
          startTransition(() =>
            pushParams(router, pathname, params, { [filter.key]: event.target.value || undefined }),
          )
        }
        className={cx(
          'max-w-[190px] min-w-0 truncate rounded-[8px] border bg-white py-2 pr-7 pl-3 text-[13px]',
          'focus:border-action-blue focus:outline-none',
          value ? 'border-action-blue text-graphite' : 'border-silver text-slate',
        )}
      >
        <option value="">{filter.allLabel ?? `All ${filter.label.toLowerCase()}`}</option>
        {filter.options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  )
}

/** A date filter, for the screens whose natural axis is a day. */
export function DateFilter({
  paramKey = 'date',
  label = 'Date',
}: {
  paramKey?: string
  label?: string
}) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const [, startTransition] = useTransition()

  return (
    <label className="flex items-center gap-2">
      <span className="sr-only">{label}</span>
      <input
        type="date"
        value={params.get(paramKey) ?? ''}
        onChange={(event) =>
          startTransition(() =>
            pushParams(router, pathname, params, { [paramKey]: event.target.value || undefined }),
          )
        }
        className={cx(
          'rounded-[8px] border bg-white px-3 py-2 text-[13px]',
          'focus:border-action-blue focus:outline-none',
          params.get(paramKey) ? 'border-action-blue text-graphite' : 'border-silver text-slate',
        )}
      />
    </label>
  )
}
