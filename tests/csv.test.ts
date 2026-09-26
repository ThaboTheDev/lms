import { describe, expect, it } from 'vitest';
import { csvFilename, toCsv } from '../src/lib/csv';

describe('toCsv', () => {
  it('quotes what needs quoting and nothing else', () => {
    const csv = toCsv(['name', 'note'], [['Mokoena, Lerato', 'said "hi"'], ['Plain', 'multi\nline']]);
    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(csv).toContain('"Mokoena, Lerato","said ""hi"""');
    expect(csv).toContain('Plain,"multi\nline"');
    expect(csv.endsWith('\r\n')).toBe(true);
  });

  it('defuses formulas typed into text fields but leaves numbers alone', () => {
    const csv = toCsv(['a', 'b', 'c'], [['=HYPERLINK("x")', -12.5, '@SUM(A1)']]);
    expect(csv).toContain(`"'=HYPERLINK(""x"")"`);
    expect(csv).toContain(',-12.5,');
    expect(csv).toContain("'@SUM(A1)");
  });

  it('writes empty cells for missing values and ISO dates for dates', () => {
    expect(toCsv(['x', 'y', 'z'], [[null, undefined, new Date('2026-03-04T10:00:00Z')]])).toContain(',,2026-03-04');
  });
});

describe('csvFilename', () => {
  it('is safe and dated', () => {
    expect(csvFilename('Headcount by programme', new Date('2026-09-25T12:00:00Z'))).toBe('headcount-by-programme-2026-09-25.csv');
  });
});
