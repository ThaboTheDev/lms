import { describe, expect, it } from 'vitest';
import {
  analyseDiscrepancies,
  applyAdjustment,
  buildSample,
  sampleSize,
  DEFAULT_SAMPLING_POLICY,
  type SampleCandidate,
} from '@/server/services/moderation-rules';
import { checkEvidence, complianceSignals, reviewStage } from '@/server/services/qa-rules';
import { describeAction, describeChanges, summariseActions } from '@/server/services/audit-view';

function cohort(marks: number[]): SampleCandidate[] {
  return marks.map((markPercent, index) => ({
    submissionId: `sub${index}`,
    studentNumber: `20260000${index}`,
    markPercent,
  }));
}

describe('sample size', () => {
  it('never samples fewer than the floor', () => {
    expect(sampleSize(6)).toBe(5);
    expect(sampleSize(3)).toBe(3);
  });

  it('never samples more than the ceiling', () => {
    expect(sampleSize(1000)).toBe(DEFAULT_SAMPLING_POLICY.maximum);
  });

  it('takes roughly a tenth in between', () => {
    expect(sampleSize(120)).toBe(12);
  });

  it('samples nothing from an empty cohort', () => {
    expect(sampleSize(0)).toBe(0);
  });
});

describe('drawing a sample', () => {
  const marks = cohort([92, 81, 74, 66, 58, 52, 49, 47, 38, 22]);

  it('always includes the highest and the lowest', () => {
    const sample = buildSample(marks, 50, 'assessment-1');
    const ids = sample.map((entry) => entry.submissionId);
    expect(ids).toContain('sub0');
    expect(ids).toContain('sub9');
  });

  it('includes the results near the pass mark', () => {
    const sample = buildSample(marks, 50, 'assessment-1');
    const borderline = sample.filter((entry) => Math.abs(entry.markPercent - 50) <= 5);
    expect(borderline.length).toBeGreaterThan(0);
  });

  it('gives the same sample when it is drawn again', () => {
    const first = buildSample(marks, 50, 'assessment-1').map((entry) => entry.submissionId);
    const second = buildSample(marks, 50, 'assessment-1').map((entry) => entry.submissionId);
    expect(first).toEqual(second);
  });

  it('never samples the same script twice', () => {
    const sample = buildSample(marks, 50, 'assessment-1');
    expect(new Set(sample.map((entry) => entry.submissionId)).size).toBe(sample.length);
  });

  it('takes the whole group when the group is smaller than the floor', () => {
    const sample = buildSample(cohort([70, 40, 55]), 50, 'seed');
    expect(sample).toHaveLength(3);
  });

  it('returns nothing when nothing was submitted', () => {
    expect(buildSample([], 50, 'seed')).toHaveLength(0);
  });
});

describe('comparing marks', () => {
  it('approves a sample that agrees within tolerance', () => {
    const analysis = analyseDiscrepancies([
      { submissionId: 'a', assessorMark: 60, moderatorMark: 62 },
      { submissionId: 'b', assessorMark: 45, moderatorMark: 43 },
      { submissionId: 'c', assessorMark: 71, moderatorMark: 71 },
    ]);
    expect(analysis.recommendedVerdict).toBe('APPROVED');
    expect(analysis.consistent).toBe(true);
  });

  it('spots a consistent drift as a marking standard problem', () => {
    const analysis = analyseDiscrepancies([
      { submissionId: 'a', assessorMark: 60, moderatorMark: 64 },
      { submissionId: 'b', assessorMark: 45, moderatorMark: 49 },
      { submissionId: 'c', assessorMark: 71, moderatorMark: 75 },
    ]);
    expect(analysis.direction).toBe('higher');
    expect(analysis.recommendedVerdict).toBe('APPROVED_WITH_CHANGES');
    expect(analysis.reasons.join(' ')).toContain('marking standard');
  });

  it('refers back when a third of the sample is out', () => {
    const analysis = analyseDiscrepancies([
      { submissionId: 'a', assessorMark: 60, moderatorMark: 75 },
      { submissionId: 'b', assessorMark: 45, moderatorMark: 30 },
      { submissionId: 'c', assessorMark: 71, moderatorMark: 71 },
    ]);
    expect(analysis.recommendedVerdict).toBe('REFERRED_BACK');
  });

  it('refers back on a single very large difference', () => {
    const analysis = analyseDiscrepancies([
      { submissionId: 'a', assessorMark: 30, moderatorMark: 70 },
      ...Array.from({ length: 9 }, (_, index) => ({
        submissionId: `b${index}`,
        assessorMark: 60,
        moderatorMark: 60,
      })),
    ]);
    expect(analysis.largestDifference).toBe(40);
    expect(analysis.recommendedVerdict).toBe('REFERRED_BACK');
  });

  it('says nothing useful about an empty comparison, and says so', () => {
    const analysis = analyseDiscrepancies([]);
    expect(analysis.compared).toBe(0);
    expect(analysis.reasons[0]).toContain('Nothing was compared');
  });
});

describe('adjusting a cohort', () => {
  const marks = [
    { submissionId: 'a', mark: 48 },
    { submissionId: 'b', mark: 62 },
    { submissionId: 'c', mark: 97 },
  ];

  it('shifts every mark and caps at the maximum', () => {
    const result = applyAdjustment(marks, { kind: 'SHIFT', value: 5 }, 100);
    expect(result.marks.map((entry) => entry.after)).toEqual([53, 67, 100]);
    expect(result.affected).toBe(3);
  });

  it('never takes a mark below zero', () => {
    const result = applyAdjustment([{ submissionId: 'a', mark: 3 }], { kind: 'SHIFT', value: -10 }, 100);
    expect(result.marks[0]!.after).toBe(0);
  });

  it('scales by a percentage', () => {
    const result = applyAdjustment([{ submissionId: 'a', mark: 50 }], { kind: 'SCALE', value: 10 }, 100);
    expect(result.marks[0]!.after).toBe(55);
  });

  it('changes nothing when no adjustment is asked for', () => {
    const result = applyAdjustment(marks, { kind: 'NONE', value: 0 }, 100);
    expect(result.affected).toBe(0);
    expect(result.needsExternalApproval).toBe(false);
  });

  it('sends a large adjustment for external sign off', () => {
    expect(applyAdjustment(marks, { kind: 'SHIFT', value: 12 }, 100).needsExternalApproval).toBe(true);
    expect(applyAdjustment(marks, { kind: 'SHIFT', value: 3 }, 100).needsExternalApproval).toBe(false);
    expect(applyAdjustment(marks, { kind: 'SCALE', value: 15 }, 100).needsExternalApproval).toBe(true);
  });
});

describe('programme review', () => {
  const base = {
    status: 'PLANNED',
    dueOn: new Date('2026-06-30'),
    completedOn: null,
    hasFindings: false,
    hasActions: false,
    evidenceCount: 0,
  };

  it('moves through its stages', () => {
    const now = new Date('2026-05-01');
    expect(reviewStage(base, now)).toBe('PLANNED');
    expect(reviewStage({ ...base, evidenceCount: 3 }, now)).toBe('IN_REVIEW');
    expect(reviewStage({ ...base, evidenceCount: 3, hasFindings: true }, now)).toBe('FINDINGS');
    expect(reviewStage({ ...base, completedOn: new Date('2026-05-20') }, now)).toBe('COMPLETE');
  });

  it('reads as overdue past its date, but not once it is done', () => {
    const late = new Date('2026-08-01');
    expect(reviewStage(base, late)).toBe('OVERDUE');
    expect(reviewStage({ ...base, completedOn: new Date('2026-06-01') }, late)).toBe('COMPLETE');
  });
});

describe('evidence', () => {
  it('lists what is missing and why it is asked for', () => {
    const check = checkEvidence(['CURRICULUM', 'ASSESSMENT_POLICY']);
    expect(check.readyToSubmit).toBe(false);
    expect(check.gaps.some((gap) => gap.category === 'MODERATION')).toBe(true);
    expect(check.gaps.find((gap) => gap.category === 'MODERATION')?.rationale).toContain('marking');
  });

  it('is ready once every required category is on file', () => {
    const check = checkEvidence(['CURRICULUM', 'ASSESSMENT_POLICY', 'MODERATION', 'RESULTS', 'STAFF']);
    expect(check.readyToSubmit).toBe(true);
    expect(check.completeness).toBe(100);
    expect(check.gaps.every((gap) => !gap.required)).toBe(true);
  });
});

describe('compliance signals', () => {
  const clean = {
    assessmentsPublished: 10,
    assessmentsModerated: 9,
    resultsReleasedWithoutModeration: 0,
    programmesWithoutReview: 0,
    programmesTotal: 4,
    certificatesIssuedByException: 0,
    overdueReviews: 0,
  };

  it('reads clean when everything is in order', () => {
    expect(complianceSignals(clean).every((signal) => signal.status === 'ok')).toBe(true);
  });

  it('treats releasing results without moderation as a breach', () => {
    const signals = complianceSignals({ ...clean, resultsReleasedWithoutModeration: 2 });
    expect(signals.find((signal) => signal.key === 'release_before_moderation')?.status).toBe('breach');
  });

  it('says what it measured, not just that something is wrong', () => {
    const signals = complianceSignals({ ...clean, assessmentsModerated: 6 });
    const moderation = signals.find((signal) => signal.key === 'moderation');
    expect(moderation?.status).toBe('attention');
    expect(moderation?.detail).toContain('6 of 10');
    expect(moderation?.detail).toContain('60%');
  });

  it('treats moderation coverage under half as a breach rather than a nudge', () => {
    const signals = complianceSignals({ ...clean, assessmentsModerated: 3 });
    expect(signals.find((signal) => signal.key === 'moderation')?.status).toBe('breach');
  });
});

describe('reading the audit log', () => {
  it('diffs only the fields that moved', () => {
    const changes = describeChanges(
      { status: 'SUBMITTED', finalMark: 40 },
      { status: 'GRADED', finalMark: 40 },
    );
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ field: 'status', from: 'SUBMITTED', to: 'GRADED' });
  });

  it('reads a missing value as not set rather than as blank', () => {
    const changes = describeChanges({}, { finalGrade: 'Merit' });
    expect(changes[0]).toMatchObject({ field: 'grade', from: 'not set', to: 'Merit' });
  });

  it('says what happened in words', () => {
    expect(
      describeAction({
        id: '1',
        action: 'certificate.revoked',
        entityType: 'Certificate',
        entityId: 'c1',
        actorEmail: 'registrar@example.ac.za',
        before: null,
        after: null,
        createdAt: new Date(),
      }),
    ).toBe('registrar@example.ac.za revoked a certificate');
  });

  it('counts the actions in a period, commonest first', () => {
    const summary = summariseActions([
      { action: 'submission.graded' },
      { action: 'submission.graded' },
      { action: 'certificate.issued' },
    ]);
    expect(summary[0]).toMatchObject({ count: 2, label: 'recorded a mark' });
  });
});
