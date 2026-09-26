import 'server-only';
import { cookies, headers } from 'next/headers';
import { prisma } from '@/lib/db';
import { env } from '@/lib/env';
import { hashToken, randomToken } from '@/lib/crypto';

export const SESSION_COOKIE = 'lms_session';

function cookieOptions(expiresAt: Date) {
  return {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    expires: expiresAt,
  };
}

/**
 * Must match the options the session cookie was set with, including path.
 * `cookies().delete(name)` omits the path, so the browser keeps the original
 * cookie and the next request still looks signed in.
 */
export function sessionCookieClearOptions() {
  return {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    maxAge: 0,
    expires: new Date(0),
  };
}

export interface ClientContext {
  ipAddress: string | null;
  userAgent: string | null;
}

export async function readClientContext(): Promise<ClientContext> {
  let h: Awaited<ReturnType<typeof headers>>;
  try {
    h = await headers();
  } catch {
    // Outside a request (the worker, a script): there is no client to describe.
    return { ipAddress: null, userAgent: null };
  }
  const forwarded = h.get('x-forwarded-for');
  return {
    ipAddress: forwarded?.split(',')[0]?.trim() ?? h.get('x-real-ip'),
    userAgent: h.get('user-agent'),
  };
}

/** Issues a new opaque session token and stores only its hash. */
export async function createSession(userId: string, context: ClientContext, mfaVerified = false) {
  const token = randomToken(32);
  const expiresAt = new Date(Date.now() + env.SESSION_TTL_HOURS * 3600_000);

  await prisma.session.create({
    data: {
      userId,
      tokenHash: hashToken(token),
      ipAddress: context.ipAddress,
      userAgent: context.userAgent?.slice(0, 512),
      expiresAt,
      mfaVerified,
    },
  });

  const store = await cookies();
  store.set(SESSION_COOKIE, token, cookieOptions(expiresAt));
  return { token, expiresAt };
}

/**
 * Resolves the current session and enforces both absolute expiry and the idle
 * timeout. Touching lastSeenAt on every request would be a write per page view,
 * so it is only refreshed once a minute.
 */
export async function readSession() {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: true },
  });

  if (!session || session.revokedAt || session.expiresAt <= new Date()) return null;

  const idleLimitMs = env.SESSION_IDLE_TIMEOUT_MINUTES * 60_000;
  if (Date.now() - session.lastSeenAt.getTime() > idleLimitMs) {
    await prisma.session.update({
      where: { id: session.id },
      data: { revokedAt: new Date() },
    });
    return null;
  }

  if (Date.now() - session.lastSeenAt.getTime() > 60_000) {
    await prisma.session.update({ where: { id: session.id }, data: { lastSeenAt: new Date() } });
  }

  if (session.user.status !== 'ACTIVE' || session.user.deletedAt) return null;

  return session;
}

/**
 * A session that has passed its second factor, which is what every
 * authenticated page needs. A session waiting on a code is a real session, but
 * it may do nothing except present that code.
 */
export async function readVerifiedSession() {
  const session = await readSession();
  if (!session) return null;
  if (session.user.mfaEnabled && !session.mfaVerified) return null;
  return session;
}

/** Marks the current session as having passed its second factor. */
export async function markSessionVerified() {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return;

  await prisma.session.updateMany({
    where: { tokenHash: hashToken(token), revokedAt: null },
    data: { mfaVerified: true },
  });
}

export async function destroyCurrentSession() {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) {
    await prisma.session.updateMany({
      where: { tokenHash: hashToken(token), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
  store.set(SESSION_COOKIE, '', sessionCookieClearOptions());
}

/** Used after a password change or a suspected compromise. */
export async function revokeAllSessions(userId: string) {
  await prisma.session.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}
