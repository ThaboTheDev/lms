import 'server-only';
import type { TokenType } from '@prisma/client';
import { prisma } from '@/lib/db';
import { hashToken, randomToken } from '@/lib/crypto';

/**
 * Single-use tokens for things a signed-out person has to be able to do: set a
 * password from an invitation, or reset one they have forgotten.
 *
 * Only the hash of a token is stored, so a database leak yields nothing that
 * can be replayed - the same reason session tokens are stored hashed. A token
 * is spent the moment it is used, and issuing a new one of a kind retires the
 * others, so a second reset link cannot be sitting in an inbox afterwards.
 */
export interface IssuedToken {
  /** The value to put in the email. It is not recoverable from the database. */
  token: string;
  expiresAt: Date;
}

/** How long each kind of token stays usable, in minutes. */
const TTL_MINUTES: Record<TokenType, number> = {
  EMAIL_VERIFICATION: 60 * 24,
  INVITATION: 60 * 24 * 7,
  PASSWORD_RESET: 60,
  MFA_CHALLENGE: 10,
};

export async function issueToken(
  userId: string,
  type: TokenType,
  ttlMinutes?: number,
): Promise<IssuedToken> {
  const expiresAt = new Date(Date.now() + (ttlMinutes ?? TTL_MINUTES[type]) * 60_000);

  await prisma.authToken.deleteMany({ where: { userId, type, usedAt: null } });

  const token = randomToken(32);
  await prisma.authToken.create({
    data: { userId, type, tokenHash: hashToken(token), expiresAt },
  });

  return { token, expiresAt };
}

/**
 * Looks a token up without spending it, so a page can decide what to show
 * before the person has committed to anything. The same three failures read the
 * same way: unknown, used and expired all return null.
 */
export async function peekToken(
  token: string,
  types: TokenType | TokenType[],
): Promise<{ userId: string; type: TokenType } | null> {
  if (!token) return null;
  const accepted = Array.isArray(types) ? types : [types];

  const record = await prisma.authToken.findUnique({
    where: { tokenHash: hashToken(token) },
    select: { userId: true, type: true, expiresAt: true, usedAt: true },
  });

  if (!record || !accepted.includes(record.type)) return null;
  if (record.usedAt || record.expiresAt <= new Date()) return null;

  return { userId: record.userId, type: record.type };
}

/**
 * Spends a token. Returns the account it belongs to, or null when the token is
 * unknown, already used or expired - all three are the same answer to the
 * person holding the link, because saying which would tell them whether the
 * address is registered here.
 *
 * Several types may be accepted, because setting a password is the same act
 * whether the person arrived from an invitation or from a forgotten-password
 * request.
 */
export async function consumeToken(
  token: string,
  types: TokenType | TokenType[],
): Promise<{ userId: string; type: TokenType } | null> {
  if (!token) return null;
  const accepted = Array.isArray(types) ? types : [types];

  const record = await prisma.authToken.findUnique({
    where: { tokenHash: hashToken(token) },
    select: { id: true, userId: true, type: true, expiresAt: true, usedAt: true },
  });

  if (!record || !accepted.includes(record.type)) return null;
  if (record.usedAt || record.expiresAt <= new Date()) return null;

  // One winner only: the update is the claim, and a second submission finds no
  // row left to claim.
  const claimed = await prisma.authToken.updateMany({
    where: { id: record.id, usedAt: null },
    data: { usedAt: new Date() },
  });

  return claimed.count === 1 ? { userId: record.userId, type: record.type } : null;
}
