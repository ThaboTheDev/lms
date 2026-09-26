/**
 * src/server/services/account.ts
 *
 * What a signed-in person can change about their own account. Changing a
 * password signs out every other session, for the same reason a reset does:
 * if the password changed because somebody else got in, they should not still
 * be signed in afterwards.
 */
import 'server-only';
import { prisma } from '@/lib/db';
import { recordAudit } from '@/lib/audit';
import { AppError, NotFoundError } from '@/lib/errors';
import { checkPasswordPolicy, hashPassword, verifyPassword } from '@/lib/auth/password';
import { readSession } from '@/lib/auth/session';
import type { Principal } from '@/lib/rbac/authorize';

export async function changeOwnPassword(principal: Principal, current: string, next: string, confirm: string) {
  const user = await prisma.user.findUnique({
    where: { id: principal.userId },
    select: { id: true, passwordHash: true, firstName: true, lastName: true, email: true },
  });
  if (!user) throw new NotFoundError('Account');

  if (!user.passwordHash || !(await verifyPassword(user.passwordHash, current))) {
    throw new AppError('That is not your current password.', 422, 'validation_failed', { currentPassword: 'That is not your current password.' });
  }
  if (next !== confirm) {
    throw new AppError('The new passwords do not match.', 422, 'validation_failed', { confirmPassword: 'The new passwords do not match.' });
  }
  if (next === current) {
    throw new AppError('Choose a password you have not been using.', 422, 'validation_failed', { newPassword: 'Choose a password you have not been using.' });
  }
  const policy = checkPasswordPolicy(next, [user.firstName, user.lastName, user.email]);
  if (!policy.ok) {
    throw new AppError(policy.problems[0] ?? 'Choose a stronger password.', 422, 'validation_failed', { newPassword: policy.problems.join(' ') });
  }

  const session = await readSession();
  await prisma.$transaction([
    prisma.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(next), failedLogins: 0, lockedUntil: null } }),
    prisma.session.updateMany({
      where: { userId: user.id, revokedAt: null, ...(session ? { id: { not: session.id } } : {}) },
      data: { revokedAt: new Date() },
    }),
  ]);

  await recordAudit(principal, { action: 'auth.password_changed', entityType: 'User', entityId: user.id, after: { otherSessionsSignedOut: true } });
}

export async function updateOwnProfile(principal: Principal, input: { preferredName?: string; phone?: string }) {
  const preferredName = input.preferredName?.trim().slice(0, 80) || null;
  const phone = input.phone?.trim() || null;
  if (phone && !/^\+?[0-9 ()-]{7,20}$/.test(phone)) {
    throw new AppError('Enter the phone number with digits only, for example +27 82 555 0100.', 422, 'validation_failed', { phone: 'Digits only, for example +27 82 555 0100.' });
  }
  const before = await prisma.user.findUnique({ where: { id: principal.userId }, select: { preferredName: true, phone: true } });
  await prisma.user.update({ where: { id: principal.userId }, data: { preferredName, phone } });
  await recordAudit(principal, { action: 'user.profile_updated', entityType: 'User', entityId: principal.userId, before: before ?? undefined, after: { preferredName, phone } });
}
