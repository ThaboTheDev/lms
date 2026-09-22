/**
 * Certificate numbering and verification codes. Pure so the format can be
 * tested and reproduced: a certificate issued today must still verify in twenty
 * years, which means the code format cannot be an implementation detail buried
 * in a service.
 */

/** Crockford base 32: no I, L, O or U, so a handwritten code is unambiguous. */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export function formatCertificateNumber(prefix: string, year: number, sequence: number): string {
  const safePrefix = prefix.replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 8) || 'CERT';
  return `${safePrefix}-${year}-${String(sequence).padStart(6, '0')}`;
}

function checksum(body: string): string {
  let total = 0;
  for (let i = 0; i < body.length; i += 1) {
    const value = ALPHABET.indexOf(body[i]!);
    if (value >= 0) total = (total * 31 + value) % ALPHABET.length;
  }
  return ALPHABET[total]!;
}

/**
 * A verification code is long enough that it cannot be guessed and short enough
 * to read off a printed page. The last character is a checksum, so a mistyped
 * code is rejected as malformed rather than reported as "no such certificate",
 * which would otherwise look like a forgery to whoever is checking.
 */
export function generateVerificationCode(randomBytes: Uint8Array): string {
  const body = Array.from(randomBytes.slice(0, 11))
    .map((byte) => ALPHABET[byte % ALPHABET.length]!)
    .join('');
  const code = `${body}${checksum(body)}`;
  return `${code.slice(0, 4)}-${code.slice(4, 8)}-${code.slice(8, 12)}`;
}

export function normaliseVerificationCode(input: string): string {
  return input
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, '')
    .replace(/I/g, '1')
    .replace(/L/g, '1')
    .replace(/O/g, '0')
    .replace(/U/g, 'V');
}

export type CodeCheck =
  | { valid: true; code: string }
  | { valid: false; reason: 'length' | 'checksum' | 'characters' };

export function checkVerificationCode(input: string): CodeCheck {
  const normalised = normaliseVerificationCode(input);

  if (normalised.length !== 12) return { valid: false, reason: 'length' };
  if ([...normalised].some((character) => !ALPHABET.includes(character))) {
    return { valid: false, reason: 'characters' };
  }

  const body = normalised.slice(0, 11);
  const given = normalised.slice(11);
  if (checksum(body) !== given) return { valid: false, reason: 'checksum' };

  return { valid: true, code: `${normalised.slice(0, 4)}-${normalised.slice(4, 8)}-${normalised.slice(8, 12)}` };
}

/** The verification URL printed on the certificate, next to the QR code. */
export function verificationUrl(appUrl: string, code: string): string {
  return `${appUrl.replace(/\/$/, '')}/verify/${encodeURIComponent(code)}`;
}
