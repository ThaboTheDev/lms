import { describe, expect, it } from 'vitest';
import {
  DEFAULT_BANDS,
  academicYearSchema,
  bandProblems,
  bandsToLines,
  courseSchema,
  emailTemplateSchema,
  gradingSchemeSchema,
  normaliseCode,
  offeringSchema,
  parseBandLines,
  programmeSchema,
  termProblems,
  termSchema,
  unknownTemplateVariables,
} from '../src/server/services/academic-setup-rules';

const d = (value: string) => new Date(`${value}T00:00:00.000Z`);

describe('codes', () => {
  it.each([
    ['bus 101', 'BUS-101'],
    ['  fac_com  ', 'FAC-COM'],
    ['H.C.B.M', 'HCBM'],
    ['--a--b--', 'A-B'],
  ])('normalises %j to %j', (input, expected) => {
    expect(normaliseCode(input)).toBe(expected);
  });

  it('refuses a code with nothing usable in it', () => {
    const result = courseSchema.safeParse({ code: '***', title: 'Business', credits: 12 });
    expect(result.success).toBe(false);
  });
});

describe('academic years and terms', () => {
  it('labels a year from its number when no label is given', () => {
    const parsed = academicYearSchema.parse({ year: 2027, label: '', startsOn: '2027-01-11', endsOn: '2027-12-10' });
    expect(parsed.label).toBe('2027 academic year');
  });

  it('refuses a year that ends before it starts, or runs for years', () => {
    expect(academicYearSchema.safeParse({ year: 2027, startsOn: '2027-12-01', endsOn: '2027-01-01' }).success).toBe(false);
    expect(academicYearSchema.safeParse({ year: 2027, startsOn: '2027-01-01', endsOn: '2029-01-01' }).success).toBe(false);
  });

  it('keeps a term inside its year and registration inside the term', () => {
    const year = { startsOn: d('2027-01-11'), endsOn: d('2027-12-10') };
    expect(termProblems({ startsOn: d('2027-02-01'), endsOn: d('2027-06-30') }, year)).toEqual([]);
    expect(termProblems({ startsOn: d('2026-12-01'), endsOn: d('2027-06-30') }, year)[0]!.field).toBe('startsOn');
    expect(
      termProblems({ startsOn: d('2027-02-01'), endsOn: d('2027-06-30'), registrationOpensOn: d('2027-01-20'), registrationClosesOn: d('2027-07-30') }),
    ).toHaveLength(1);
  });

  it('accepts a term without a registration window', () => {
    const parsed = termSchema.parse({ academicYearId: 'y', code: 's1', name: 'Semester 1', startsOn: '2027-02-01', endsOn: '2027-06-30', registrationOpensOn: '', registrationClosesOn: '' });
    expect(parsed.code).toBe('S1');
    expect(parsed.registrationOpensOn).toBeUndefined();
  });
});

describe('programmes, courses and deliveries', () => {
  it('needs at least one delivery mode', () => {
    const base = { code: 'HCBM', title: 'Higher Certificate', departmentId: 'd', qualificationId: 'q' };
    expect(programmeSchema.safeParse({ ...base, deliveryModes: [] }).success).toBe(false);
    expect(programmeSchema.parse({ ...base, deliveryModes: ['CONTACT'], durationMonths: '' }).durationMonths).toBeUndefined();
  });

  it('defaults a delivery to section A and open', () => {
    const parsed = offeringSchema.parse({ courseId: 'c', academicTermId: 't', sectionCode: '', capacity: '' });
    expect(parsed).toMatchObject({ sectionCode: 'A', status: 'OPEN', deliveryMode: 'BLENDED' });
    expect(parsed.capacity).toBeUndefined();
  });
});

describe('grade bands', () => {
  it('round-trips the default scale through the text format', () => {
    const { bands, problems } = parseBandLines(bandsToLines(DEFAULT_BANDS));
    expect(problems).toEqual([]);
    expect(bandProblems(bands)).toEqual([]);
    expect(bands).toHaveLength(4);
  });

  it('finds gaps, overlaps and missing ends', () => {
    expect(bandProblems([{ label: 'Pass', minPercent: 50, maxPercent: 100, gradePoint: null, isPass: true }])).toEqual(
      expect.arrayContaining(['Marks below 50 fall in no band.', 'No band is a fail: every mark would pass.']),
    );
    const overlapping = [
      { label: 'Pass', minPercent: 45, maxPercent: 100, gradePoint: null, isPass: true },
      { label: 'Fail', minPercent: 0, maxPercent: 49.99, gradePoint: null, isPass: false },
    ];
    expect(bandProblems(overlapping)).toContain('Fail and Pass overlap.');
    const gappy = [
      { label: 'Pass', minPercent: 55, maxPercent: 100, gradePoint: null, isPass: true },
      { label: 'Fail', minPercent: 0, maxPercent: 49.99, gradePoint: null, isPass: false },
    ];
    expect(bandProblems(gappy)).toContain('Marks between 49.99 and 55 fall in no band.');
  });

  it('explains a badly written line instead of guessing', () => {
    expect(parseBandLines('Distinction, seventy five, 100').problems[0]).toMatch(/numbers/);
    expect(parseBandLines('Pass, 50, 100, 2, maybe').problems[0]).toMatch(/pass" or "fail/);
  });

  it('rejects a scheme whose bands do not form a scale', () => {
    const result = gradingSchemeSchema.safeParse({ name: 'Broken', bands: 'Pass, 50, 100, 2, pass' });
    expect(result.success).toBe(false);
  });
});

describe('email templates', () => {
  it('knows which variables exist', () => {
    expect(unknownTemplateVariables('Hi {{ firstName }}', '{{link}} {{ secret }}')).toEqual(['secret']);
  });

  it('refuses a template that uses a variable nothing fills in', () => {
    const result = emailTemplateSchema.safeParse({ key: 'grade.released', subject: 'Results for {{firstName}}', bodyHtml: '<p>{{ mark }}</p>' });
    expect(result.success).toBe(false);
  });
});
