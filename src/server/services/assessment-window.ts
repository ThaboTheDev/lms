/**
 * When a learner may start, continue or submit an attempt. Pure, and used by
 * both the page that renders the button and the action that accepts the
 * submission, so a stale page cannot smuggle a late attempt past the rule.
 */

export interface AssessmentTiming {
  status: string;
  opensAt: Date | null;
  dueAt: Date | null;
  closesAt: Date | null;
  timeLimitMinutes: number | null;
  maxAttempts: number;
  allowLate: boolean;
}

export interface AttemptSummary {
  attemptNumber: number;
  status: string;
  startedAt: Date | null;
  submittedAt: Date | null;
}

export type AttemptGate =
  | { can: 'start'; attemptNumber: number; lateWarning: boolean }
  | { can: 'resume'; attemptNumber: number; deadline: Date | null }
  | { can: 'no'; reason: string };

const OPEN_STATUSES = ['PUBLISHED'];

/** The point at which an in-progress attempt is auto-submitted. */
export function attemptDeadline(
  assessment: AssessmentTiming,
  startedAt: Date | null,
): Date | null {
  const limits: Date[] = [];
  if (assessment.timeLimitMinutes && startedAt) {
    limits.push(new Date(startedAt.getTime() + assessment.timeLimitMinutes * 60_000));
  }
  if (assessment.closesAt) limits.push(assessment.closesAt);
  if (limits.length === 0) return null;
  return limits.reduce((earliest, candidate) => (candidate < earliest ? candidate : earliest));
}

export function secondsRemaining(deadline: Date | null, now: Date = new Date()): number | null {
  if (!deadline) return null;
  return Math.max(0, Math.round((deadline.getTime() - now.getTime()) / 1000));
}

export function canStartAttempt(
  assessment: AssessmentTiming,
  attempts: AttemptSummary[],
  now: Date = new Date(),
): AttemptGate {
  if (!OPEN_STATUSES.includes(assessment.status)) {
    return { can: 'no', reason: 'This assessment has not been released yet.' };
  }
  if (assessment.opensAt && now < assessment.opensAt) {
    return {
      can: 'no',
      reason: `This assessment opens on ${assessment.opensAt.toLocaleString('en-ZA', { dateStyle: 'long', timeStyle: 'short' })}.`,
    };
  }

  const inProgress = attempts.find((attempt) => attempt.status === 'IN_PROGRESS');
  if (inProgress) {
    return {
      can: 'resume',
      attemptNumber: inProgress.attemptNumber,
      deadline: attemptDeadline(assessment, inProgress.startedAt),
    };
  }

  const used = attempts.filter((attempt) => attempt.status !== 'VOID').length;
  if (used >= assessment.maxAttempts) {
    return {
      can: 'no',
      reason:
        assessment.maxAttempts === 1
          ? 'You have already submitted this assessment.'
          : `You have used all ${assessment.maxAttempts} attempts.`,
    };
  }

  if (assessment.closesAt && now > assessment.closesAt) {
    return { can: 'no', reason: 'This assessment has closed.' };
  }
  if (assessment.dueAt && now > assessment.dueAt && !assessment.allowLate) {
    return { can: 'no', reason: 'The due date has passed and late submissions are not accepted.' };
  }

  return {
    can: 'start',
    attemptNumber: used + 1,
    lateWarning: Boolean(assessment.dueAt && now > assessment.dueAt),
  };
}

export type SubmitGate = { can: true; isLate: boolean } | { can: false; reason: string };

/** Checked again at the moment of submission, not only when the page rendered. */
export function canSubmitAttempt(
  assessment: AssessmentTiming,
  attempt: AttemptSummary,
  now: Date = new Date(),
): SubmitGate {
  if (attempt.status === 'SUBMITTED' || attempt.status === 'GRADED') {
    return { can: false, reason: 'This attempt has already been submitted.' };
  }
  if (attempt.status === 'VOID') {
    return { can: false, reason: 'This attempt was voided.' };
  }

  const deadline = attemptDeadline(assessment, attempt.startedAt);
  const isLate = Boolean(assessment.dueAt && now > assessment.dueAt);

  // An attempt past its own deadline is still accepted here: the auto-submit
  // job and a slow network both land in this branch, and losing a learner's
  // work to a few seconds of clock drift is the worse failure.
  if (deadline && now.getTime() > deadline.getTime() + 120_000 && !assessment.allowLate) {
    return { can: false, reason: 'The time limit for this attempt has passed.' };
  }

  return { can: true, isLate };
}

export interface LearnerAssessmentState {
  label: string;
  tone: 'neutral' | 'active' | 'caution' | 'danger';
}

/** What a learner sees next to an assessment in their list. */
export function describeState(
  assessment: AssessmentTiming,
  attempts: AttemptSummary[],
  resultsReleased: boolean,
  now: Date = new Date(),
): LearnerAssessmentState {
  const submitted = attempts.find((attempt) => ['SUBMITTED', 'GRADED', 'RETURNED'].includes(attempt.status));

  if (submitted && resultsReleased) return { label: 'Result available', tone: 'active' };
  if (submitted) return { label: 'Submitted, awaiting marking', tone: 'neutral' };
  if (attempts.some((attempt) => attempt.status === 'IN_PROGRESS')) {
    return { label: 'In progress', tone: 'caution' };
  }
  if (assessment.closesAt && now > assessment.closesAt) return { label: 'Closed, not submitted', tone: 'danger' };
  if (assessment.dueAt && now > assessment.dueAt) return { label: 'Overdue', tone: 'danger' };
  if (assessment.dueAt) {
    const days = Math.ceil((assessment.dueAt.getTime() - now.getTime()) / 86_400_000);
    if (days <= 3) return { label: `Due in ${days} ${days === 1 ? 'day' : 'days'}`, tone: 'caution' };
  }
  return { label: 'Not started', tone: 'neutral' };
}
