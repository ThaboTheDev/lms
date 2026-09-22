import type { Route } from 'next';
import type { PermissionKey } from '@/lib/rbac/permissions';

export interface NavItem {
  label: string;
  /** Typed, so a rail pointing at a page that was never built fails the build. */
  href: Route;
  /** The item appears only if the user holds at least one of these. */
  permissions?: PermissionKey[];
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

/**
 * Navigation is derived from permissions, so a finance officer and a lecturer
 * see different rails without any role checks scattered through components.
 */
export const NAVIGATION: NavGroup[] = [
  {
    label: 'Overview',
    items: [{ label: 'Dashboard', href: '/dashboard' }],
  },
  {
    label: 'Learning',
    items: [
      { label: 'My courses', href: '/courses', permissions: ['course.read'] },
      { label: 'Assessments', href: '/assessments', permissions: ['assessment.read'] },
      { label: 'Question banks', href: '/question-banks', permissions: ['question_bank.read'] },
      { label: 'Content library', href: '/content', permissions: ['content.read'] },
      { label: 'Calendar', href: '/calendar' },
      { label: 'Discussions', href: '/discussions' },
      { label: 'Your account', href: '/account', permissions: ['pop.submit'] },
    ],
  },
  {
    label: 'Communication',
    items: [
      { label: 'Messages', href: '/messages' },
      { label: 'Announcements', href: '/announcements' },
      { label: 'Notifications', href: '/notifications' },
    ],
  },
  {
    label: 'Academic administration',
    items: [
      { label: 'Students', href: '/students', permissions: ['student.read'] },
      { label: 'Applications', href: '/admissions', permissions: ['application.read'] },
      { label: 'Programmes', href: '/programmes', permissions: ['programme.read'] },
      { label: 'Academic records', href: '/records', permissions: ['academic_record.read'] },
      { label: 'Certificates', href: '/certificates', permissions: ['certificate.read'] },
    ],
  },
  {
    label: 'Operations',
    items: [
      { label: 'Finance', href: '/finance', permissions: ['finance.read'] },
      { label: 'Fees', href: '/finance/fees', permissions: ['finance.manage'] },
      { label: 'Proof of payment', href: '/finance/proof-of-payment', permissions: ['pop.review'] },
      { label: 'Quality assurance', href: '/quality', permissions: ['qa.manage', 'moderation.perform'] },
      { label: 'Reports', href: '/reports', permissions: ['report.read'] },
      { label: 'Analytics', href: '/analytics', permissions: ['analytics.read'] },
      { label: 'Support', href: '/support', permissions: ['ticket.read'] },
    ],
  },
  {
    label: 'Administration',
    items: [
      { label: 'People and access', href: '/admin/users', permissions: ['user.read'] },
      { label: 'Roles', href: '/admin/roles', permissions: ['role.read'] },
      { label: 'Audit log', href: '/admin/audit', permissions: ['audit.read'] },
      { label: 'Privacy and retention', href: '/admin/privacy', permissions: ['settings.manage'] },
      { label: 'Settings', href: '/admin/settings', permissions: ['settings.manage'] },
    ],
  },
];
