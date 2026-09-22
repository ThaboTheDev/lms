import 'server-only';
import { prisma } from '@/lib/db';
import { AppError, NotFoundError } from '@/lib/errors';
import { recordAudit } from '@/lib/audit';
import { requirePermission, type Principal } from '@/lib/rbac/authorize';
import { isPermissionKey } from '@/lib/rbac/permissions';

/**
 * Roles, and the permissions bundled into them.
 *
 * The catalogue in `lib/rbac/permissions` is the source of truth for what can be
 * authorised; a role is only a named bundle of those keys. System roles are
 * shipped and maintained by `npm run rbac:sync`, so they are read here and
 * cannot be edited from the screen - otherwise the next sync would quietly undo
 * whatever an administrator did.
 */

const ROLE_KEY = /^[A-Z][A-Z0-9_]{2,40}$/;

export interface RoleSummary {
  id: string;
  key: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  permissionKeys: string[];
  memberCount: number;
}

export async function listRoles(principal: Principal): Promise<RoleSummary[]> {
  const institutionId = principal.institutionId;
  if (!institutionId) throw new NotFoundError('Institution');
  requirePermission(principal, 'role.read', { institutionId });

  const roles = await prisma.role.findMany({
    // Institution roles plus the platform-wide system roles, which have no
    // institution of their own.
    where: { OR: [{ institutionId: null }, { institutionId }] },
    orderBy: [{ isSystem: 'desc' }, { name: 'asc' }],
    select: {
      id: true,
      key: true,
      name: true,
      description: true,
      isSystem: true,
      permissions: { select: { permission: { select: { key: true } } } },
      _count: { select: { userRoles: true } },
    },
  });

  return roles.map((role) => ({
    id: role.id,
    key: role.key,
    name: role.name,
    description: role.description,
    isSystem: role.isSystem,
    permissionKeys: role.permissions.map((p) => p.permission.key).sort(),
    memberCount: role._count.userRoles,
  }));
}

/** Unknown keys are dropped rather than failing: the catalogue moves on. */
export async function createRole(
  principal: Principal,
  input: { name: string; key: string; description?: string | null; permissionKeys: string[] },
) {
  const institutionId = principal.institutionId;
  if (!institutionId) throw new NotFoundError('Institution');
  requirePermission(principal, 'role.manage', { institutionId });

  const name = input.name.trim();
  const key = input.key.trim().toUpperCase();

  if (name.length < 2) throw new AppError('Give the role a name.', 422, 'validation_failed');
  if (!ROLE_KEY.test(key)) {
    throw new AppError(
      'Use a key of capitals, numbers and underscores, starting with a letter.',
      422,
      'validation_failed',
    );
  }

  const existing = await prisma.role.findFirst({ where: { institutionId, key }, select: { id: true } });
  if (existing) throw new AppError('A role with that key already exists.', 409, 'duplicate_role');

  const permissions = await prisma.permission.findMany({
    where: { key: { in: input.permissionKeys.filter(isPermissionKey) } },
    select: { id: true },
  });

  const role = await prisma.role.create({
    data: {
      institutionId,
      key,
      name,
      description: input.description?.trim() || null,
      isSystem: false,
      permissions: { create: permissions.map((permission) => ({ permissionId: permission.id })) },
    },
    select: { id: true, key: true, name: true },
  });

  await recordAudit(principal, {
    action: 'role.created',
    entityType: 'Role',
    entityId: role.id,
    institutionId,
    after: { key: role.key, permissions: input.permissionKeys.length },
  });

  return role;
}

export async function setRolePermissions(principal: Principal, roleId: string, permissionKeys: string[]) {
  const role = await prisma.role.findUnique({
    where: { id: roleId },
    select: { id: true, key: true, isSystem: true, institutionId: true },
  });
  if (!role) throw new NotFoundError('Role');
  if (role.institutionId) requirePermission(principal, 'role.manage', { institutionId: role.institutionId });
  else requirePermission(principal, 'role.manage');

  if (role.isSystem) {
    throw new AppError(
      'System roles are maintained by the permission sync, not by hand.',
      409,
      'system_role',
    );
  }

  const permissions = await prisma.permission.findMany({
    where: { key: { in: permissionKeys.filter(isPermissionKey) } },
    select: { id: true },
  });

  await prisma.$transaction([
    prisma.rolePermission.deleteMany({ where: { roleId: role.id } }),
    prisma.rolePermission.createMany({
      data: permissions.map((permission) => ({ roleId: role.id, permissionId: permission.id })),
    }),
  ]);

  await recordAudit(principal, {
    action: 'role.permissions_updated',
    entityType: 'Role',
    entityId: role.id,
    institutionId: role.institutionId,
    after: { permissions: permissions.length },
  });
}

export async function deleteRole(principal: Principal, roleId: string) {
  const role = await prisma.role.findUnique({
    where: { id: roleId },
    select: { id: true, key: true, isSystem: true, institutionId: true, _count: { select: { userRoles: true } } },
  });
  if (!role) throw new NotFoundError('Role');
  if (role.institutionId) requirePermission(principal, 'role.manage', { institutionId: role.institutionId });
  else requirePermission(principal, 'role.manage');

  if (role.isSystem) throw new AppError('System roles cannot be deleted.', 409, 'system_role');
  if (role._count.userRoles > 0) {
    throw new AppError(
      'People still hold this role. Remove it from them first.',
      409,
      'role_in_use',
    );
  }

  await prisma.role.delete({ where: { id: role.id } });

  await recordAudit(principal, {
    action: 'role.deleted',
    entityType: 'Role',
    entityId: role.id,
    institutionId: role.institutionId,
    before: { key: role.key },
  });
}
