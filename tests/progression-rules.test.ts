import { describe, expect, it } from 'vitest';
import {
  checkGraduation,
  determineProgression,
  determineStanding,
  summariseCredits,
  DEFAULT_PROGRESSION_POLICY,
  type CourseRecord,
  type CourseResultCode,
} from '@/server/services/progression-rules';

function record(overrides: Partial<CourseRecord> = {}): CourseRecord {
  return {
    courseId: 'c1',
    code: 'BUS101',
    title: 'Introduction to Business Management',
    credits: 20,
    creditsAwarded: 20,
    result: 'PASS',
    finalMark: 62,
    finalGrade: 'Pass',
    yearOfStudy: 1,
    termLabel: 'Semester 1',
    academicYear: 2026,
    attempt: 1,
    ...overrides,
  };
}

const failed = (id: string, code: string, credits = 20, attempt = 1): CourseRecord =>
  record({ courseId: id, code, credits, creditsAwarded: 0, result: 'FAIL', finalMark: 41, finalGrade: 'Fail', attempt });

const passed = (id: string, code: string, credits = 20): CourseRecord =>
  record({ courseId: id, code, credits, creditsAwarded: credits });

describe('credit counting', () => {
  it('counts only resolved results', () => {
    const summary = summariseCredits([
      passed('c1', 'BUS101'),
      failed('c2', 'ACC101'),
      record({ courseId: 'c3', code: 'COM101', result: 'PENDING', creditsAwarded: null }),
    ]);

    expect(summary.earned).toBe(20);
    expect(summary.failed).toBe(20);
    expect(summary.attempted).toBe(40);
    expect(summary.outstanding).toBe(20);
    expect(summary.passRate).toBe(0.5);
  });

  it('does not treat work still being marked as a failure', () => {
    const summary = summariseCredits([
      passed('c1', 'BUS101'),
      record({ courseId: 'c2', code: 'ACC101', result: 'INCOMPLETE', creditsAwarded: null }),
    ]);
    expect(summary.passRate).toBe(1);
    expect(summary.coursesOutstanding).toBe(1);
  });

  it('leaves a withdrawal out of the pass rate entirely', () => {
    const summary = summariseCredits([passed('c1', 'BUS101'), record({ courseId: 'c2', result: 'WITHDRAWN', creditsAwarded: null })]);
    expect(summary.attempted).toBe(20);
    expect(summary.passRate).toBe(1);
  });

  it('honours a credit award that differs from the course credits', () => {
    const summary = summariseCredits([record({ credits: 20, creditsAwarded: 15 })]);
    expect(summary.earned).toBe(15);
  });

  it('counts competency outcomes as passes', () => {
    for (const result of ['COMPETENT', 'PASS_WITH_DISTINCTION'] as CourseResultCode[]) {
      expect(summariseCredits([record({ result })]).earned).toBe(20);
    }
    expect(summariseCredits([record({ result: 'NOT_YET_COMPETENT', creditsAwarded: 0 })]).earned).toBe(0);
  });
});

describe('academic standing', () => {
  const summary = (passRate: number) => ({
    attempted: 100, earned: passRate * 100, failed: 0, outstanding: 0,
    passRate, coursesPassed: 0, coursesFailed: 0, coursesOutstanding: 0,
  });

  it('is good standing above the threshold', () => {
    expect(determineStanding({ summary: summary(0.8) })).toBe('GOOD_STANDING');
  });

  it('never excludes a learner in one step from good standing', () => {
    expect(determineStanding({ summary: summary(0.1), previousStanding: 'GOOD_STANDING' })).toBe('PROBATION');
  });

  it('excludes only after a year already flagged', () => {
    expect(determineStanding({ summary: summary(0.1), previousStanding: 'PROBATION' })).toBe('EXCLUDED');
  });

  it('flags a learner between the thresholds as at risk', () => {
    expect(determineStanding({ summary: summary(0.5) })).toBe('AT_RISK');
  });

  it('reports a graduate as graduated whatever the year looked like', () => {
    expect(determineStanding({ summary: summary(0.2), graduated: true })).toBe('GRADUATED');
  });
});

describe('graduation', () => {
  const requirements = { minimumCredits: 120, compulsoryCourseIds: ['c1', 'c2', 'c3'] };

  it('needs both the credits and every compulsory course', () => {
    const records = [passed('c1', 'BUS101', 40), passed('c2', 'ACC101', 40), passed('c3', 'COM101', 40)];
    expect(checkGraduation(records, requirements).eligible).toBe(true);
  });

  it('refuses a learner who is over the credits but short a required module', () => {
    const records = [passed('c1', 'BUS101', 60), passed('c2', 'ACC101', 60), passed('c9', 'ELE101', 40)];
    const check = checkGraduation(records, requirements);
    expect(check.eligible).toBe(false);
    expect(check.missing.join(' ')).toContain('compulsory');
  });

  it('reports how many credits are short', () => {
    const check = checkGraduation([passed('c1', 'BUS101', 40)], requirements);
    expect(check.creditsShort).toBe(80);
  });

  it('holds back a learner whose last result is still being marked', () => {
    const records = [
      passed('c1', 'BUS101', 40),
      passed('c2', 'ACC101', 40),
      record({ courseId: 'c3', code: 'COM101', credits: 40, result: 'PENDING', creditsAwarded: null }),
    ];
    expect(checkGraduation(records, requirements).eligible).toBe(false);
  });
});

describe('progression decisions', () => {
  const context = {
    yearOfStudy: 1,
    finalYear: false,
    minimumCredits: 120,
    compulsoryCourseIds: ['c1', 'c2', 'c3'],
  };

  it('progresses a learner who passed everything', () => {
    const decision = determineProgression(
      [passed('c1', 'BUS101'), passed('c2', 'ACC101'), passed('c3', 'COM101')],
      context,
    );
    expect(decision.outcome).toBe('PROGRESS');
    expect(decision.mustRepeat).toHaveLength(0);
  });

  it('carries a single failed module forward with conditions', () => {
    const decision = determineProgression(
      [passed('c1', 'BUS101'), passed('c2', 'ACC101'), passed('c4', 'MAN101'), failed('c3', 'COM101')],
      context,
    );
    expect(decision.outcome).toBe('PROGRESS_WITH_CONDITIONS');
    expect(decision.mustRepeat.map((entry) => entry.code)).toEqual(['COM101']);
  });

  it('refuses to carry more credits than the policy allows', () => {
    const decision = determineProgression(
      [passed('c1', 'BUS101', 80), failed('c2', 'ACC101', 30), failed('c3', 'COM101', 30)],
      context,
    );
    expect(decision.outcome).toBe('REPEAT_MODULES');
    expect(decision.carryCredits).toBe(60);
  });

  it('repeats the year when the pass rate collapses', () => {
    const decision = determineProgression(
      [passed('c1', 'BUS101'), failed('c2', 'ACC101'), failed('c3', 'COM101'), failed('c4', 'MAN101')],
      context,
    );
    expect(decision.outcome).toBe('REPEAT_YEAR');
  });

  it('excludes only a learner already on probation', () => {
    const records = [failed('c1', 'BUS101'), failed('c2', 'ACC101'), failed('c3', 'COM101'), passed('c4', 'MAN101', 5)];
    expect(determineProgression(records, context).outcome).toBe('REPEAT_YEAR');
    expect(
      determineProgression(records, { ...context, previousStanding: 'PROBATION' }).outcome,
    ).toBe('EXCLUDE');
  });

  it('does not ask a learner to repeat a course they later passed', () => {
    const decision = determineProgression(
      [failed('c1', 'BUS101', 20, 1), passed('c1', 'BUS101'), passed('c2', 'ACC101'), passed('c3', 'COM101')],
      context,
    );
    expect(decision.mustRepeat).toHaveLength(0);
  });

  it('notes a course that has run out of attempts', () => {
    const decision = determineProgression(
      [passed('c1', 'BUS101', 60), failed('c2', 'ACC101', 20, DEFAULT_PROGRESSION_POLICY.maximumAttemptsPerCourse)],
      context,
    );
    expect(decision.reasons.join(' ')).toContain('without a pass');
  });

  it('graduates a final year learner who has met everything', () => {
    const decision = determineProgression(
      [passed('c1', 'BUS101', 40), passed('c2', 'ACC101', 40), passed('c3', 'COM101', 40)],
      { ...context, finalYear: true, yearOfStudy: 1 },
    );
    expect(decision.outcome).toBe('GRADUATE');
    expect(decision.standing).toBe('GRADUATED');
  });

  it('marks a decision provisional while results are outstanding', () => {
    const decision = determineProgression(
      [passed('c1', 'BUS101'), record({ courseId: 'c2', code: 'ACC101', result: 'PENDING', creditsAwarded: null })],
      context,
    );
    expect(decision.reasons.join(' ')).toContain('provisional');
  });
});
