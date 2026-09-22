import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { env } from './env';

/** URL-safe random token, used for sessions, invitations and verification codes. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/**
 * Tokens are stored as keyed hashes, never in plain text: a database leak must
 * not hand an attacker usable session or reset tokens.
 */
export function hashToken(token: string): string {
  return createHash('sha256').update(`${env.AUTH_SECRET}:${token}`).digest('hex');
}

/** IP addresses are personal information under POPIA, so audit rows keep a hash. */
export function hashIp(ip: string | null | undefined): string | null {
  if (!ip) return null;
  return createHash('sha256').update(`${env.AUTH_SECRET}:ip:${ip}`).digest('hex').slice(0, 32);
}

export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/** Human-readable reference, e.g. CERT-2026-000123. */
export function formatSequence(prefix: string, year: number, sequence: number, width = 6): string {
  return `${prefix}-${year}-${String(sequence).padStart(width, '0')}`;
}
