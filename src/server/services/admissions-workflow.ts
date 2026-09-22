import type { PermissionKey } from '@/lib/rbac/permissions';

export type ApplicationStatus =
  | 'DRAFT' | 'SUBMITTED' | 'DOCUMENTS_OUTSTANDING' | 'UNDER_REVIEW' | 'INTERVIEW'
  | 'CONDITIONAL_OFFER' | 'OFFER' | 'ACCEPTED' | 'DECLINED' | 'REJECTED'
  | 'WITHDRAWN' | 'ENROLLED';

export interface TransitionRule {
  to: ApplicationStatus;
  /** Who may make this move. `applicant` means the applicant acting on their own file. */
  actor: 'applicant' | 'staff';
  permission?: PermissionKey;
  requiresDecision?: boolean;
}

/**
 * The admissions pipeline as an explicit state machine. Keeping the allowed
 * moves in one table means the review screen, the API and the applicant portal
 * cannot drift apart, and an institution can see at a glance what its process
 * permits. Stages are configurable per institution by extending this map from
 * SystemSetting in a later phase.
 */
export const APPLICATION_TRANSITIONS: Record<ApplicationStatus, TransitionRule[]> = {
  DRAFT: [
    { to: 'SUBMITTED', actor: 'applicant' },
    { to: 'WITHDRAWN', actor: 'applicant' },
  ],
  SUBMITTED: [
    { to: 'UNDER_REVIEW', actor: 'staff', permission: 'application.manage' },
    { to: 'DOCUMENTS_OUTSTANDING', actor: 'staff', permission: 'application.manage' },
    { to: 'WITHDRAWN', actor: 'applicant' },
  ],
  DOCUMENTS_OUTSTANDING: [
    { to: 'UNDER_REVIEW', actor: 'staff', permission: 'application.manage' },
    { to: 'REJECTED', actor: 'staff', permission: 'application.manage', requiresDecision: true },
    { to: 'WITHDRAWN', actor: 'applicant' },
  ],
  UNDER_REVIEW: [
    { to: 'INTERVIEW', actor: 'staff', permission: 'application.manage' },
    { to: 'DOCUMENTS_OUTSTANDING', actor: 'staff', permission: 'application.manage' },
    { to: 'OFFER', actor: 'staff', permission: 'application.manage', requiresDecision: true },
    { to: 'CONDITIONAL_OFFER', actor: 'staff', permission: 'application.manage', requiresDecision: true },
    { to: 'REJECTED', actor: 'staff', permission: 'application.manage', requiresDecision: true },
    { to: 'WITHDRAWN', actor: 'applicant' },
  ],
  INTERVIEW: [
    { to: 'OFFER', actor: 'staff', permission: 'application.manage', requiresDecision: true },
    { to: 'CONDITIONAL_OFFER', actor: 'staff', permission: 'application.manage', requiresDecision: true },
    { to: 'REJECTED', actor: 'staff', permission: 'application.manage', requiresDecision: true },
    { to: 'WITHDRAWN', actor: 'applicant' },
  ],
  CONDITIONAL_OFFER: [
    { to: 'OFFER', actor: 'staff', permission: 'application.manage' },
    { to: 'ACCEPTED', actor: 'applicant' },
    { to: 'DECLINED', actor: 'applicant' },
    { to: 'REJECTED', actor: 'staff', permission: 'application.manage', requiresDecision: true },
  ],
  OFFER: [
    { to: 'ACCEPTED', actor: 'applicant' },
    { to: 'DECLINED', actor: 'applicant' },
    { to: 'WITHDRAWN', actor: 'applicant' },
  ],
  ACCEPTED: [
    { to: 'ENROLLED', actor: 'staff', permission: 'enrolment.manage' },
    { to: 'WITHDRAWN', actor: 'applicant' },
  ],
  DECLINED: [],
  REJECTED: [],
  WITHDRAWN: [],
  ENROLLED: [],
};

/** Terminal states cannot be moved out of; reopening means a new application. */
export function isTerminal(status: ApplicationStatus): boolean {
  return APPLICATION_TRANSITIONS[status].length === 0;
}

export function allowedTransitions(status: ApplicationStatus): TransitionRule[] {
  return APPLICATION_TRANSITIONS[status];
}

export function findTransition(
  from: ApplicationStatus,
  to: ApplicationStatus,
): TransitionRule | undefined {
  return APPLICATION_TRANSITIONS[from].find((rule) => rule.to === to);
}

export function canTransition(from: ApplicationStatus, to: ApplicationStatus): boolean {
  return Boolean(findTransition(from, to));
}

/** Statuses that count as live work in the admissions dashboard. */
export const ACTIVE_APPLICATION_STATUSES: ApplicationStatus[] = [
  'SUBMITTED', 'DOCUMENTS_OUTSTANDING', 'UNDER_REVIEW', 'INTERVIEW',
  'CONDITIONAL_OFFER', 'OFFER', 'ACCEPTED',
];

export const APPLICATION_STATUS_LABELS: Record<ApplicationStatus, string> = {
  DRAFT: 'Draft',
  SUBMITTED: 'Submitted',
  DOCUMENTS_OUTSTANDING: 'Documents outstanding',
  UNDER_REVIEW: 'Under review',
  INTERVIEW: 'Interview',
  CONDITIONAL_OFFER: 'Conditional offer',
  OFFER: 'Offer made',
  ACCEPTED: 'Offer accepted',
  DECLINED: 'Offer declined',
  REJECTED: 'Not successful',
  WITHDRAWN: 'Withdrawn',
  ENROLLED: 'Enrolled',
};
