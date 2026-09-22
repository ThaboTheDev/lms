import { describe, expect, it } from 'vitest';
import {
  checkCodeMatches,
  checkInWindow,
  checkRequirement,
  findAbsencePattern,
  isLateArrival,
  summariseAttendance,
  type AttendanceEntry,
  type AttendanceStatus,
} from '@/server/services/attendance-rules';

const entry = (status: AttendanceStatus, day: number): AttendanceEntry => ({
  sessionId: `s${day}`,
  status,
  scheduledStart: new Date(2026, 2, day, 9, 0),
});

describe('attendance percentage', () => {
  it('counts present and late as attended', () => {
    const summary = summariseAttendance([entry('PRESENT', 1), entry('LATE', 2), entry('ABSENT', 3)]);
    expect(summary.attended).toBe(2);
    expect(summary.percentage).toBe(66.7);
  });

  it('takes excused absences out of the denominator', () => {
    const summary = summariseAttendance([entry('PRESENT', 1), entry('EXCUSED', 2), entry('EXCUSED', 3)]);
    expect(summary.excused).toBe(2);
    expect(summary.percentage).toBe(100);
  });

  it('reports unmarked sessions separately instead of guessing', () => {
    const summary = summariseAttendance([entry('PRESENT', 1), entry('NOT_MARKED', 2)]);
    expect(summary.notMarked).toBe(1);
    expect(summary.percentage).toBe(100);
  });

  it('reads an empty register as full attendance rather than zero', () => {
    expect(summariseAttendance([]).percentage).toBe(100);
  });
});

describe('attendance requirements', () => {
  it('passes a learner above the line', () => {
    const summary = summariseAttendance([entry('PRESENT', 1), entry('PRESENT', 2), entry('ABSENT', 3)]);
    expect(checkRequirement(summary, 60).meets).toBe(true);
  });

  it('says how many more sessions would fix it', () => {
    const summary = summariseAttendance([entry('PRESENT', 1), entry('ABSENT', 2), entry('ABSENT', 3)]);
    const check = checkRequirement(summary, 75);
    expect(check.meets).toBe(false);
    expect(check.shortfallSessions).toBeGreaterThan(0);

    const projected = ((summary.attended + check.shortfallSessions) /
      (summary.attended + summary.absent + check.shortfallSessions)) * 100;
    expect(projected).toBeGreaterThanOrEqual(75);
  });
});

describe('self check-in', () => {
  const session = {
    scheduledStart: new Date('2026-03-10T09:00:00Z'),
    scheduledEnd: new Date('2026-03-10T11:00:00Z'),
    selfCheckInEnabled: true,
  };

  it('opens shortly before the session', () => {
    expect(checkInWindow(session, new Date('2026-03-10T08:50:00Z')).state).toBe('open');
    expect(checkInWindow(session, new Date('2026-03-10T08:00:00Z')).state).toBe('early');
  });

  it('closes part way in, so nobody marks themselves present afterwards', () => {
    expect(checkInWindow(session, new Date('2026-03-10T09:10:00Z')).state).toBe('open');
    expect(checkInWindow(session, new Date('2026-03-10T09:45:00Z')).state).toBe('closed');
    expect(checkInWindow(session, new Date('2026-03-10T14:00:00Z')).state).toBe('closed');
  });

  it('never opens when self check-in is switched off', () => {
    expect(
      checkInWindow({ ...session, selfCheckInEnabled: false }, new Date('2026-03-10T09:05:00Z')).state,
    ).toBe('closed');
  });

  it('closes with the session when the session is shorter than the window', () => {
    const short = {
      scheduledStart: new Date('2026-03-10T09:00:00Z'),
      scheduledEnd: new Date('2026-03-10T09:10:00Z'),
      selfCheckInEnabled: true,
    };
    const window = checkInWindow(short, new Date('2026-03-10T09:05:00Z'));
    expect(window.state).toBe('open');
    if (window.state === 'open') {
      expect(window.closesAt.toISOString()).toBe('2026-03-10T09:10:00.000Z');
    }
  });

  it('marks a late arrival after the grace period', () => {
    const start = new Date('2026-03-10T09:00:00Z');
    expect(isLateArrival(start, new Date('2026-03-10T09:05:00Z'))).toBe(false);
    expect(isLateArrival(start, new Date('2026-03-10T09:20:00Z'))).toBe(true);
  });

  it('matches a check-in code ignoring case and spacing', () => {
    expect(checkCodeMatches('7K3M', ' 7k3m ')).toBe(true);
    expect(checkCodeMatches('7K3M', '7K3N')).toBe(false);
    expect(checkCodeMatches(null, '7K3M')).toBe(false);
  });
});

describe('absence patterns', () => {
  it('counts absences back from the most recent session', () => {
    const pattern = findAbsencePattern([
      entry('PRESENT', 1),
      entry('ABSENT', 2),
      entry('ABSENT', 3),
      entry('ABSENT', 4),
    ]);
    expect(pattern.consecutiveAbsences).toBe(3);
    expect(pattern.concerning).toBe(true);
    expect(pattern.lastAttendedOn).toEqual(new Date(2026, 2, 1, 9, 0));
  });

  it('resets once the learner comes back', () => {
    const pattern = findAbsencePattern([entry('ABSENT', 1), entry('ABSENT', 2), entry('PRESENT', 3)]);
    expect(pattern.consecutiveAbsences).toBe(0);
    expect(pattern.concerning).toBe(false);
  });

  it('spots the learner at a decent percentage who has stopped coming', () => {
    const entries = [
      ...Array.from({ length: 8 }, (_, index) => entry('PRESENT', index + 1)),
      entry('ABSENT', 9),
      entry('ABSENT', 10),
      entry('ABSENT', 11),
    ];
    expect(summariseAttendance(entries).percentage).toBeGreaterThan(70);
    expect(findAbsencePattern(entries).concerning).toBe(true);
  });
});
