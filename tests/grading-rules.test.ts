import { describe, expect, it } from 'vitest';
import {
  applyGradeBands,
  applyLatePenalty,
  calculateCourseMark,
  calculateGpa,
  checkWeighting,
  scoreRubric,
  toCompetency,
  toPercent,
} from '@/server/services/grading-rules';

const bands = [
  { label: 'Distinction', minPercent: 75, maxPercent: 100, gradePoint: 4, isPass: true },
  { label: 'Merit', minPercent: 65, maxPercent: 74.99, gradePoint: 3, isPass: true },
  { label: 'Pass', minPercent: 50, maxPercent: 64.99, gradePoint: 2, isPass: true },
  { label: 'Fail', minPercent: 0, maxPercent: 49.99, gradePoint: 0, isPass: false },
];

describe('banding', () => {
  it('puts a mark in the right band', () => {
    expect(applyGradeBands(82, bands)?.label).toBe('Distinction');
    expect(applyGradeBands(65, bands)?.label).toBe('Merit');
    expect(applyGradeBands(49.99, bands)?.isPass).toBe(false);
  });

  it('treats a boundary as belonging to the higher band', () => {
    expect(applyGradeBands(75, bands)?.label).toBe('Distinction');
    expect(applyGradeBands(50, bands)?.label).toBe('Pass');
  });

  it('converts a mark to a percentage', () => {
    expect(toPercent(37, 50)).toBe(74);
    expect(toPercent(0, 0)).toBe(0);
  });
});

describe('late penalties', () => {
  const dueAt = new Date('2026-04-10T23:59:00Z');
  const rule = { allowLate: true, latePenaltyPct: 10, dueAt, closesAt: new Date('2026-04-17T23:59:00Z') };

  it('leaves an on time submission alone', () => {
    const result = applyLatePenalty(40, new Date('2026-04-10T10:00:00Z'), rule);
    expect(result.isLate).toBe(false);
    expect(result.finalMark).toBe(40);
  });

  it('counts a part day as a full day', () => {
    const result = applyLatePenalty(40, new Date('2026-04-11T00:30:00Z'), rule);
    expect(result.daysLate).toBe(1);
    expect(result.finalMark).toBe(36);
  });

  it('compounds by day', () => {
    expect(applyLatePenalty(40, new Date('2026-04-13T12:00:00Z'), rule).finalMark).toBe(28);
  });

  it('never pushes a mark below zero', () => {
    const harsh = { ...rule, latePenaltyPct: 60 };
    expect(applyLatePenalty(40, new Date('2026-04-14T12:00:00Z'), harsh).finalMark).toBe(0);
  });

  it('rejects a submission after the closing date', () => {
    const result = applyLatePenalty(40, new Date('2026-04-20T00:00:00Z'), rule);
    expect(result.rejected).toBe(true);
    expect(result.finalMark).toBe(0);
  });

  it('rejects a late submission where late work is not accepted', () => {
    const strict = { allowLate: false, dueAt, closesAt: null };
    expect(applyLatePenalty(40, new Date('2026-04-11T00:01:00Z'), strict).rejected).toBe(true);
  });
});

describe('rubrics', () => {
  const criteria = [
    { id: 'c1', title: 'Argument', weight: 3, maxScore: 10 },
    { id: 'c2', title: 'Evidence', weight: 2, maxScore: 10 },
    { id: 'c3', title: 'Referencing', weight: 1, maxScore: 5 },
  ];

  it('weights the criteria rather than averaging them', () => {
    const result = scoreRubric(criteria, [
      { criterionId: 'c1', score: 10 },
      { criterionId: 'c2', score: 5 },
      { criterionId: 'c3', score: 0 },
    ]);
    expect(result.percent).toBe(66.67);
  });

  it('clamps a score above the criterion maximum', () => {
    const result = scoreRubric([criteria[0]!], [{ criterionId: 'c1', score: 99 }]);
    expect(result.percent).toBe(100);
  });

  it('reports criteria the assessor has not scored yet', () => {
    const result = scoreRubric(criteria, [{ criterionId: 'c1', score: 8 }]);
    expect(result.missing).toEqual(['Evidence', 'Referencing']);
  });
});

describe('course marks', () => {
  const results = [
    { assessmentId: 'a1', title: 'Assignment', weight: 40, maxMark: 50, mark: 40, released: true },
    { assessmentId: 'a2', title: 'Examination', weight: 60, maxMark: 100, mark: null, released: false },
  ];

  it('counts only what has been marked, and says so', () => {
    const mark = calculateCourseMark(results);
    expect(mark.percent).toBe(80);
    expect(mark.provisional).toBe(true);
    expect(mark.weightOutstanding).toBe(60);
  });

  it('does not treat unmarked work as a zero', () => {
    const asZero = (40 * 0.4) / 1;
    expect(calculateCourseMark(results).percent).not.toBe(asZero);
  });

  it('completes once every weighted assessment is in', () => {
    const complete = calculateCourseMark([
      results[0]!,
      { ...results[1]!, mark: 55 },
    ]);
    expect(complete.percent).toBe(65);
    expect(complete.complete).toBe(true);
    expect(complete.provisional).toBe(false);
  });

  it('returns nothing rather than zero when no work is marked', () => {
    expect(calculateCourseMark([{ ...results[1]! }]).percent).toBeNull();
  });

  it('flags an assessment plan that does not add up', () => {
    expect(checkWeighting([{ title: 'Test', weight: 40 }])[0]).toContain('not 100%');
    expect(checkWeighting([{ title: 'A', weight: 40 }, { title: 'B', weight: 60 }])).toHaveLength(0);
    expect(checkWeighting([])[0]).toContain('No assessments');
  });
});

describe('progression arithmetic', () => {
  it('weights the grade point average by credits', () => {
    const gpa = calculateGpa([
      { credits: 20, gradePoint: 4 },
      { credits: 10, gradePoint: 1 },
    ]);
    expect(gpa).toBe(3);
  });

  it('ignores courses with no grade point yet', () => {
    expect(calculateGpa([{ credits: 20, gradePoint: null }])).toBeNull();
  });

  it('records competency as an outcome rather than a mark', () => {
    expect(toCompetency(72, 50)).toBe('COMPETENT');
    expect(toCompetency(49, 50)).toBe('NOT_YET_COMPETENT');
  });
});
