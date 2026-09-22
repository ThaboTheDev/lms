import { describe, expect, it } from 'vitest';
import {
  formatApplicationReference,
  formatStudentNumber,
  parseSequence,
} from '@/server/services/reference-format';

describe('institutional references', () => {
  it('pads the student number sequence to five digits', () => {
    expect(formatStudentNumber(2026, 1)).toBe('202600001');
    expect(formatStudentNumber(2026, 13742)).toBe('202613742');
  });

  it('keeps student numbers sortable within a year', () => {
    const numbers = [3, 1, 20, 100].map((n) => formatStudentNumber(2026, n));
    expect([...numbers].sort()).toEqual([
      '202600001', '202600003', '202600020', '202600100',
    ]);
  });

  it('formats an application reference people can quote', () => {
    expect(formatApplicationReference(2026, 42)).toBe('APP-2026-00042');
  });

  it('reads a sequence back out of a reference', () => {
    expect(parseSequence('202600137', '2026')).toBe(137);
    expect(parseSequence('APP-2026-00042', 'APP-2026-')).toBe(42);
    expect(parseSequence('LEGACY-7', '2026')).toBe(0);
  });
});
