import { hash, verify } from '@node-rs/argon2';

/**
 * Argon2id with parameters in line with current OWASP guidance. Argon2 encodes
 * its own parameters in the hash string, so raising these later re-hashes
 * transparently on the next successful sign in (see needsRehash).
 */
const OPTIONS = {
  memoryCost: 19456, // 19 MiB
  timeCost: 2,
  parallelism: 1,
} as const;

export function hashPassword(plain: string): Promise<string> {
  return hash(plain, OPTIONS);
}

export async function verifyPassword(digest: string, plain: string): Promise<boolean> {
  try {
    return await verify(digest, plain);
  } catch {
    return false;
  }
}

export function needsRehash(digest: string): boolean {
  return !digest.startsWith('$argon2id$') || !digest.includes(`m=${OPTIONS.memoryCost}`);
}

export interface PasswordPolicyResult {
  ok: boolean;
  problems: string[];
}

/**
 * Length first, then variety. Long passphrases beat short complex strings, so
 * the policy rewards length rather than forcing symbol soup.
 */
export function checkPasswordPolicy(password: string, context: string[] = []): PasswordPolicyResult {
  const problems: string[] = [];
  if (password.length < 12) problems.push('Use at least 12 characters.');
  if (password.length < 20) {
    if (!/[a-z]/.test(password)) problems.push('Include a lowercase letter.');
    if (!/[A-Z]/.test(password)) problems.push('Include an uppercase letter.');
    if (!/[0-9]/.test(password)) problems.push('Include a number.');
  }
  const lowered = password.toLowerCase();
  if (context.some((value) => value && lowered.includes(value.toLowerCase()))) {
    problems.push('Do not reuse your name, email address or student number.');
  }
  return { ok: problems.length === 0, problems };
}
