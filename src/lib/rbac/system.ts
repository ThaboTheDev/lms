import type { Principal } from './authorize';

/**
 * The actor for work nobody is signed in for: the nightly at-risk refresh, the
 * sweep that submits abandoned timed attempts, arrears marking. It holds every
 * permission within one institution, and the audit log records it as the
 * scheduled system rather than pinning it on a person.
 */
export const SYSTEM_USER_ID = 'system';

export function systemPrincipal(institutionId: string | null): Principal {
  return {
    userId: SYSTEM_USER_ID,
    institutionId,
    email: 'system@scheduled',
    displayName: 'Scheduled task',
    isSuperAdmin: true,
    grants: [],
    studentId: null,
  };
}

export function isSystemPrincipal(principal: Pick<Principal, 'userId'> | null | undefined): boolean {
  return principal?.userId === SYSTEM_USER_ID;
}
