import { describe, expect, it } from 'vitest';
import {
  assessRisk,
  describeTrend,
  scoreEngagement,
  suppressSmallGroups,
  MINIMUM_GROUP_SIZE,
  type RiskInput,
} from '@/server/services/analytics-rules';
import { assessErasure, decideRetention, RETENTION_RULES } from '@/server/services/retention-rules';

const engagement = (overrides = {}) =>
  scoreEngagement({
    lessonsAvailable: 10,
    lessonsCompleted: 8,
    learningMinutes: 180,
    daysSinceLastActivity: 2,
    discussionPosts: 3,
    ...overrides,
  });

describe('engagement', () => {
  it('scores a learner keeping up as active', () => {
    expect(engagement().band).toBe('active');
  });

  it('scores a learner who has stopped opening the course as inactive', () => {
    const result = engagement({ lessonsCompleted: 1, learningMinutes: 10, daysSinceLastActivity: 30 });
    expect(result.band).toBe('inactive');
  });

  it('says it does not know when nothing has been published', () => {
    const result = scoreEngagement({
      lessonsAvailable: 0,
      lessonsCompleted: 0,
      learningMinutes: 0,
      daysSinceLastActivity: null,
      discussionPosts: 0,
    });
    expect(result.band).toBe('unknown');
  });

  it('always shows what the score was built from', () => {
    const result = engagement();
    expect(result.components.map((component) => component.label)).toContain('Lessons completed');
    expect(result.components.map((component) => component.label)).toContain('Time on the course');
  });
});

describe('at risk', () => {
  const base: RiskInput = {
    missedAssessments: 0,
    assessmentsDue: 4,
    averageMarkPercent: 68,
    passMarkPercent: 50,
    attendancePercent: 90,
    attendanceRequirement: 75,
    consecutiveAbsences: 0,
    engagement: engagement(),
    coursesIncomplete: 0,
  };

  it('leaves a learner who is fine out of the list entirely', () => {
    const result = assessRisk(base);
    expect(result.score).toBe(0);
    expect(result.level).toBe('none');
    expect(result.indicators).toHaveLength(0);
  });

  it('names the reason rather than only scoring', () => {
    const result = assessRisk({ ...base, missedAssessments: 2 });
    expect(result.indicators[0]!.statement).toContain('Missed 2 of 4 assessments');
  });

  it('adds up several indicators into an urgent case', () => {
    const result = assessRisk({
      ...base,
      missedAssessments: 2,
      averageMarkPercent: 35,
      attendancePercent: 40,
      consecutiveAbsences: 4,
      engagement: engagement({ lessonsCompleted: 0, learningMinutes: 0, daysSinceLastActivity: 40 }),
    });
    expect(result.level).toBe('urgent');
    expect(result.indicators.length).toBeGreaterThanOrEqual(4);
  });

  it('states plainly what the score is and is not', () => {
    expect(assessRisk({ ...base, missedAssessments: 1 }).basis).toContain('prompt to ask');
  });

  it('draws only on things the institution measured', () => {
    const result = assessRisk({
      ...base,
      missedAssessments: 1,
      attendancePercent: 50,
      coursesIncomplete: 2,
    });
    const keys = result.indicators.map((indicator) => indicator.key);
    expect(keys).toEqual(
      expect.arrayContaining(['missed_assessments', 'low_attendance', 'incomplete_courses']),
    );
    expect(keys.join(' ')).not.toContain('motivation');
  });

  it('never exceeds the top of the scale', () => {
    const result = assessRisk({
      ...base,
      missedAssessments: 20,
      averageMarkPercent: 0,
      attendancePercent: 0,
      consecutiveAbsences: 10,
      coursesIncomplete: 10,
      engagement: engagement({ lessonsCompleted: 0, learningMinutes: 0, daysSinceLastActivity: 90 }),
    });
    expect(result.score).toBeLessThanOrEqual(100);
  });
});

describe('small groups', () => {
  it('withholds a figure for a group too small to report on', () => {
    const { reported, suppressed } = suppressSmallGroups([
      { label: 'Programme A', count: 40, value: 82 },
      { label: 'Programme B', count: 3, value: 33 },
    ]);
    expect(reported[0]!.value).toBe(82);
    expect(reported[1]!.value).toBeNull();
    expect(suppressed).toBe(1);
  });

  it('reports a group exactly at the minimum', () => {
    const { reported } = suppressSmallGroups([
      { label: 'Programme C', count: MINIMUM_GROUP_SIZE, value: 60 },
    ]);
    expect(reported[0]!.value).toBe(60);
  });
});

describe('trends', () => {
  it('says which way and by how much', () => {
    const trend = describeTrend([
      { label: 'semester 1', value: 71 },
      { label: 'semester 2', value: 64.5 },
    ]);
    expect(trend?.direction).toBe('down');
    expect(trend?.change).toBe(-6.5);
    expect(trend?.statement).toContain('Down 6.5%');
  });

  it('has nothing to say about a single point', () => {
    expect(describeTrend([{ label: 'semester 1', value: 71 }])).toBeNull();
  });
});

describe('retention', () => {
  it('keeps the academic record with no end date', () => {
    const decision = decideRetention({ category: 'ACADEMIC_RECORD', triggerDate: new Date('2000-01-01') });
    expect(decision?.action).toBe('RETAIN');
    expect(decision?.dueOn).toBeNull();
  });

  it('falls due after the retention period', () => {
    const decision = decideRetention(
      { category: 'PROOF_OF_PAYMENT', triggerDate: new Date('2023-01-01') },
      new Date('2026-01-01'),
    );
    expect(decision?.action).toBe('DELETE');
    expect(decision?.due).toBe(true);
  });

  it('is not yet due inside the period', () => {
    const decision = decideRetention(
      { category: 'MESSAGES', triggerDate: new Date('2025-01-01') },
      new Date('2026-01-01'),
    );
    expect(decision?.due).toBe(false);
  });

  it('gives a reason for every rule, so the policy can be argued with', () => {
    expect(RETENTION_RULES.every((rule) => rule.basis.length > 20)).toBe(true);
  });
});

describe('erasure requests', () => {
  it('refuses while someone is still enrolled, and says why', () => {
    const result = assessErasure({
      hasAcademicRecord: true,
      hasOutstandingBalance: false,
      hasActiveEnrolment: true,
    });
    expect(result.canErase).toBe(false);
    expect(result.explanation).toContain('currently enrolled');
  });

  it('refuses while money is outstanding', () => {
    const result = assessErasure({
      hasAcademicRecord: false,
      hasOutstandingBalance: true,
      hasActiveEnrolment: false,
    });
    expect(result.approach).toBe('REFUSE');
  });

  it('anonymises rather than refusing when there is an academic record', () => {
    const result = assessErasure({
      hasAcademicRecord: true,
      hasOutstandingBalance: false,
      hasActiveEnrolment: false,
    });
    expect(result.approach).toBe('ANONYMISE');
    expect(result.canErase).toBe(true);
    expect(result.remove.join(' ')).toContain('Identity');
    expect(result.keep.join(' ')).toContain('qualification');
  });

  it('deletes outright when there is nothing that has to be kept', () => {
    const result = assessErasure({
      hasAcademicRecord: false,
      hasOutstandingBalance: false,
      hasActiveEnrolment: false,
    });
    expect(result.approach).toBe('DELETE');
  });
});
