/**
 * Constants shared between the server shell and the client sidebar.
 *
 * They live in their own module with no `'use client'` directive on purpose.
 * A value exported from a client module and imported by a server component
 * arrives as a client reference rather than the value itself, so reading the
 * cookie by that name silently found nothing and the rail rendered expanded
 * however the user had left it.
 */

export const SIDEBAR_COOKIE = 'sidebar'
export const EXPANDED_WIDTH = 244
export const COLLAPSED_WIDTH = 64

/** One year, path-wide, not sensitive: it is a layout preference. */
export const SIDEBAR_COOKIE_MAX_AGE = 60 * 60 * 24 * 365

export function isCollapsed(cookieValue: string | undefined): boolean {
  return cookieValue === 'collapsed'
}
