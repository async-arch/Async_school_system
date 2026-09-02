import type { IconName } from '@/components/icons'
import type { SchoolRoles } from '@/lib/odoo/types'

/**
 * Role-aware navigation.
 *
 * Visibility is a UX decision, never a security one — Odoo re-checks every
 * call. What it encodes is the *measured* ACL coverage from staging, so nobody
 * is offered a door that opens onto a 403.
 *
 * Four record rules previously could not fire because the matching ACL row was
 * absent; those rows were added in security/ir.model.access.csv to match the
 * matrix in README.md, so Director and Front Office now read students, and
 * Director and Registrar read marks.
 *
 * Still absent from the CSV, and therefore still hidden here: Director has no
 * ACL row on school.teacher, school.class, school.subject, school.academic.year,
 * school.term or school.teacher.assignment, and Front Office has none on any
 * academic model. Widening those is an authorisation decision for the owner —
 * do not work around it in the frontend.
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
        href: '/enrollments',
        label: 'Enrolments',
        icon: 'enrolment',
        description: 'Placement in a class for an academic year',
        visible: (r) => any(r.isRegistrar, r.isAdmin, r.isDirector, r.isTeacher),
      },
      {
        href: '/staff',
        label: 'Staff',
        icon: 'staff',
        visible: (r) =>
          any(r.isRegistrar, r.isAdmin, r.isDirector, r.isHr, r.isFrontOffice, r.isTeacher),
      },
      {
        // No director ACL row on school.teacher.
        href: '/teachers',
        label: 'Teachers',
        icon: 'teachers',
        description: 'Teaching profiles and workload',
        visible: (r) => any(r.isRegistrar, r.isAdmin, r.isTeacher, r.isExamOfficer),
      },
    ],
  },
  {
    id: 'teaching',
    title: 'Teaching',
    items: [
      {
        // school.class.schedule carries ACL rows for admin and teacher only.
        href: '/schedule',
        label: 'Timetable',
        icon: 'timetable',
        description: 'The weekly lesson grid',
        visible: (r) => any(r.isAdmin, r.isTeacher),
      },
      {
        // No director ACL row on school.attendance.
        href: '/attendance',
        label: 'Attendance',
        icon: 'attendance',
        description: 'Daily register by class',
        visible: (r) => any(r.isRegistrar, r.isAdmin, r.isTeacher),
      },
      {
        href: '/assignments',
        label: 'Teaching assignments',
        icon: 'assignments',
        visible: (r) => any(r.isRegistrar, r.isAdmin, r.isTeacher),
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
        // Director has no ACL row on school.announcement.
        href: '/announcements',
        label: 'Announcements',
        icon: 'announcements',
        visible: (r) => any(r.isRegistrar, r.isFrontOffice, r.isAdmin, r.isTeacher),
      },
      {
        // No director ACL row on school.program.
        href: '/programs',
        label: 'Programs',
        icon: 'programs',
        description: 'Events and activities',
        visible: (r) => any(r.isRegistrar, r.isAdmin, r.isTeacher),
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
        visible: (r) => any(r.isRegistrar, r.isAdmin, r.isTeacher, r.isExamOfficer),
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
