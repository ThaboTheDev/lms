import 'server-only';
import { createHash, randomInt } from 'node:crypto';
import { authenticator } from 'otplib';
import { prisma } from '@/lib/db';
import { env } from '@/lib/env';
import { AppError } from '@/lib/errors';

// A 30 second step with one window of tolerance, which covers ordinary clock
// drift on a phone without widening the guessing window meaningfully.
authenticator.options = { step: 30, window: 1 };

export function generateMfaSecret(): string {
  return authenticator.generateSecret();
}

/** The URI a phone reads from the QR code. */
export function mfaUri(email: string, secret: string, institutionName: string): string {
  return authenticator.keyuri(email, `${env.APP_NAME} (${institutionName})`, secret);
}

export function verifyTotp(secret: string, token: string): boolean {
  try {
    return authenticator.verify({ token: token.replace(/\s/g, ''), secret });
  } catch {
    return false;
  }
}

/**
 * Recovery codes are the way back in when the phone is lost, so they are shown
 * once and stored only as hashes: a database leak must not hand an attacker a
 * second factor.
 */
export function generateRecoveryCodes(count = 8): string[] {
  const alphabet = '23456789ABCDEFGHJKMNPQRSTVWXYZ';
  return Array.from({ length: count }, () => {
    const code = Array.from({ length: 10 }, () => alphabet[randomInt(alphabet.length)]).join('');
    return `${code.slice(0, 5)}-${code.slice(5)}`;
  });
}

export function hashRecoveryCode(code: string): string {
  return createHash('sha256')
    .update(`${env.AUTH_SECRET}:recovery:${code.replace(/[^0-9A-Z]/gi, '').toUpperCase()}`)
    .digest('hex');
}

export async function enableMfa(userId: string, secret: string, token: string) {
  if (!verifyTotp(secret, token)) {
    throw new AppError('That code did not match. Check the time on your phone and try again.', 422, 'mfa_invalid');
  }

  const recoveryCodes = generateRecoveryCodes();

  await prisma.user.update({
    where: { id: userId },
    data: {
      mfaEnabled: true,
      mfaSecret: secret,
      mfaRecoveryHashes: recoveryCodes.map(hashRecoveryCode),
    },
  });

  return recoveryCodes;
}

export async function disableMfa(userId: string) {
  await prisma.user.update({
    where: { id: userId },
    data: { mfaEnabled: false, mfaSecret: null, mfaRecoveryHashes: [] },
  });
}

/**
 * Checks a code at sign in. A recovery code is consumed as it is used, so the
 * same one cannot be replayed.
 */
export async function verifySecondFactor(userId: string, token: string): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { mfaEnabled: true, mfaSecret: true, mfaRecoveryHashes: true },
  });
  if (!user?.mfaEnabled || !user.mfaSecret) return true;

  if (verifyTotp(user.mfaSecret, token)) return true;

  const hashed = hashRecoveryCode(token);
  if (user.mfaRecoveryHashes.includes(hashed)) {
    await prisma.user.update({
      where: { id: userId },
      data: { mfaRecoveryHashes: user.mfaRecoveryHashes.filter((entry) => entry !== hashed) },
    });
    return true;
  }

  return false;
}
