/**
 * Progression and graduation rules. Pure, and driven by a policy object rather
 * than hard-coded thresholds, because every institution sets these differently
 * and changing a rule must not mean changing code that has already been
 * audited.
 */

export interface ProgressionPolicy {
  /** Share of attempted credits that must be passed to progress cleanly. */
  progressThreshold: number;
  /** Below this, the learner repeats the year rather than carrying modules. */
  repeatYearThreshold: number;
  /** Below this after a year on probation, exclusion is considered. */
  exclusionThreshold: number;
  /** Credits a learner may carry into the next year of study. */
  maximumCarryCredits: number;
  /** Failed attempts at one course before it blocks progression. */
  maximumAttemptsPerCourse: number;
}

export const DEFAULT_PROGRESSION_POLICY: ProgressionPolicy = {
  progressThreshold: 0.6,
  repeatYearThreshold: 0.4,
  exclusionThreshold: 0.25,
  maximumCarryCredits: 40,
  maximumAttemptsPerCourse: 3,
};

export type CourseResultCode =
  | 'PENDING' | 'PASS' | 'PASS_WITH_DISTINCTION' | 'FAIL'
  | 'COMPETENT' | 'NOT_YET_COMPETENT' | 'INCOMPLETE' | 'WITHDRAWN';

export interface CourseRecord {
  courseId: string;
  code: string;
  title: string;
  credits: number;
  creditsAwarded: number | null;
  result: CourseResultCode;
  finalMark: number | null;
  finalGrade: string | null;
  yearOfStudy: number;
  termLabel: string;
  academicYear: number;
  attempt: number;
}

const PASSING: CourseResultCode[] = ['PASS', 'PASS_WITH_DISTINCTION', 'COMPETENT'];
const FAILING: CourseResultCode[] = ['FAIL', 'NOT_YET_COMPETENT'];
const UNRESOLVED: CourseResultCode[] = ['PENDING', 'INCOMPLETE'];

export function isPassing(result: CourseResultCode): boolean {
  return PASSING.includes(result);
}

export interface CreditSummary {
  attempted: number;
  earned: number;
  failed: number;
  outstanding: number;
  passRate: number;
  coursesPassed: number;
  coursesFailed: number;
  coursesOutstanding: number;
}

/**
 * Credits are counted from resolved results only. Work still being marked is
 * reported as outstanding rather than being treated as a failure, which is the
 * same principle the course mark uses.
 */
export function summariseCredits(records: CourseRecord[]): CreditSummary {
  const resolved = records.filter((record) => !UNRESOLVED.includes(record.result) && record.result !== 'WITHDRAWN');
  const passed = resolved.filter((record) => isPassing(record.result));
  const failed = resolved.filter((record) => FAILING.includes(record.result));
  const outstanding = records.filter((record) => UNRESOLVED.includes(record.result));

  const attempted = resolved.reduce((sum, record) => sum + record.credits, 0);
  const earned = passed.reduce((sum, record) => sum + (record.creditsAwarded ?? record.credits), 0);

  return {
    attempted,
    earned,
    failed: failed.reduce((sum, record) => sum + record.credits, 0),
    outstanding: outstanding.reduce((sum, record) => sum + record.credits, 0),
    passRate: attempted > 0 ? Math.round((earned / attempted) * 1000) / 1000 : 0,
    coursesPassed: passed.length,
    coursesFailed: failed.length,
    coursesOutstanding: outstanding.length,
  };
}

export type AcademicStanding = 'GOOD_STANDING' | 'PROBATION' | 'AT_RISK' | 'EXCLUDED' | 'GRADUATED' | 'ON_HOLD';

export interface StandingInput {
  summary: CreditSummary;
  previousStanding?: AcademicStanding | null;
  graduated?: boolean;
}

/**
 * Standing is about the learner's position, not a single year's marks.
 * Exclusion is never reached from good standing in one step: a learner must
 * already have been on probation, which is what gives an institution a
 * defensible record when a decision is challenged.
 */
export function determineStanding(
  input: StandingInput,
  policy: ProgressionPolicy = DEFAULT_PROGRESSION_POLICY,
): AcademicStanding {
  if (input.graduated) return 'GRADUATED';

  const { passRate } = input.summary;
  const wasStruggling = input.previousStanding === 'PROBATION' || input.previousStanding === 'AT_RISK';

  if (passRate >= policy.progressThreshold) return 'GOOD_STANDING';
  if (passRate < policy.exclusionThreshold && wasStruggling) return 'EXCLUDED';
  if (passRate < policy.repeatYearThreshold) return 'PROBATION';
  return 'AT_RISK';
}

export type ProgressionOutcome =
  | 'PROGRESS' | 'PROGRESS_WITH_CONDITIONS' | 'REPEAT_MODULES'
  | 'REPEAT_YEAR' | 'EXCLUDE' | 'GRADUATE';

export interface ProgressionDecision {
  outcome: ProgressionOutcome;
  standing: AcademicStanding;
  summary: CreditSummary;
  carryCredits: number;
  reasons: string[];
  /** Courses the learner must repeat before progressing. */
  mustRepeat: { courseId: string; code: string; credits: number; attempts: number }[];
}

export interface GraduationCheck {
  eligible: boolean;
  missing: string[];
  creditsShort: number;
}

/**
 * Whether the learner has met the qualification. Both tests must pass: enough
 * credits, and every compulsory course in the curriculum. A learner can be over
 * the credit total on electives and still be short a required module.
 */
export function checkGraduation(
  records: CourseRecord[],
  requirements: { minimumCredits: number | null; compulsoryCourseIds: string[] },
): GraduationCheck {
  const summary = summariseCredits(records);
  const passedIds = new Set(records.filter((record) => isPassing(record.result)).map((record) => record.courseId));

  const missingCompulsory = requirements.compulsoryCourseIds.filter((id) => !passedIds.has(id));
  const creditsShort = Math.max(0, (requirements.minimumCredits ?? 0) - summary.earned);

  const missing: string[] = [];
  if (creditsShort > 0) missing.push(`${creditsShort} credits short of the qualification.`);
  if (missingCompulsory.length > 0) {
    missing.push(`${missingCompulsory.length} compulsory courses not yet passed.`);
  }
  if (summary.coursesOutstanding > 0) {
    missing.push(`${summary.coursesOutstanding} courses are still being marked.`);
  }

  return {
    eligible: missing.length === 0,
    missing,
    creditsShort,
  };
}

/**
 * The progression decision for one academic year. The outcome is a
 * recommendation with its reasoning attached: a registrar or a senate committee
 * still records the decision, and can record a different one.
 */
export function determineProgression(
  records: CourseRecord[],
  context: {
    yearOfStudy: number;
    finalYear: boolean;
    previousStanding?: AcademicStanding | null;
    minimumCredits: number | null;
    compulsoryCourseIds: string[];
  },
  policy: ProgressionPolicy = DEFAULT_PROGRESSION_POLICY,
): ProgressionDecision {
  const summary = summariseCredits(records);
  const reasons: string[] = [];

  const attemptsByCourse = new Map<string, number>();
  for (const record of records) {
    attemptsByCourse.set(record.courseId, Math.max(attemptsByCourse.get(record.courseId) ?? 0, record.attempt));
  }

  const passedIds = new Set(records.filter((record) => isPassing(record.result)).map((record) => record.courseId));
  const mustRepeat = records
    .filter((record) => FAILING.includes(record.result) && !passedIds.has(record.courseId))
    .map((record) => ({
      courseId: record.courseId,
      code: record.code,
      credits: record.credits,
      attempts: attemptsByCourse.get(record.courseId) ?? 1,
    }))
    // A learner who failed and later passed the same course is not repeating it.
    .filter((entry, index, all) => all.findIndex((other) => other.courseId === entry.courseId) === index);

  const carryCredits = mustRepeat.reduce((sum, entry) => sum + entry.credits, 0);

  if (context.finalYear) {
    const graduation = checkGraduation(records, {
      minimumCredits: context.minimumCredits,
      compulsoryCourseIds: context.compulsoryCourseIds,
    });
    if (graduation.eligible) {
      return {
        outcome: 'GRADUATE',
        standing: 'GRADUATED',
        summary,
        carryCredits: 0,
        reasons: ['Every requirement for the qualification has been met.'],
        mustRepeat: [],
      };
    }
    reasons.push(...graduation.missing);
  }

  const standing = determineStanding(
    { summary, previousStanding: context.previousStanding },
    policy,
  );

  if (summary.coursesOutstanding > 0) {
    reasons.push(`${summary.coursesOutstanding} results are outstanding, so this decision is provisional.`);
  }

  const exhausted = mustRepeat.filter((entry) => entry.attempts >= policy.maximumAttemptsPerCourse);
  if (exhausted.length > 0) {
    reasons.push(
      `${exhausted.map((entry) => entry.code).join(', ')} has been attempted ${policy.maximumAttemptsPerCourse} times without a pass.`,
    );
  }

  let outcome: ProgressionOutcome;

  if (standing === 'EXCLUDED') {
    outcome = 'EXCLUDE';
    reasons.push(`Pass rate of ${Math.round(summary.passRate * 100)}% after a year already flagged.`);
  } else if (summary.passRate < policy.repeatYearThreshold) {
    outcome = 'REPEAT_YEAR';
    reasons.push(`Pass rate of ${Math.round(summary.passRate * 100)}% is below the ${Math.round(policy.repeatYearThreshold * 100)}% needed to carry modules forward.`);
  } else if (carryCredits > policy.maximumCarryCredits) {
    outcome = 'REPEAT_MODULES';
    reasons.push(`${carryCredits} credits outstanding is more than the ${policy.maximumCarryCredits} a learner may carry.`);
  } else if (mustRepeat.length > 0) {
    outcome = 'PROGRESS_WITH_CONDITIONS';
    reasons.push(`Progresses carrying ${mustRepeat.map((entry) => entry.code).join(', ')}.`);
  } else {
    outcome = 'PROGRESS';
    reasons.push('All courses for the year passed.');
  }

  return { outcome, standing, summary, carryCredits, reasons, mustRepeat };
}
