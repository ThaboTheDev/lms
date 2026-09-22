/**
 * Attendance arithmetic and check-in rules. Pure, because an attendance
 * percentage can decide whether a learner is admitted to an examination, and a
 * figure that decides that must be produced the same way everywhere.
 */

export type AttendanceStatus = 'PRESENT' | 'ABSENT' | 'LATE' | 'EXCUSED' | 'NOT_MARKED';

export interface AttendanceEntry {
  sessionId: string;
  status: AttendanceStatus;
  scheduledStart: Date;
}

export interface AttendanceSummary {
  sessionsHeld: number;
  attended: number;
  absent: number;
  excused: number;
  notMarked: number;
  /** Percentage of sessions the learner was required to attend and did. */
  percentage: number;
}

/**
 * Excused absences come out of the denominator rather than counting against
 * the learner: an institution that grants leave and then penalises it is not
 * granting leave. Sessions nobody marked are reported separately rather than
 * quietly counted as attendance or as absence.
 */
export function summariseAttendance(entries: AttendanceEntry[]): AttendanceSummary {
  const held = entries.filter((entry) => entry.status !== 'NOT_MARKED');
  const attended = held.filter((entry) => entry.status === 'PRESENT' || entry.status === 'LATE').length;
  const excused = held.filter((entry) => entry.status === 'EXCUSED').length;
  const absent = held.filter((entry) => entry.status === 'ABSENT').length;
  const required = attended + absent;

  return {
    sessionsHeld: entries.length,
    attended,
    absent,
    excused,
    notMarked: entries.length - held.length,
    percentage: required > 0 ? Math.round((attended / required) * 1000) / 10 : 100,
  };
}

export interface RequirementCheck {
  meets: boolean;
  percentage: number;
  shortfallSessions: number;
}

/**
 * Whether a learner meets an attendance requirement, and if not, how many more
 * sessions they would have to attend to reach it. Telling someone they are at
 * 68% is less useful than telling them they need two more.
 */
export function checkRequirement(
  summary: AttendanceSummary,
  requiredPercent: number,
): RequirementCheck {
  if (summary.percentage >= requiredPercent) {
    return { meets: true, percentage: summary.percentage, shortfallSessions: 0 };
  }

  const required = summary.attended + summary.absent;
  let extra = 0;
  // Each additional attended session raises both the numerator and the base.
  while (extra < 500) {
    extra += 1;
    const projected = ((summary.attended + extra) / (required + extra)) * 100;
    if (projected >= requiredPercent) break;
  }

  return { meets: false, percentage: summary.percentage, shortfallSessions: extra };
}

export type CheckInWindow =
  | { state: 'open'; closesAt: Date }
  | { state: 'early'; opensAt: Date }
  | { state: 'closed' };

/**
 * Self check-in opens shortly before a session and closes part way through, so
 * a learner cannot mark themselves present from home an hour after it ended.
 */
export function checkInWindow(
  session: { scheduledStart: Date; scheduledEnd: Date; selfCheckInEnabled: boolean },
  now: Date = new Date(),
  options: { opensMinutesBefore?: number; closesMinutesAfterStart?: number } = {},
): CheckInWindow {
  if (!session.selfCheckInEnabled) return { state: 'closed' };

  const opensAt = new Date(session.scheduledStart.getTime() - (options.opensMinutesBefore ?? 15) * 60_000);
  const closesAt = new Date(
    Math.min(
      session.scheduledStart.getTime() + (options.closesMinutesAfterStart ?? 20) * 60_000,
      session.scheduledEnd.getTime(),
    ),
  );

  if (now < opensAt) return { state: 'early', opensAt };
  if (now > closesAt) return { state: 'closed' };
  return { state: 'open', closesAt };
}

/** A learner arriving after this is marked late rather than present. */
export function isLateArrival(
  scheduledStart: Date,
  arrivedAt: Date,
  graceMinutes = 10,
): boolean {
  return arrivedAt.getTime() > scheduledStart.getTime() + graceMinutes * 60_000;
}

export function checkCodeMatches(expected: string | null, given: string): boolean {
  if (!expected) return false;
  const clean = (value: string) => value.replace(/[^0-9a-z]/gi, '').toUpperCase();
  return clean(expected).length > 0 && clean(expected) === clean(given);
}

export interface AbsencePattern {
  consecutiveAbsences: number;
  /** True once the learner has missed enough in a row to be worth a call. */
  concerning: boolean;
  lastAttendedOn: Date | null;
}

/**
 * Consecutive absences are a better early signal than a percentage: a learner
 * at 80% who has missed the last four sessions is the one to phone.
 */
export function findAbsencePattern(
  entries: AttendanceEntry[],
  threshold = 3,
): AbsencePattern {
  const ordered = [...entries]
    .filter((entry) => entry.status !== 'NOT_MARKED')
    .sort((a, b) => b.scheduledStart.getTime() - a.scheduledStart.getTime());

  let consecutive = 0;
  let lastAttendedOn: Date | null = null;

  for (const entry of ordered) {
    if (entry.status === 'ABSENT') {
      consecutive += 1;
      continue;
    }
    if (entry.status === 'PRESENT' || entry.status === 'LATE') {
      lastAttendedOn = entry.scheduledStart;
    }
    break;
  }

  return { consecutiveAbsences: consecutive, concerning: consecutive >= threshold, lastAttendedOn };
}
