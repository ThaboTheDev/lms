/**
 * Pure grading arithmetic: banding, late penalties, rubric totals and the
 * weighted course mark. An institution's results are defensible only if the
 * same rule produces the same number everywhere, so these live in one place and
 * are tested directly.
 */

export interface GradeBand {
  label: string;
  minPercent: number;
  maxPercent: number;
  gradePoint?: number | null;
  isPass: boolean;
}

export interface Graded {
  percent: number;
  label: string;
  isPass: boolean;
  gradePoint: number | null;
}

export function toPercent(mark: number, maxMark: number): number {
  if (maxMark <= 0) return 0;
  return Math.round((mark / maxMark) * 10000) / 100;
}

/**
 * Bands are matched from the top down, so overlapping boundaries resolve to the
 * more generous band rather than silently returning nothing.
 */
export function applyGradeBands(percent: number, bands: GradeBand[]): Graded | null {
  const ordered = [...bands].sort((a, b) => b.minPercent - a.minPercent);
  const band = ordered.find((candidate) => percent >= candidate.minPercent && percent <= candidate.maxPercent)
    ?? ordered.find((candidate) => percent >= candidate.minPercent);

  if (!band) return null;
  return {
    percent,
    label: band.label,
    isPass: band.isPass,
    gradePoint: band.gradePoint ?? null,
  };
}

export interface LateRule {
  allowLate: boolean;
  /** Percentage of the earned mark removed per started day late. */
  latePenaltyPct?: number | null;
  dueAt?: Date | null;
  closesAt?: Date | null;
}

export interface LateOutcome {
  isLate: boolean;
  daysLate: number;
  penaltyApplied: number;
  finalMark: number;
  rejected: boolean;
}

/**
 * Applies the late rule to an earned mark. A part day counts as a full day,
 * which is how every assessment policy that uses daily penalties is written,
 * and the penalty never pushes a mark below zero.
 */
export function applyLatePenalty(
  earnedMark: number,
  submittedAt: Date,
  rule: LateRule,
): LateOutcome {
  const dueAt = rule.dueAt;
  if (!dueAt || submittedAt <= dueAt) {
    return { isLate: false, daysLate: 0, penaltyApplied: 0, finalMark: earnedMark, rejected: false };
  }

  const daysLate = Math.ceil((submittedAt.getTime() - dueAt.getTime()) / 86_400_000);

  if (!rule.allowLate || (rule.closesAt && submittedAt > rule.closesAt)) {
    return { isLate: true, daysLate, penaltyApplied: earnedMark, finalMark: 0, rejected: true };
  }

  const penaltyPct = Math.min(100, (rule.latePenaltyPct ?? 0) * daysLate);
  const penalty = Math.round(earnedMark * (penaltyPct / 100) * 100) / 100;
  const finalMark = Math.max(0, Math.round((earnedMark - penalty) * 100) / 100);

  return { isLate: true, daysLate, penaltyApplied: penalty, finalMark, rejected: false };
}

/* ---------------------------------------------------------- rubrics ----- */

export interface RubricCriterion {
  id: string;
  title: string;
  weight: number;
  maxScore: number;
}

export interface CriterionScore {
  criterionId: string;
  score: number;
}

export interface RubricOutcome {
  total: number;
  outOf: number;
  percent: number;
  missing: string[];
}

/**
 * Weighted rubric total. A criterion scored above its maximum is clamped rather
 * than accepted: an assessor slipping on the keyboard should not hand out a
 * mark the rubric does not allow.
 */
export function scoreRubric(criteria: RubricCriterion[], scores: CriterionScore[]): RubricOutcome {
  const byCriterion = new Map(scores.map((entry) => [entry.criterionId, entry.score]));

  const weightTotal = criteria.reduce((sum, criterion) => sum + criterion.weight, 0) || 1;
  let weighted = 0;

  for (const criterion of criteria) {
    const raw = byCriterion.get(criterion.id);
    if (raw === undefined) continue;
    const clamped = Math.max(0, Math.min(criterion.maxScore, raw));
    const ratio = criterion.maxScore > 0 ? clamped / criterion.maxScore : 0;
    weighted += ratio * criterion.weight;
  }

  const percent = Math.round((weighted / weightTotal) * 10000) / 100;
  const outOf = criteria.reduce((sum, criterion) => sum + criterion.maxScore, 0);
  const total = Math.round((percent / 100) * outOf * 100) / 100;

  return {
    total,
    outOf: Math.round(outOf * 100) / 100,
    percent,
    missing: criteria.filter((criterion) => !byCriterion.has(criterion.id)).map((criterion) => criterion.title),
  };
}

/* ----------------------------------------------------- course results --- */

export interface AssessmentResult {
  assessmentId: string;
  title: string;
  weight: number;
  mark: number | null;
  maxMark: number;
  released: boolean;
}

export interface CourseMark {
  percent: number | null;
  weightCounted: number;
  weightOutstanding: number;
  complete: boolean;
  provisional: boolean;
}

/**
 * Weighted course mark. Unmarked assessments are left out of the numerator and
 * the denominator rather than counted as zero, so a mid-semester figure reads
 * as "of the work marked so far" instead of punishing a learner for work the
 * lecturer has not got to yet. The result is flagged provisional until every
 * weighted assessment is in.
 */
export function calculateCourseMark(results: AssessmentResult[]): CourseMark {
  const weighted = results.filter((result) => result.weight > 0);
  const marked = weighted.filter((result) => result.mark !== null);

  const weightCounted = marked.reduce((sum, result) => sum + result.weight, 0);
  const weightTotal = weighted.reduce((sum, result) => sum + result.weight, 0);

  if (weightCounted === 0) {
    return {
      percent: null,
      weightCounted: 0,
      weightOutstanding: weightTotal,
      complete: false,
      provisional: true,
    };
  }

  const earned = marked.reduce(
    (sum, result) => sum + (toPercent(result.mark!, result.maxMark) * result.weight) / 100,
    0,
  );

  return {
    percent: Math.round((earned / weightCounted) * 10000) / 100,
    weightCounted,
    weightOutstanding: Math.round((weightTotal - weightCounted) * 100) / 100,
    complete: weightCounted >= weightTotal,
    provisional: weightCounted < weightTotal,
  };
}

/** Warns when an assessment plan does not add up before learners sit it. */
export function checkWeighting(results: { title: string; weight: number }[]): string[] {
  const problems: string[] = [];
  const total = results.reduce((sum, result) => sum + result.weight, 0);

  if (results.length === 0) return ['No assessments have been set up for this course.'];
  if (Math.abs(total - 100) > 0.01) {
    problems.push(`Assessment weights add up to ${Math.round(total * 100) / 100}%, not 100%.`);
  }
  for (const result of results) {
    if (result.weight < 0) problems.push(`${result.title} has a negative weight.`);
  }
  return problems;
}

/** Grade point average across completed courses, weighted by credits. */
export function calculateGpa(courses: { credits: number; gradePoint: number | null }[]): number | null {
  const counted = courses.filter((course) => course.gradePoint !== null && course.credits > 0);
  if (counted.length === 0) return null;

  const credits = counted.reduce((sum, course) => sum + course.credits, 0);
  const points = counted.reduce((sum, course) => sum + course.gradePoint! * course.credits, 0);
  return Math.round((points / credits) * 100) / 100;
}

/** Competency assessment records an outcome, not a percentage. */
export function toCompetency(percent: number, passMarkPercent: number): 'COMPETENT' | 'NOT_YET_COMPETENT' {
  return percent >= passMarkPercent ? 'COMPETENT' : 'NOT_YET_COMPETENT';
}
