import type { IconName } from '@/components/icons'
import type { SchoolRoles } from '@/lib/odoo/types'

/**
 * Role-aware navigation.
 *
 * Visibility is a UX decision, never a security one — Odoo re-checks every
 * call. What it encodes is measured ACL coverage, so nobody is offered a door
 * that opens onto a 403. Two tests hold it there: scripts/test-navigation-access.mjs
 * states the whole matrix as data, and scripts/e2e-navigation-access.mjs signs
 * in as each role and opens every link the sidebar actually drew.
 *
 * The rule these predicates encode:
 *
 *   a route is offered when the role can actually read its model AND the
 *   README's role matrix says the role has business there.
 *
 * Both halves matter. The first stops anyone being sent to a guaranteed
 * refusal; the second stops the menu becoming a list of everything the ACL
 * happens to permit. Neither is a security boundary — Odoo re-authorises every
 * call regardless — so when the two disagree, the fix belongs in the ACL, not
 * here.
 *
 * What the backend now allows, after the ACL alignment:
 *
 *   Director      read-only on students, marks, classes, attendance, the
 *                 timetable, teaching assignments, teachers, announcements and
 *                 programs. Unscoped, and no write, create or delete anywhere.
 *   Front Office  reads every student, for contact lookup only.
 *   Registrar     owns the timetable — full rights on school.class.schedule,
 *                 which school.day.builder needs in order to create slots.
 *   Exam Officer  reads enrolments and teaching assignments, which is how a
 *                 mark list is traced back to the teacher who owns it.
 *
 * Still absent, and therefore still hidden here: Director has no ACL row on
 * school.subject, school.academic.year, school.term or school.section, and
 * Front Office has none on any academic model beyond students. Widening those
 * is an authorisation decision for the owner — do not work around it here.
 *
 * One deliberate omission. A teacher holds read on school.report.card, but
 * that model carries **no record rule at all**, so the rows are unscoped: every
 * report card in the school, not the teacher's own classes. /report-cards is
 * therefore not offered to a teacher. Hiding the link is not what makes that
 * safe — only a record rule would — so it is written up rather than papered
 * over here.
 *
 * The sections are the school's own domains rather than the module's table
 * names: somebody looking for "who is in Grade 7" reaches for People, not for
 * `school.enrollment`.
 */

interface NavRule {
  href: string
  label: string
  icon: IconName
  /** Shown under the label when the section is expanded on a wide screen. */
  description?: string
  visible: (roles: SchoolRoles) => boolean
}

interface NavRuleSection {
  id: string
  title: string
  items: NavRule[]
}

/** What crosses to the client. Predicates are evaluated on the server. */
export interface NavItem {
  href: string
  label: string
  icon: IconName
  description?: string
}

export interface NavSection {
  id: string
  title: string
  items: NavItem[]
}

const any = (...flags: boolean[]) => flags.some(Boolean)

const NAV_RULES: NavRuleSection[] = [
  {
    id: 'overview',
    title: 'Overview',
    items: [
      {
        href: '/dashboard',
        label: 'Dashboard',
        icon: 'dashboard',
        description: 'What needs your attention today',
        visible: () => true,
      },
    ],
  },
  {
    id: 'people',
    title: 'People',
    items: [
      {
        href: '/students',
        label: 'Students',
        icon: 'students',
        description: 'Register, search and track a student',
        visible: (r) =>
          any(r.isRegistrar, r.isTeacher, r.isAdmin, r.isExamOfficer, r.isDirector, r.isFrontOffice),
      },
      {
        href: '/guardians',
        label: 'Guardians',
        icon: 'students',
        description: 'Student guardian relationships',
        // A teacher reads the guardians of their own classes' students, which
        // is how they reach a parent. The record rule does that scoping.
        visible: (r) =>
          any(r.isRegistrar, r.isAdmin, r.isDirector, r.isFrontOffice, r.isTeacher),
      },
      {
        href: '/enrollments',
        label: 'Enrolments',
        icon: 'enrolment',
        description: 'Placement in a class for an academic year',
        visible: (r) =>
          any(r.isRegistrar, r.isAdmin, r.isDirector, r.isTeacher, r.isExamOfficer),
      },
      {
        href: '/staff',
        label: 'Staff',
        icon: 'staff',
        visible: (r) =>
          any(r.isRegistrar, r.isAdmin, r.isDirector, r.isHr, r.isFrontOffice, r.isTeacher),
      },
      {
        href: '/teachers',
        label: 'Teachers',
        icon: 'teachers',
        description: 'Teaching profiles and workload',
        visible: (r) =>
          any(r.isRegistrar, r.isAdmin, r.isTeacher, r.isExamOfficer, r.isDirector),
      },
    ],
  },
  {
    id: 'teaching',
    title: 'Teaching',
    items: [
      {
        href: '/schedule',
        label: 'Timetable',
        icon: 'timetable',
        description: 'The weekly lesson grid',
        // The registrar builds the timetable and now holds the rights to do
        // it; a teacher sees their own slots, a director reads all of them.
        visible: (r) => any(r.isAdmin, r.isTeacher, r.isRegistrar, r.isDirector),
      },
      {
        href: '/attendance',
        label: 'Attendance',
        icon: 'attendance',
        description: 'Daily register by class',
        visible: (r) => any(r.isRegistrar, r.isAdmin, r.isTeacher, r.isDirector),
      },
      {
        href: '/assignments',
        label: 'Teaching assignments',
        icon: 'assignments',
        // The exam officer reads assignments to know whose mark list is whose.
        visible: (r) =>
          any(r.isRegistrar, r.isAdmin, r.isTeacher, r.isDirector, r.isExamOfficer),
      },
    ],
  },
  {
    id: 'assessment',
    title: 'Assessment',
    items: [
      {
        href: '/assessments',
        label: 'Assessments',
        icon: 'assessments',
        description: 'Mark lists and their approval',
        visible: (r) => any(r.isTeacher, r.isExamOfficer, r.isAdmin, r.isRegistrar, r.isDirector),
      },
      {
        href: '/marks',
        label: 'Marks',
        icon: 'marks',
        visible: (r) => any(r.isTeacher, r.isExamOfficer, r.isAdmin, r.isRegistrar, r.isDirector),
      },
      {
        href: '/report-cards',
        label: 'Report cards',
        icon: 'reportCards',
        visible: (r) => any(r.isExamOfficer, r.isAdmin, r.isDirector, r.isRegistrar),
      },
      {
        href: '/promotion',
        label: 'Promotion',
        icon: 'promotion',
        description: 'End-of-year outcomes',
        visible: (r) => any(r.isRegistrar, r.isAdmin, r.isTeacher),
      },
    ],
  },
  {
    id: 'records',
    title: 'Records',
    items: [
      {
        href: '/documents',
        label: 'Documents',
        icon: 'documents',
        description: 'Verification and rejection',
        visible: (r) => any(r.isRegistrar, r.isAdmin, r.isHr),
      },
    ],
  },
  {
    id: 'communication',
    title: 'Communication',
    items: [
      {
        href: '/announcements',
        label: 'Announcements',
        icon: 'announcements',
        visible: (r) =>
          any(r.isRegistrar, r.isFrontOffice, r.isAdmin, r.isTeacher, r.isDirector),
      },
      {
        href: '/programs',
        label: 'Programs',
        icon: 'programs',
        description: 'Events and activities',
        visible: (r) => any(r.isRegistrar, r.isAdmin, r.isTeacher, r.isDirector),
      },
    ],
  },
  {
    id: 'academic-setup',
    title: 'Academic setup',
    items: [
      {
        href: '/classes',
        label: 'Classes',
        icon: 'classes',
        visible: (r) =>
          any(r.isRegistrar, r.isAdmin, r.isTeacher, r.isExamOfficer, r.isDirector),
      },
      {
        href: '/subjects',
        label: 'Subjects',
        icon: 'subjects',
        visible: (r) => any(r.isRegistrar, r.isAdmin, r.isTeacher, r.isExamOfficer),
      },
      {
        href: '/academic-years',
        label: 'Academic years',
        icon: 'academicYear',
        visible: (r) => any(r.isRegistrar, r.isAdmin, r.isTeacher, r.isExamOfficer),
      },
      {
        href: '/configuration',
        label: 'Configuration',
        icon: 'configuration',
        description: 'Grades, sections, streams, shifts, rooms',
        visible: (r) => any(r.isRegistrar, r.isAdmin),
      },
      {
        href: '/rooms',
        label: 'Rooms',
        icon: 'rooms',
        description: 'Where classes and timetable slots are placed',
        // school.room carries ACL rows for the administrator and the teacher
        // only; nobody else can read it, so nobody else is offered the screen.
        visible: (r) => any(r.isAdmin, r.isTeacher),
      },
      {
        href: '/branches',
        label: 'Branches',
        icon: 'campus',
        description: 'Campuses that classes, staff and notices scope to',
        // school.campus is readable by every school role except finance.
        visible: (r) =>
          any(r.isAdmin, r.isDirector, r.isRegistrar, r.isTeacher, r.isFrontOffice, r.isHr),
      },
      {
        href: '/configuration/grading',
        label: 'Grading schemes',
        icon: 'marks',
        description: 'The bands report cards are graded by',
        // Only these two roles have ACL rows on school.grading.scheme.
        visible: (r) => any(r.isAdmin, r.isExamOfficer),
      },
    ],
  },
]

export function visibleSections(roles: SchoolRoles): NavSection[] {
  return NAV_RULES.map((section) => ({
    id: section.id,
    title: section.title,
    // Drop the predicate: only the presentational fields may cross to the client.
    items: section.items
      .filter((item) => item.visible(roles))
      .map(({ href, label, icon, description }) => ({ href, label, icon, description })),
  })).filter((section) => section.items.length > 0)
}

/** Human label for the signed-in user's strongest role. */
/**
 * Where a role's work actually starts.
 *
 * The precedence is `primaryRoleLabel`'s, so the page someone lands on always
 * agrees with the role the shell says they hold. Each destination is the queue
 * that role's own dashboard already leads with, rather than a guess:
 * a teacher's open mark lists, an exam officer's approval queue, a registrar's
 * submitted registrations.
 *
 * Administrators and directors keep the dashboard — the overview is their work,
 * not a step on the way to it.
 *
 * This only chooses a first page. Every destination is reachable from the
 * sidebar regardless, and Odoo still authorises whatever is asked for there,
 * so landing somewhere is never a grant of access to it.
 */
export function landingPath(roles: SchoolRoles): string {
  if (roles.isAdmin || roles.isDirector) return '/dashboard'
  if (roles.isRegistrar) return '/students?status=submitted'
  if (roles.isExamOfficer) return '/assessments?status=submitted'
  if (roles.isHr) return '/staff'
  if (roles.isFrontOffice) return '/students'
  if (roles.isTeacher) return '/assessments?status=open'
  return '/dashboard'
}

export function primaryRoleLabel(roles: SchoolRoles): string {
  if (roles.isAdmin) return 'Administrator'
  if (roles.isDirector) return 'Director'
  if (roles.isRegistrar) return 'Registrar'
  if (roles.isExamOfficer) return 'Exam Officer'
  if (roles.isHr) return 'HR Officer'
  if (roles.isFrontOffice) return 'Front Office'
  if (roles.isTeacher) return 'Teacher'
  return 'Staff'
}

/**
 * The navigation entry a path belongs to. Used for the document title and the
 * heading in the mobile header, so the two never disagree with the sidebar.
 */
export function findNavItem(
  sections: NavSection[],
  pathname: string,
): { section: NavSection; item: NavItem } | null {
  let best: { section: NavSection; item: NavItem } | null = null
  for (const section of sections) {
    for (const item of section.items) {
      const matches = pathname === item.href || pathname.startsWith(`${item.href}/`)
      if (matches && (!best || item.href.length > best.item.href.length)) {
        best = { section, item }
      }
    }
  }
  return best
}
