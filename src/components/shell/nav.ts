import type { Route } from 'next';
import type { PermissionKey } from '@/lib/rbac/permissions';
import type { MessageKey } from '@/lib/i18n/messages';

export interface NavItemDefinition {
  /** Translated per viewer: see src/lib/i18n/messages.ts. */
  labelKey: MessageKey;
  /** Typed, so a rail pointing at a page that was never built fails the build. */
  href: Route;
  /** The item appears only if the user holds at least one of these. */
  permissions?: PermissionKey[];
  /** Require the permission institution-wide; a grant for one course is not enough. */
  institutionWide?: boolean;
}

export interface NavGroupDefinition {
  labelKey: MessageKey;
  items: NavItemDefinition[];
}

/** What the rail renders: labels already in the viewer's language. */
export interface NavItem {
  label: string;
  href: Route;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

/**
 * Navigation is derived from permissions, so a finance officer and a lecturer
 * see different rails without any role checks scattered through components.
 */
export const NAVIGATION: NavGroupDefinition[] = [
  {
    labelKey: 'nav.group.overview',
    items: [
      { labelKey: 'nav.dashboard', href: '/dashboard' },
      { labelKey: 'nav.search', href: '/search' },
      { labelKey: 'nav.security', href: '/security' },
    ],
  },
  {
    labelKey: 'nav.group.learning',
    items: [
      { labelKey: 'nav.courses', href: '/courses', permissions: ['course.read'] },
      { labelKey: 'nav.assessments', href: '/assessments', permissions: ['assessment.read'] },
      { labelKey: 'nav.questionBanks', href: '/question-banks', permissions: ['question_bank.read'] },
      { labelKey: 'nav.content', href: '/content', permissions: ['content.read'] },
      { labelKey: 'nav.calendar', href: '/calendar' },
      { labelKey: 'nav.discussions', href: '/discussions' },
      { labelKey: 'nav.account', href: '/account', permissions: ['pop.submit'] },
    ],
  },
  {
    labelKey: 'nav.group.communication',
    items: [
      { labelKey: 'nav.messages', href: '/messages' },
      { labelKey: 'nav.announcements', href: '/announcements' },
      { labelKey: 'nav.notifications', href: '/notifications' },
    ],
  },
  {
    labelKey: 'nav.group.academic',
    items: [
      { labelKey: 'nav.students', href: '/students', permissions: ['student.read'], institutionWide: true },
      { labelKey: 'nav.applications', href: '/admissions', permissions: ['application.read'] },
      { labelKey: 'nav.programmes', href: '/programmes', permissions: ['programme.read'] },
      { labelKey: 'nav.records', href: '/records', permissions: ['academic_record.read'] },
      { labelKey: 'nav.certificates', href: '/certificates', permissions: ['certificate.read'] },
      { labelKey: 'nav.certificateTemplates', href: '/admin/certificate-templates', permissions: ['certificate.issue'] },
    ],
  },
  {
    labelKey: 'nav.group.operations',
    items: [
      { labelKey: 'nav.finance', href: '/finance', permissions: ['finance.read'] },
      { labelKey: 'nav.fees', href: '/finance/fees', permissions: ['finance.manage'] },
      { labelKey: 'nav.pop', href: '/finance/proof-of-payment', permissions: ['pop.review'] },
      { labelKey: 'nav.quality', href: '/quality', permissions: ['qa.manage', 'moderation.perform'] },
      { labelKey: 'nav.reports', href: '/reports', permissions: ['report.read'] },
      { labelKey: 'nav.analytics', href: '/analytics', permissions: ['analytics.read'] },
      { labelKey: 'nav.support', href: '/support', permissions: ['ticket.read'] },
    ],
  },
  {
    labelKey: 'nav.group.administration',
    items: [
      { labelKey: 'nav.academicSetup', href: '/admin/academic', permissions: ['programme.manage', 'course.manage', 'settings.manage', 'enrolment.manage'] },
      { labelKey: 'nav.people', href: '/admin/users', permissions: ['user.read'] },
      { labelKey: 'nav.roles', href: '/admin/roles', permissions: ['role.read'] },
      { labelKey: 'nav.audit', href: '/admin/audit', permissions: ['audit.read'] },
      { labelKey: 'nav.privacy', href: '/admin/privacy', permissions: ['settings.manage'] },
      { labelKey: 'nav.settings', href: '/admin/settings', permissions: ['settings.manage'] },
      { labelKey: 'nav.emailTemplates', href: '/admin/email-templates', permissions: ['settings.manage'] },
    ],
  },
];
