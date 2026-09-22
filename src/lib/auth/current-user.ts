import 'server-only';
import { cache } from 'react';
import { prisma } from '@/lib/db';
import { AuthenticationError } from '@/lib/errors';
import { ALL_PERMISSIONS, type PermissionKey } from '@/lib/rbac/permissions';
import type { Principal, RoleGrant, ScopeType } from '@/lib/rbac/authorize';
import { readVerifiedSession } from './session';

/**
 * Builds the principal once per request. React's cache() keeps a single page
 * render from re-running the role query for every component that asks.
 */
export const getCurrentPrincipal = cache(async (): Promise<Principal | null> => {
  const session = await readVerifiedSession();
  if (!session) return null;

  const { user } = session;

  const [roleAssignments, studentProfile] = await Promise.all([
    prisma.userRole.findMany({
      where: {
        userId: user.id,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
      include: {
        role: { include: { permissions: { include: { permission: true } } } },
      },
    }),
    prisma.studentProfile.findUnique({
      where: { userId: user.id },
      select: { id: true },
    }),
  ]);

  const isSuperAdmin = roleAssignments.some((a) => a.role.key === 'SUPER_ADMIN');

  const grants: RoleGrant[] = roleAssignments.map((assignment) => ({
    roleKey: assignment.role.key,
    scopeType: assignment.scopeType as ScopeType,
    scopeId: assignment.scopeId,
    institutionId: assignment.institutionId ?? user.institutionId,
    expiresAt: assignment.expiresAt,
    permissions:
      assignment.role.key === 'SUPER_ADMIN'
        ? ALL_PERMISSIONS
        : (assignment.role.permissions.map((rp) => rp.permission.key) as PermissionKey[]),
  }));

  return {
    userId: user.id,
    institutionId: user.institutionId,
    email: user.email,
    displayName: user.preferredName ?? `${user.firstName} ${user.lastName}`,
    isSuperAdmin,
    grants,
    studentId: studentProfile?.id ?? null,
  };
});

export async function requirePrincipal(): Promise<Principal> {
  const principal = await getCurrentPrincipal();
  if (!principal) throw new AuthenticationError();
  return principal;
}

/** Institution the request operates in. Super admins may act without one. */
export async function requireInstitutionId(): Promise<string> {
  const principal = await requirePrincipal();
  if (!principal.institutionId) {
    throw new AuthenticationError('No institution is selected for this account.');
  }
  return principal.institutionId;
}
