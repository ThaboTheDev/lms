/**
 * src/server/services/role-grants.ts
 *
 * Finding a role by key for an institution, and granting it once.
 *
 * Production has only the shared system roles: rbac:sync creates them with no
 * institution. The development seed also creates a copy per institution. Code
 * that looked only for the per-institution copy found it in development and
 * nothing at all in production, and then silently skipped the grant: every
 * learner registered on a real deployment ended up with no role.
 *
 * No `server-only` import and no Prisma singleton: the client (or transaction)
 * is passed in, so scripts can use this too.
 */
import type { Prisma, PrismaClient } from '@prisma/client';
import { AppError } from '@/lib/errors';

type Db = PrismaClient | Prisma.TransactionClient;

/** The institution's own copy of a role if it has one, otherwise the shared system role. */
export async function findRoleForInstitution(db: Db, institutionId: string, key: string) {
  const roles = await db.role.findMany({
    where: { key, OR: [{ institutionId }, { institutionId: null }] },
    select: { id: true, institutionId: true, name: true },
  });
  return roles.find((role) => role.institutionId === institutionId) ?? roles.find((role) => role.institutionId === null) ?? null;
}

/** Like findRoleForInstitution, but a missing role is a deployment fault worth saying out loud. */
export async function requireRoleForInstitution(db: Db, institutionId: string, key: string) {
  const role = await findRoleForInstitution(db, institutionId, key);
  if (!role) {
    throw new AppError(
      `The ${key.toLowerCase().replace(/_/g, ' ')} role is missing. Run the role sync (npm run rbac:sync) and try again.`,
      500,
      'roles_missing',
    );
  }
  return role;
}

/**
 * Grants a role once. Institution-wide grants have no scope id, and Prisma
 * refuses null inside a compound-unique upsert, so this is find-then-create
 * rather than an upsert on (userId, roleId, scopeType, scopeId).
 */
export async function grantRoleOnce(
  db: Db,
  input: {
    userId: string;
    roleId: string;
    institutionId: string;
    scopeType?: 'INSTITUTION' | 'FACULTY' | 'DEPARTMENT' | 'PROGRAMME' | 'COURSE';
    scopeId?: string | null;
    grantedById?: string | null;
    expiresAt?: Date | null;
  },
) {
  const scopeType = input.scopeType ?? 'INSTITUTION';
  const scopeId = scopeType === 'INSTITUTION' ? null : input.scopeId ?? null;
  const existing = await db.userRole.findFirst({
    where: { userId: input.userId, roleId: input.roleId, scopeType, scopeId },
    select: { id: true },
  });
  if (existing) return { id: existing.id, created: false };

  const created = await db.userRole.create({
    data: {
      userId: input.userId,
      roleId: input.roleId,
      institutionId: input.institutionId,
      scopeType,
      scopeId,
      grantedById: input.grantedById ?? null,
      expiresAt: input.expiresAt ?? null,
    },
    select: { id: true },
  });
  return { id: created.id, created: true };
}
