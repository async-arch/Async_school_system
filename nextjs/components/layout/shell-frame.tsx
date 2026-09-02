'use client'

import { usePathname } from 'next/navigation'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Icon } from '@/components/icons'
import { cx } from '@/components/ui'
import { findNavItem, type NavSection } from '@/lib/navigation'
import { Sidebar } from './sidebar'
import {
  COLLAPSED_WIDTH,
  EXPANDED_WIDTH,
  SIDEBAR_COOKIE,
  SIDEBAR_COOKIE_MAX_AGE,
} from './sidebar-preference'

/**
 * The authenticated frame: fixed navigation on the left, a sticky header, and
 * the page beneath it.
 *
 * This is the only client component in the shell. `children` is a server-
 * rendered tree passed straight through as a prop, so making the frame
 * interactive does not drag any page into the browser bundle.
 *
 * The collapsed state lives in a cookie rather than local storage. The server
 * can read a cookie, so the first paint is already the right width — local
 * storage would render expanded and then snap, on every navigation.
 */

export function ShellFrame({
  sections,
  brand,
  initialCollapsed,
  userMenu,
  account,
  signOutAction,
  children,
}: {
  sections: NavSection[]
  brand: { name: string; initial: string }
  initialCollapsed: boolean
  /** Rendered on the server so the sign-out form action stays server-owned. */
  userMenu: ReactNode
  /** Who is signed in — used by both the header and the sidebar footer. */
  account: { name: string; role: string; initials: string }
  signOutAction: () => Promise<void>
  children: ReactNode
}) {
  const pathname = usePathname()
  const [collapsed, setCollapsed] = useState(initialCollapsed)
  const menuButtonRef = useRef<HTMLButtonElement>(null)

  /*
    The drawer records the route it was opened on rather than a boolean, so
    navigating closes it by derivation. An effect that reset a flag when the
    path changed would run a second render every time, for a state React can
    work out on its own.
  */
  const [openedAt, setOpenedAt] = useState<string | null>(null)
  const mobileOpen = openedAt === pathname

  const changeCollapsed = useCallback((next: boolean) => {
    setCollapsed(next)
    document.cookie =
      `${SIDEBAR_COOKIE}=${next ? 'collapsed' : 'expanded'};` +
      `path=/;max-age=${SIDEBAR_COOKIE_MAX_AGE};samesite=lax`
  }, [])

  // Closing the drawer must hand focus back to what opened it.
  const setDrawerOpen = useCallback(
    (open: boolean) => {
      setOpenedAt((current) => {
        if (open) return pathname
        // Only pull focus back if the drawer was actually open.
        if (current !== null) menuButtonRef.current?.focus({ preventScroll: true })
        return null
      })
    },
    [pathname],
  )

  const current = findNavItem(sections, pathname)

  return (
    <div className="min-h-screen">
      {/* Eighteen navigation links stand between the top of the page and the
          content; a keyboard user needs a way past them. */}
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-60 focus:rounded-[8px] focus:bg-ink focus:px-4 focus:py-2 focus:text-[13px] focus:text-white"
      >
        Skip to content
      </a>
      <Sidebar
        sections={sections}
        collapsed={collapsed}
        onCollapsedChange={changeCollapsed}
        mobileOpen={mobileOpen}
        onMobileOpenChange={setDrawerOpen}
        brand={brand}
        account={account}
        signOutAction={signOutAction}
      />

      <div
        style={{ '--sidebar': `${collapsed ? COLLAPSED_WIDTH : EXPANDED_WIDTH}px` } as React.CSSProperties}
        className="flex min-h-screen min-w-0 flex-col transition-[padding] duration-200 ease-out lg:pl-[var(--sidebar)]"
      >
        <header
          className={cx(
            'sticky top-0 z-20 flex h-14 shrink-0 items-center gap-3',
            'border-b border-silver bg-white/90 px-4 backdrop-blur lg:px-8',
          )}
        >
          <button
            ref={menuButtonRef}
            type="button"
            onClick={() => setDrawerOpen(true)}
            aria-label="Open navigation"
            aria-expanded={mobileOpen}
            aria-controls="mobile-navigation"
            className="-ml-1 rounded-[8px] p-1.5 text-slate hover:bg-paper hover:text-graphite lg:hidden"
          >
            <Icon name="menu" size={18} />
          </button>

          <p className="min-w-0 truncate text-[13px] font-medium text-graphite">
            {current ? (
              <>
                <span className="hidden text-stone sm:inline">{current.section.title} · </span>
                {current.item.label}
              </>
            ) : (
              brand.name
            )}
          </p>

          <div className="ml-auto flex items-center gap-3">
            <span className="hidden text-[12px] text-stone md:inline">{account.role}</span>
            <AccountMenu name={account.name} initials={account.initials}>
              {userMenu}
            </AccountMenu>
          </div>
        </header>

        <main id="main" className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          {children}
        </main>
      </div>
    </div>
  )
}

/** The avatar button in the header and the panel it opens. */
function AccountMenu({
  name,
  initials,
  children,
}: {
  name: string
  initials: string
  children: ReactNode
}) {
  const root = useRef<HTMLDivElement>(null)
  const pathname = usePathname()
  // Same trick as the drawer: navigation closes the menu by derivation.
  const [openedAt, setOpenedAt] = useState<string | null>(null)
  const open = openedAt === pathname
  const close = useCallback(() => setOpenedAt(null), [])

  useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) close()
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close()
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, close])

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        onClick={() => setOpenedAt(open ? null : pathname)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Account — ${name}`}
        className={cx(
          'flex h-8 w-8 items-center justify-center rounded-full text-[11px] font-medium',
          'transition-colors',
          open ? 'bg-ink text-white' : 'bg-paper text-graphite hover:bg-silver/70',
        )}
      >
        {initials}
      </button>
      {open ? (
        <div
          role="menu"
          className={cx(
            'absolute top-full right-0 z-50 mt-2 w-60 rounded-[12px] bg-white p-2',
            'shadow-[var(--shadow-raised)]',
          )}
        >
          {children}
        </div>
      ) : null}
    </div>
  )
}
