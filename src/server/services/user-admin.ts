import 'server-only';
import { sendInvitation } from './outbound';
import { prisma } from '@/lib/db';
import { AppError, NotFoundError, AuthorisationError } from '@/lib/errors';
import { recordAudit } from '@/lib/audit';
import { hashPassword } from '@/lib/auth/password';
import { randomToken } from '@/lib/crypto';
import { requirePermission, requireSameInstitution, type Principal, can } from '@/lib/rbac/authorize';

/**
 * Staff accounts: inviting them, reading one, suspending one, and granting or
 * revoking the roles that decide what they can reach.
 *
 * An account is never created with a password this institution has to deliver
 * over the phone. It is created INVITED with a random password nobody knows,
 * and the person sets their own from a single-use link - which is also why the
 * audit trail for granting a role matters more than the audit trail for a
 * profile field.
 */

export interface PersonDetail {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  status: string;
  mfaEnabled: boolean;
  lastLoginAt: Date | null;
  createdAt: Date;
  institutionId: string | null;
}

/** Roles an administrator at this institution may grant. */
export async function listAssignableRoles(principal: Principal) {
  const institutionId = principal.institutionId;
  if (!institutionId) throw new NotFoundError('Institution');

  return prisma.role.findMany({
    where: { OR: [{ institutionId: null }, { institutionId }] },
    orderBy: [{ isSystem: 'desc' }, { name: 'asc' }],
    select: { id: true, key: true, name: true, isSystem: true },
  });
}

export async function getPerson(principal: Principal, userId: string) {
  requirePermission(principal, 'user.read');

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      preferredName: true,
      phone: true,
      status: true,
      mfaEnabled: true,
      lastLoginAt: true,
      emailVerifiedAt: true,
      createdAt: true,
      institutionId: true,
      userRoles: {
        select: {
          id: true,
          roleId: true,
          createdAt: true,
          scopeType: true,
          scopeId: true,
          expiresAt: true,
          role: { select: { key: true, name: true, isSystem: true } },
        },
        orderBy: { createdAt: 'asc' },
      },
      studentProfile: { select: { id: true, studentNumber: true } },
    },
  });

  if (!user) throw new NotFoundError('Person');
  if (user.institutionId) requireSameInstitution(principal, user.institutionId);

  return user;
}

export async function inviteUser(
  principal: Principal,
  input: { firstName: string; lastName: string; email: string; roleIds: string[] },
) {
  const institutionId = principal.institutionId;
  if (!institutionId) throw new NotFoundError('Institution');
  requirePermission(principal, 'user.manage', { institutionId });

  const email = input.email.trim().toLowerCase();
  const firstName = input.firstName.trim();
  const lastName = input.lastName.trim();

  if (firstName.length < 2 || lastName.length < 2) {
    throw new AppError("Enter the person's first and last name.", 422, 'validation_failed');
  }

  const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (existing) {
    throw new AppError('Somebody already uses that email address.', 409, 'duplicate_email');
  }

  const roles = input.roleIds.length
    ? await prisma.role.findMany({
        where: { id: { in: input.roleIds }, OR: [{ institutionId: null }, { institutionId }] },
        select: { id: true, name: true },
      })
    : [];


  // A password nobody knows. The account cannot be signed into until the
  // invitation link has been used to set one.
  const placeholder = await hashPassword(randomToken(24));

  const user = await prisma.user.create({
    data: {
      institutionId,
      email,
      firstName,
      lastName,
      passwordHash: placeholder,
      status: 'INVITED',
      userRoles: {
        create: roles.map((role) => ({
          roleId: role.id,
          institutionId,
          scopeType: 'INSTITUTION' as const,
          grantedById: principal.userId,
        })),
      },
    },
    select: { id: true, email: true, firstName: true },
  });

  await sendInvitation(user.id, principal.displayName);

  await recordAudit(principal, {
    action: 'user.invited',
    entityType: 'User',
    entityId: user.id,
    institutionId,
    after: { email: user.email, roles: roles.map((role) => role.name) },
  });

  return user;
}

/** Suspended accounts keep their records and lose their access. */
export async function setPersonStatus(
  principal: Principal,
  userId: string,
  status: 'ACTIVE' | 'SUSPENDED',
) {
  requirePermission(principal, 'user.manage');

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, status: true, institutionId: true, email: true },
  });
  if (!user) throw new NotFoundError('Person');
  if (user.institutionId) requireSameInstitution(principal, user.institutionId);

  const updated = await prisma.user.update({
    where: { id: userId },
    data: { status, lockedUntil: status === 'SUSPENDED' ? null : undefined },
    select: { id: true, status: true },
  });

  await recordAudit(principal, {
    action: status === 'SUSPENDED' ? 'user.suspended' : 'user.reactivated',
    entityType: 'User',
    entityId: userId,
    institutionId: user.institutionId,
    before: { status: user.status },
    after: { status: updated.status, email: user.email },
  });

  return updated;
}

export interface GrantOptions {
  /** Where the role applies. Institution-wide unless a programme or a course delivery is given. */
  scopeType?: 'INSTITUTION' | 'PROGRAMME' | 'COURSE';
  scopeId?: string | null;
  /** An external examiner's access ends when the moderation does. */
  expiresAt?: Date | null;
}

export async function grantRole(principal: Principal, userId: string, roleId: string, options: GrantOptions = {}) {
  requirePermission(principal, 'role.assign');
  const [user, role] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, institutionId: true, email: true },
    }),
    prisma.role.findUnique({ where: { id: roleId }, select: { id: true, key: true, name: true, institutionId: true } }),
  ]);
  if (!user) throw new NotFoundError('Person');
  if (!role) throw new NotFoundError('Role');
  if (user.institutionId) requireSameInstitution(principal, user.institutionId);
  if (role.institutionId && role.institutionId !== user.institutionId) {
    throw new AppError('That role belongs to another institution.', 403, 'forbidden');
  }

  const scopeType = options.scopeType ?? 'INSTITUTION';
  const scopeId = scopeType === 'INSTITUTION' ? null : options.scopeId || null;
  let scopeLabel = 'the whole institution';
  if (scopeType !== 'INSTITUTION') {
    if (!scopeId) throw new AppError('Choose where the role applies.', 422, 'validation_failed', { scopeId: 'Choose where the role applies.' });
    const target =
      scopeType === 'PROGRAMME'
        ? await prisma.programme.findFirst({ where: { id: scopeId, institutionId: user.institutionId ?? undefined }, select: { code: true } })
        : await prisma.courseOffering.findFirst({ where: { id: scopeId, institutionId: user.institutionId ?? undefined }, select: { course: { select: { code: true } }, sectionCode: true } });
    if (!target) throw new AppError('That programme or course is not at this institution.', 422, 'validation_failed', { scopeId: 'Not at this institution.' });
    scopeLabel = 'code' in target ? target.code : `${target.course.code} ${target.sectionCode}`;
  }
  if (options.expiresAt && options.expiresAt <= new Date()) {
    throw new AppError('The expiry date has to be in the future.', 422, 'validation_failed', { expiresAt: 'Has to be in the future.' });
  }

  const existing = await prisma.userRole.findFirst({ where: { userId, roleId, scopeType, scopeId }, select: { id: true } });
  if (existing) throw new AppError('They already hold that role there.', 409, 'duplicate_grant');

  const grant = await prisma.userRole.create({
    data: {
      userId,
      roleId,
      institutionId: user.institutionId,
      scopeType,
      scopeId,
      expiresAt: options.expiresAt ?? null,
      grantedById: principal.userId,
    },
    select: { id: true },
  });

  await recordAudit(principal, {
    action: 'role.granted',
    entityType: 'UserRole',
    entityId: grant.id,
    institutionId: user.institutionId,
    after: { user: user.email, role: role.key, scope: scopeLabel, expiresAt: options.expiresAt?.toISOString() ?? null },
  });

  return grant;
}

/** Sends a fresh invitation link to somebody who has not set a password yet. */
export async function resendInvitation(principal: Principal, userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, institutionId: true, status: true, email: true, studentProfile: { select: { id: true } } },
  });
  if (!user) throw new NotFoundError('Person');
  if (user.institutionId) requireSameInstitution(principal, user.institutionId);
  // Staff invitations belong to whoever manages people; a learner's can also
  // come from the registry that registered them.
  const scope = { institutionId: user.institutionId ?? '' };
  if (!(can(principal, 'user.manage', scope) || (user.studentProfile && can(principal, 'student.manage', scope)))) {
    throw new AuthorisationError();
  }
  if (user.status !== 'INVITED') throw new AppError('They have already set a password; they can use "Forgot your password?" if they need a new one.', 409, 'not_invited');
  await sendInvitation(user.id, principal.displayName);
  await recordAudit(principal, { action: 'user.invitation_resent', entityType: 'User', entityId: user.id, institutionId: user.institutionId, after: { email: user.email } });
}

export async function revokeRole(principal: Principal, userId: string, roleId: string) {
  requirePermission(principal, 'role.assign');

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, institutionId: true, email: true, userRoles: { select: { id: true, roleId: true } } },
  });
  if (!user) throw new NotFoundError('Person');
  if (user.institutionId) requireSameInstitution(principal, user.institutionId);

  const grant = user.userRoles.find((entry) => entry.roleId === roleId);
  if (!grant) throw new NotFoundError('Role grant');

  await prisma.userRole.delete({ where: { id: grant.id } });

  await recordAudit(principal, {
    action: 'role.revoked',
    entityType: 'UserRole',
    entityId: grant.id,
    institutionId: user.institutionId,
    before: { userId, roleId, email: user.email },
  });
}
