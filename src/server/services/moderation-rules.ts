/**
 * Moderation: how a sample is drawn, what the comparison says, and what may be
 * done to the marks afterwards. Pure, because a moderation decision is the
 * thing an external examiner and an accreditation panel both read, and it has
 * to be reproducible from the record.
 */
import { seededShuffle } from './quiz-engine';

export interface SamplingPolicy {
  /** Never sample fewer than this, however small the group. */
  minimum: number;
  /** Never sample more than this, however large. */
  maximum: number;
  /** Share of the cohort to aim for, before the floor and ceiling apply. */
  proportion: number;
  /** Marks within this many percentage points of the pass mark are borderline. */
  borderlineBand: number;
}

export const DEFAULT_SAMPLING_POLICY: SamplingPolicy = {
  minimum: 5,
  maximum: 25,
  proportion: 0.1,
  borderlineBand: 5,
};

export interface SampleCandidate {
  submissionId: string;
  studentNumber: string;
  markPercent: number;
}

export type SampleReason =
  | 'highest' | 'lowest' | 'borderline' | 'failure' | 'distinction' | 'spread';

export interface SampledSubmission {
  submissionId: string;
  studentNumber: string;
  markPercent: number;
  reason: SampleReason;
}

export function sampleSize(cohort: number, policy: SamplingPolicy = DEFAULT_SAMPLING_POLICY): number {
  if (cohort === 0) return 0;
  const target = Math.ceil(cohort * policy.proportion);
  return Math.min(cohort, Math.max(policy.minimum, Math.min(policy.maximum, target)));
}

/**
 * Draws the sample a moderator would draw by hand: the top, the bottom, every
 * borderline result, then a spread across the rest. Purely random sampling is
 * defensible statistically and useless in practice, because the marks that
 * matter are the ones near a decision boundary.
 *
 * The spread is seeded by the assessment, so re-running produces the same
 * sample. A moderator who reloads the page must not get a different paper.
 */
export function buildSample(
  candidates: SampleCandidate[],
  passMarkPercent: number,
  seed: string,
  policy: SamplingPolicy = DEFAULT_SAMPLING_POLICY,
): SampledSubmission[] {
  if (candidates.length === 0) return [];

  const ordered = [...candidates].sort((a, b) => b.markPercent - a.markPercent);
  const size = sampleSize(candidates.length, policy);

  const chosen = new Map<string, SampledSubmission>();
  const take = (candidate: SampleCandidate, reason: SampleReason) => {
    if (chosen.size >= size || chosen.has(candidate.submissionId)) return;
    chosen.set(candidate.submissionId, { ...candidate, reason });
  };

  take(ordered[0]!, 'highest');
  take(ordered[ordered.length - 1]!, 'lowest');

  for (const candidate of ordered) {
    if (Math.abs(candidate.markPercent - passMarkPercent) <= policy.borderlineBand) {
      take(candidate, 'borderline');
    }
  }

  for (const candidate of ordered) {
    if (candidate.markPercent < passMarkPercent) take(candidate, 'failure');
  }

  for (const candidate of ordered) {
    if (candidate.markPercent >= 75) take(candidate, 'distinction');
  }

  for (const candidate of seededShuffle(ordered, seed)) {
    take(candidate, 'spread');
  }

  return [...chosen.values()].sort((a, b) => b.markPercent - a.markPercent);
}

export interface MarkPair {
  submissionId: string;
  assessorMark: number;
  moderatorMark: number;
}

export type ModerationVerdict = 'APPROVED' | 'APPROVED_WITH_CHANGES' | 'REFERRED_BACK' | 'REJECTED';

export interface DiscrepancyAnalysis {
  compared: number;
  meanDifference: number;
  /** Positive means the moderator marked higher than the assessor. */
  direction: 'higher' | 'lower' | 'none';
  largestDifference: number;
  outsideTolerance: { submissionId: string; difference: number }[];
  consistent: boolean;
  recommendedVerdict: ModerationVerdict;
  reasons: string[];
}

/**
 * Compares the assessor's marks with the moderator's. A small scatter is normal
 * and means nothing; a consistent drift in one direction means the marking was
 * lenient or harsh across the board, which is a different problem with a
 * different remedy.
 */
export function analyseDiscrepancies(
  pairs: MarkPair[],
  toleranceMarks = 5,
): DiscrepancyAnalysis {
  if (pairs.length === 0) {
    return {
      compared: 0,
      meanDifference: 0,
      direction: 'none',
      largestDifference: 0,
      outsideTolerance: [],
      consistent: true,
      recommendedVerdict: 'APPROVED',
      reasons: ['Nothing was compared.'],
    };
  }

  const differences = pairs.map((pair) => pair.moderatorMark - pair.assessorMark);
  const mean = Math.round((differences.reduce((sum, value) => sum + value, 0) / pairs.length) * 100) / 100;
  const largest = Math.max(...differences.map((value) => Math.abs(value)));

  const outside = pairs
    .map((pair, index) => ({ submissionId: pair.submissionId, difference: differences[index]! }))
    .filter((entry) => Math.abs(entry.difference) > toleranceMarks);

  const sameDirection = differences.filter((value) => value !== 0);
  const drifting =
    sameDirection.length >= 3 &&
    (sameDirection.every((value) => value > 0) || sameDirection.every((value) => value < 0)) &&
    Math.abs(mean) > toleranceMarks / 2;

  const reasons: string[] = [];
  let verdict: ModerationVerdict = 'APPROVED';

  if (outside.length === 0 && !drifting) {
    reasons.push(`All ${pairs.length} sampled marks are within ${toleranceMarks} marks.`);
  }

  if (drifting) {
    reasons.push(
      `The moderator marked ${mean > 0 ? 'higher' : 'lower'} on every sampled script, by ${Math.abs(mean)} marks on average, which points at the marking standard rather than at individual scripts.`,
    );
    verdict = 'APPROVED_WITH_CHANGES';
  }

  if (outside.length > 0) {
    reasons.push(
      `${outside.length} of ${pairs.length} sampled marks differ by more than ${toleranceMarks} marks.`,
    );
    verdict = outside.length / pairs.length > 0.3 ? 'REFERRED_BACK' : 'APPROVED_WITH_CHANGES';
  }

  if (largest > toleranceMarks * 3) {
    reasons.push(`The largest difference is ${largest} marks.`);
    verdict = 'REFERRED_BACK';
  }

  return {
    compared: pairs.length,
    meanDifference: mean,
    direction: mean > 0 ? 'higher' : mean < 0 ? 'lower' : 'none',
    largestDifference: largest,
    outsideTolerance: outside,
    consistent: outside.length === 0 && !drifting,
    recommendedVerdict: verdict,
    reasons,
  };
}

export interface Adjustment {
  kind: 'NONE' | 'SHIFT' | 'SCALE';
  /** Marks to add for SHIFT, percentage points of scaling for SCALE. */
  value: number;
}

export interface AdjustedMark {
  submissionId: string;
  before: number;
  after: number;
  changed: boolean;
}

export interface AdjustmentResult {
  marks: AdjustedMark[];
  affected: number;
  needsExternalApproval: boolean;
  note: string;
}

/**
 * Applies a blanket adjustment to a whole cohort. Two rules hold whatever the
 * numbers say: no mark leaves the range the assessment allows, and a large
 * adjustment needs external sign-off, because moving a whole cohort is a
 * decision about the assessment rather than about the learners.
 */
export function applyAdjustment(
  marks: { submissionId: string; mark: number }[],
  adjustment: Adjustment,
  maxMark: number,
  externalApprovalThreshold = 10,
): AdjustmentResult {
  if (adjustment.kind === 'NONE' || adjustment.value === 0) {
    return {
      marks: marks.map((entry) => ({
        submissionId: entry.submissionId,
        before: entry.mark,
        after: entry.mark,
        changed: false,
      })),
      affected: 0,
      needsExternalApproval: false,
      note: 'No adjustment applied.',
    };
  }

  const adjusted = marks.map((entry) => {
    const raw =
      adjustment.kind === 'SHIFT'
        ? entry.mark + adjustment.value
        : entry.mark * (1 + adjustment.value / 100);

    const after = Math.max(0, Math.min(maxMark, Math.round(raw * 100) / 100));
    return {
      submissionId: entry.submissionId,
      before: entry.mark,
      after,
      changed: after !== entry.mark,
    };
  });

  const percentOfMax = maxMark > 0 ? (Math.abs(adjustment.value) / maxMark) * 100 : 0;
  const needsExternalApproval =
    adjustment.kind === 'SCALE'
      ? Math.abs(adjustment.value) >= externalApprovalThreshold
      : percentOfMax >= externalApprovalThreshold;

  return {
    marks: adjusted,
    affected: adjusted.filter((entry) => entry.changed).length,
    needsExternalApproval,
    note:
      adjustment.kind === 'SHIFT'
        ? `Every mark moved by ${adjustment.value}, capped at 0 and ${maxMark}.`
        : `Every mark scaled by ${adjustment.value}%, capped at 0 and ${maxMark}.`,
  };
}
