import { cookies } from 'next/headers'
import type { ReactNode } from 'react'
import { logoutAction } from '@/app/login/actions'
import { Icon } from '@/components/icons'
import { primaryRoleLabel, visibleSections } from '@/lib/navigation'
import type { CurrentUser } from '@/lib/odoo/types'
import { ShellFrame } from './shell-frame'
import { SIDEBAR_COOKIE, isCollapsed } from './sidebar-preference'

/**
 * The authenticated shell.
 *
 * Stays a server component so three things never reach the browser: the role
 * predicates that decide what the menu contains, the sign-out server action,
 * and the sidebar preference, which is read from the cookie here so the first
 * paint is already the right width.
 */
export async function AppShell({ user, children }: { user: CurrentUser; children: ReactNode }) {
  const sections = visibleSections(user.roles)
  const role = primaryRoleLabel(user.roles)
  const collapsed = isCollapsed((await cookies()).get(SIDEBAR_COOKIE)?.value)

  const initials =
    user.name
      .split(' ')
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join('') || '—'

  return (
    <ShellFrame
      sections={sections}
      brand={{ name: 'Async School', initial: 'A' }}
      initialCollapsed={collapsed}
      account={{ name: user.name, role, initials }}
      signOutAction={logoutAction}
      userMenu={
        <>
          <div className="border-b border-silver px-2.5 pt-1 pb-2.5">
            <p className="truncate text-[13px] font-medium text-graphite">{user.name}</p>
            <p className="truncate text-[11px] text-stone">{user.login}</p>
            <p className="mt-1.5 text-[11px] text-slate">
              {role}
              {user.school_department ? ` · ${user.school_department}` : ''}
            </p>
          </div>
          <form action={logoutAction}>
            <button
              type="submit"
              role="menuitem"
              className="mt-1 flex w-full items-center gap-2 rounded-[8px] px-2.5 py-2 text-left text-[13px] text-slate transition-colors hover:bg-paper hover:text-graphite"
            >
              <Icon name="signOut" size={15} />
              Sign out
            </button>
          </form>
        </>
      }
    >
      {children}
    </ShellFrame>
  )
}
