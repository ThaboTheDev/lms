import { describe, expect, it } from 'vitest';
import {
  checkVerificationCode,
  formatCertificateNumber,
  generateVerificationCode,
  normaliseVerificationCode,
  verificationUrl,
} from '@/server/services/credential-codes';

function bytes(seed: number) {
  return Uint8Array.from(Array.from({ length: 11 }, (_, index) => (seed * 17 + index * 31) % 251));
}

describe('certificate numbers', () => {
  it('uses the institution prefix and pads the sequence', () => {
    expect(formatCertificateNumber('KIHL', 2026, 1)).toBe('KIHL-2026-000001');
    expect(formatCertificateNumber('KIHL', 2026, 142_857)).toBe('KIHL-2026-142857');
  });

  it('cleans a prefix that is not safe to print', () => {
    expect(formatCertificateNumber('ki hl/2', 2026, 7)).toBe('KIHL2-2026-000007');
    expect(formatCertificateNumber('', 2026, 7)).toBe('CERT-2026-000007');
  });
});

describe('verification codes', () => {
  it('produces a grouped twelve character code', () => {
    const code = generateVerificationCode(bytes(3));
    expect(code).toMatch(/^[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/);
  });

  it('accepts a code it generated', () => {
    const code = generateVerificationCode(bytes(9));
    expect(checkVerificationCode(code)).toMatchObject({ valid: true });
  });

  it('accepts the code typed without hyphens or in lower case', () => {
    const code = generateVerificationCode(bytes(11));
    const typed = code.replace(/-/g, '').toLowerCase();
    expect(checkVerificationCode(typed)).toMatchObject({ valid: true, code });
  });

  it('forgives the characters people confuse when reading a printed code', () => {
    // I and L read as 1, O as zero, U as V: "I1LOU0" becomes "1110V0".
    expect(normaliseVerificationCode('I1-LO-U0')).toBe('1110V0');
  });

  it('rejects a mistyped code as malformed rather than as not found', () => {
    const code = generateVerificationCode(bytes(5));
    const body = code.replace(/-/g, '');
    const wrongChecksum = `${body.slice(0, 11)}${body[11] === '0' ? '1' : '0'}`;
    expect(checkVerificationCode(wrongChecksum)).toMatchObject({ valid: false, reason: 'checksum' });
  });

  it('rejects a code of the wrong length', () => {
    expect(checkVerificationCode('ABC-123')).toMatchObject({ valid: false, reason: 'length' });
  });

  it('builds the verification address printed on the certificate', () => {
    expect(verificationUrl('https://kopano.example.ac.za/', 'ABCD-1234-EFGH')).toBe(
      'https://kopano.example.ac.za/verify/ABCD-1234-EFGH',
    );
  });
});
