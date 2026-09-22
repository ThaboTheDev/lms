'use server';

import { redirect } from 'next/navigation';
import type { Route } from 'next';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { env } from '@/lib/env';
import { hashIp } from '@/lib/crypto';
import { verifyPassword, hashPassword, needsRehash } from '@/lib/auth/password';
import { createSession, readClientContext } from '@/lib/auth/session';
import { rateLimit, resetRateLimit } from '@/lib/rate-limit';

const schema = z.object({
  email: z.string().email('Enter a valid email address.'),
  password: z.string().min(1, 'Enter your password.'),
  redirectTo: z.string().optional(),
});

export interface LoginState {
  error?: string;
  fieldErrors?: Partial<Record<'email' | 'password', string>>;
}

function isNextRedirect(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'digest' in error &&
    String((error as { digest?: unknown }).digest).startsWith('NEXT_REDIRECT')
  );
}

export async function signIn(_prev: LoginState, formData: FormData): Promise<LoginState> {
  try {
    return await attemptSignIn(formData);
  } catch (error) {
    // redirect() throws. Anything else is a store or runtime failure, and the
    // form should say so rather than leave the person on an error page.
    if (isNextRedirect(error)) throw error;
    console.error('[auth] sign-in failed', error);
    return { error: 'Sign in is unavailable right now. Try again in a few minutes.' };
  }
}

async function attemptSignIn(formData: FormData): Promise<LoginState> {
  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    const flat = parsed.error.flatten().fieldErrors;
    return {
      fieldErrors: {
        email: flat.email?.[0],
        password: flat.password?.[0],
      },
    };
  }

  const { email, password, redirectTo } = parsed.data;
  const context = await readClientContext();
  const ipKey = hashIp(context.ipAddress) ?? 'unknown';

  const limit = await rateLimit(`login:${ipKey}`, env.LOGIN_MAX_ATTEMPTS, env.LOGIN_LOCKOUT_MINUTES * 60);
  if (!limit.allowed) {
    return { error: 'Too many sign in attempts. Wait a few minutes and try again.' };
  }

  const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
  const genericFailure: LoginState = {
    error: 'That email address and password combination is not recognised.',
  };

  async function recordAttempt(success: boolean, reason?: string) {
    await prisma.loginAttempt.create({
      data: { email: email.toLowerCase(), ipHash: ipKey, success, reason },
    });
  }

  if (!user || !user.passwordHash || user.deletedAt) {
    await recordAttempt(false, 'unknown_account');
    return genericFailure;
  }

  if (user.lockedUntil && user.lockedUntil > new Date()) {
    await recordAttempt(false, 'locked');
    return { error: 'This account is temporarily locked. Try again later or contact your administrator.' };
  }

  const valid = await verifyPassword(user.passwordHash, password);

  if (!valid) {
    const failedLogins = user.failedLogins + 1;
    const shouldLock = failedLogins >= env.LOGIN_MAX_ATTEMPTS;
    await prisma.user.update({
      where: { id: user.id },
      data: {
        failedLogins,
        lockedUntil: shouldLock ? new Date(Date.now() + env.LOGIN_LOCKOUT_MINUTES * 60_000) : null,
      },
    });
    await recordAttempt(false, 'bad_password');
    return genericFailure;
  }

  if (user.status !== 'ACTIVE') {
    await recordAttempt(false, `status_${user.status.toLowerCase()}`);
    return genericFailure;
  }

  // Argon2 parameters are raised over time; re-hash quietly on a good password.
  const data: Record<string, unknown> = {
    failedLogins: 0,
    lockedUntil: null,
    lastLoginAt: new Date(),
  };
  if (needsRehash(user.passwordHash)) data.passwordHash = await hashPassword(password);
  await prisma.user.update({ where: { id: user.id }, data });

  await recordAttempt(true);
  await resetRateLimit(`login:${ipKey}`);
  await createSession(user.id, context, !user.mfaEnabled);

  // Only a path inside this application is honoured, so a crafted `next` cannot
  // send a signed-in person off to somebody else's site. What is left is a
  // string typed routes cannot check, because where it points is decided by the
  // request rather than by this file.
  const safeRedirect = redirectTo && redirectTo.startsWith('/') ? redirectTo : '/dashboard';

  // A session for an account with a second factor exists but may do nothing
  // until the code is presented, so it goes to the verification step rather
  // than to the destination.
  if (user.mfaEnabled) {
    redirect(`/login/verify?next=${encodeURIComponent(safeRedirect)}`);
  }

  redirect(safeRedirect as Route);
}
