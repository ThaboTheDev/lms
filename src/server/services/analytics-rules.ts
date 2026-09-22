/**
 * Learning analytics. Two rules shape everything here.
 *
 * First, every indicator is something the institution measured: a missed
 * deadline, a mark, a register, a lesson opened. Nothing infers anything about
 * a person's character, circumstances or ability, and the reason each learner
 * appears is always shown alongside the score, so a conversation starts from
 * the facts rather than from a number.
 *
 * Second, aggregates are suppressed below a minimum group size, because a pass
 * rate for a group of three is a statement about three identifiable people.
 */

export const MINIMUM_GROUP_SIZE = 5;

export interface EngagementInput {
  lessonsAvailable: number;
  lessonsCompleted: number;
  learningMinutes: number;
  daysSinceLastActivity: number | null;
  discussionPosts: number;
}

export interface EngagementScore {
  /** 0 to 100, from what the learner did rather than who they are. */
  score: number;
  band: 'active' | 'slipping' | 'inactive' | 'unknown';
  components: { label: string; value: string }[];
}

export function scoreEngagement(input: EngagementInput): EngagementScore {
  if (input.lessonsAvailable === 0) {
    return {
      score: 0,
      band: 'unknown',
      components: [{ label: 'Course content', value: 'Nothing has been published yet' }],
    };
  }

  const completion = Math.min(1, input.lessonsCompleted / input.lessonsAvailable);
  const recency =
    input.daysSinceLastActivity === null
      ? 0
      : input.daysSinceLastActivity <= 3
        ? 1
        : input.daysSinceLastActivity <= 7
          ? 0.7
          : input.daysSinceLastActivity <= 14
            ? 0.4
            : 0.1;
  const time = Math.min(1, input.learningMinutes / (input.lessonsAvailable * 20));

  const score = Math.round((completion * 0.5 + recency * 0.3 + time * 0.2) * 100);

  return {
    score,
    band: score >= 60 ? 'active' : score >= 30 ? 'slipping' : 'inactive',
    components: [
      {
        label: 'Lessons completed',
        value: `${input.lessonsCompleted} of ${input.lessonsAvailable}`,
      },
      {
        label: 'Last opened the course',
        value:
          input.daysSinceLastActivity === null
            ? 'Never'
            : `${input.daysSinceLastActivity} days ago`,
      },
      { label: 'Time on the course', value: `${input.learningMinutes} minutes` },
      { label: 'Discussion posts', value: String(input.discussionPosts) },
    ],
  };
}

export interface RiskInput {
  missedAssessments: number;
  assessmentsDue: number;
  averageMarkPercent: number | null;
  passMarkPercent: number;
  attendancePercent: number | null;
  attendanceRequirement: number;
  consecutiveAbsences: number;
  engagement: EngagementScore;
  coursesIncomplete: number;
}

export interface RiskIndicator {
  key: string;
  /** What was measured, in the words a support officer would use. */
  statement: string;
  points: number;
}

export interface RiskAssessment {
  score: number;
  level: 'none' | 'watch' | 'concern' | 'urgent';
  indicators: RiskIndicator[];
  /** Plain statement of what this is and is not. */
  basis: string;
}

/**
 * Identifies learners who may need academic support. The score exists only to
 * order a list; the indicators are what anyone acts on. A learner with no
 * indicators scores zero and never appears, and nothing here is stored as a
 * judgement about the person.
 */
export function assessRisk(input: RiskInput): RiskAssessment {
  const indicators: RiskIndicator[] = [];

  if (input.missedAssessments > 0) {
    indicators.push({
      key: 'missed_assessments',
      statement:
        input.assessmentsDue > 0
          ? `Missed ${input.missedAssessments} of ${input.assessmentsDue} assessments that have fallen due.`
          : `Missed ${input.missedAssessments} assessments.`,
      points: Math.min(40, input.missedAssessments * 15),
    });
  }

  if (input.averageMarkPercent !== null && input.averageMarkPercent < input.passMarkPercent) {
    const shortfall = Math.round(input.passMarkPercent - input.averageMarkPercent);
    indicators.push({
      key: 'low_marks',
      statement: `Average mark of ${Math.round(input.averageMarkPercent)}%, which is ${shortfall} points below the pass mark.`,
      points: Math.min(30, 10 + shortfall),
    });
  }

  if (input.attendancePercent !== null && input.attendancePercent < input.attendanceRequirement) {
    indicators.push({
      key: 'low_attendance',
      statement: `Attendance of ${input.attendancePercent}%, against a requirement of ${input.attendanceRequirement}%.`,
      points: Math.min(25, Math.round(input.attendanceRequirement - input.attendancePercent)),
    });
  }

  if (input.consecutiveAbsences >= 3) {
    indicators.push({
      key: 'stopped_attending',
      statement: `Missed the last ${input.consecutiveAbsences} sessions in a row.`,
      points: 25,
    });
  }

  if (input.engagement.band === 'inactive') {
    indicators.push({
      key: 'not_opening_course',
      statement: `Has not engaged with the course material recently: ${input.engagement.components[1]?.value.toLowerCase()}.`,
      points: 20,
    });
  } else if (input.engagement.band === 'slipping') {
    indicators.push({
      key: 'low_engagement',
      statement: `Opening the course less than the class: ${input.engagement.components[0]?.value} lessons completed.`,
      points: 10,
    });
  }

  if (input.coursesIncomplete > 0) {
    indicators.push({
      key: 'incomplete_courses',
      statement: `${input.coursesIncomplete} courses carried without a result.`,
      points: Math.min(15, input.coursesIncomplete * 5),
    });
  }

  const score = Math.min(100, indicators.reduce((total, indicator) => total + indicator.points, 0));

  return {
    score,
    level: score === 0 ? 'none' : score >= 60 ? 'urgent' : score >= 35 ? 'concern' : 'watch',
    indicators,
    basis:
      'Based only on recorded activity: assessments, marks, attendance and course use. It says nothing about why, and it is a prompt to ask rather than a conclusion.',
  };
}

export interface Aggregate {
  label: string;
  count: number;
  value: number | null;
}

/**
 * Suppresses any group too small to report on. Publishing the pass rate of a
 * group of three names those three people to anyone who knows the group.
 */
export function suppressSmallGroups(
  aggregates: Aggregate[],
  minimum = MINIMUM_GROUP_SIZE,
): { reported: Aggregate[]; suppressed: number } {
  const reported = aggregates.map((aggregate) =>
    aggregate.count < minimum ? { ...aggregate, value: null } : aggregate,
  );

  return {
    reported,
    suppressed: aggregates.filter((aggregate) => aggregate.count < minimum).length,
  };
}

export interface TrendPoint {
  label: string;
  value: number;
}

export interface Trend {
  direction: 'up' | 'down' | 'flat';
  change: number;
  statement: string;
}

/** Compares the most recent period with the one before it, and says so plainly. */
export function describeTrend(points: TrendPoint[], unit = '%'): Trend | null {
  if (points.length < 2) return null;

  const latest = points[points.length - 1]!;
  const previous = points[points.length - 2]!;
  const change = Math.round((latest.value - previous.value) * 10) / 10;

  return {
    direction: change > 0 ? 'up' : change < 0 ? 'down' : 'flat',
    change,
    statement:
      change === 0
        ? `Unchanged from ${previous.label} at ${latest.value}${unit}.`
        : `${change > 0 ? 'Up' : 'Down'} ${Math.abs(change)}${unit} from ${previous.label} to ${latest.label}.`,
  };
}
