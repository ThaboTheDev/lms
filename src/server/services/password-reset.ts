import 'server-only';
import { prisma } from '@/lib/db';
import { env } from '@/lib/env';
import { AppError } from '@/lib/errors';
import { checkPasswordPolicy, hashPassword } from '@/lib/auth/password';
import { consumeToken, issueToken, peekToken } from '@/lib/auth/tokens';
import { revokeAllSessions } from '@/lib/auth/session';
import { mailer, wrapEmail, escapeHtml } from '@/lib/mail';

/**
 * Forgotten passwords, and the same mechanism for a freshly invited person
 * choosing their first one.
 *
 * Asking for a reset always answers the same way, whether or not the address is
 * registered here: a page that says "no such account" is a page that lists the
 * institution's staff and learners to anyone who cares to ask.
 */

const RESET_TTL_MINUTES = 60;

export type PasswordTokenKind = 'invitation' | 'reset';

export interface PasswordTokenView {
  kind: PasswordTokenKind;
  email: string;
  firstName: string;
}

function resetLink(token: string): string {
  return `${env.APP_URL.replace(/\/$/, '')}/reset-password?token=${encodeURIComponent(token)}`;
}

/**
 * Sends a reset link if the address belongs to a live account, and does nothing
 * observable if it does not.
 */
export async function requestPasswordReset(email: string): Promise<void> {
  const address = email.trim().toLowerCase();

  const user = await prisma.user.findFirst({
    where: { email: address, deletedAt: null, status: { not: 'DEACTIVATED' } },
    select: {
      id: true,
      firstName: true,
      email: true,
      institutionId: true,
      institution: {
        select: { name: true, emailFromName: true, emailFromAddress: true, footerText: true },
      },
    },
  });

  if (!user) return;

  const { token } = await issueToken(user.id, 'PASSWORD_RESET', RESET_TTL_MINUTES);
  const link = resetLink(token);
  const institutionName = user.institution?.name ?? env.APP_NAME;

  await mailer.send({
    to: user.email,
    subject: `Reset your ${institutionName} password`,
    html: wrapEmail(
      institutionName,
      'Reset your password',
      `<p style="margin:0 0 16px;font-size:15px;line-height:1.5">Hello ${escapeHtml(user.firstName)},</p>
       <p style="margin:0 0 16px;font-size:15px;line-height:1.5">Somebody asked to reset the password for this account. If it was you, choose a new one below. If it was not, ignore this and the password stays as it is.</p>
       <p style="margin:0 0 16px"><a href="${escapeHtml(link)}" style="color:#0e5c4a">Choose a new password</a></p>
       <p style="margin:0;font-size:13px;color:#5b6b70">The link expires in ${RESET_TTL_MINUTES} minutes and works once.</p>`,
      user.institution?.footerText ?? undefined,
    ),
    text: `Hello ${user.firstName},\n\nSomebody asked to reset the password for this account. If it was you, choose a new one here: ${link}\n\nThe link expires in ${RESET_TTL_MINUTES} minutes and works once.`,
    from:
      user.institution?.emailFromAddress && user.institution?.emailFromName
        ? `${user.institution.emailFromName} <${user.institution.emailFromAddress}>`
        : undefined,
  });
}

/** What the reset page needs to know before it renders a form. */
export async function readPasswordResetToken(token: string): Promise<PasswordTokenView | null> {
  if (!token) return null;

  const record = await peekToken(token, ['PASSWORD_RESET', 'INVITATION']);
  if (!record) return null;

  const user = await prisma.user.findUnique({
    where: { id: record.userId },
    select: { email: true, firstName: true, status: true, deletedAt: true },
  });
  if (!user || user.deletedAt || user.status === 'DEACTIVATED') return null;

  return {
    kind: record.type === 'INVITATION' ? 'invitation' : 'reset',
    email: user.email,
    firstName: user.firstName,
  };
}

/**
 * Sets the password a token was issued for and spends it.
 *
 * Every existing session is revoked, which is the same rule as a password
 * change from the security screen: if the password was reset because somebody
 * else got in, that somebody should not still be signed in afterwards.
 */
export async function completePasswordReset(token: string, password: string): Promise<{ email: string }> {
  const claimed = await consumeToken(token, ['PASSWORD_RESET', 'INVITATION']);
  if (!claimed) {
    throw new AppError(
      'That link has expired or has already been used. Ask for a new one.',
      400,
      'invalid_token',
    );
  }

  const user = await prisma.user.findUnique({
    where: { id: claimed.userId },
    select: { id: true, email: true, firstName: true, lastName: true, status: true, deletedAt: true },
  });
  if (!user || user.deletedAt || user.status === 'DEACTIVATED') {
    throw new AppError('That account is no longer active.', 403, 'forbidden');
  }

  const policy = checkPasswordPolicy(password, [user.firstName, user.lastName, user.email]);
  if (!policy.ok) {
    throw new AppError(policy.problems[0] ?? 'Choose a stronger password.', 422, 'weak_password', {
      problems: policy.problems,
    });
  }

  await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordHash: await hashPassword(password),
      // An invited account has now set a password, so it is no longer invited.
      status: user.status === 'INVITED' ? 'ACTIVE' : user.status,
      failedLogins: 0,
      lockedUntil: null,
    },
  });

  await revokeAllSessions(user.id);

  return { email: user.email };
}
