import 'server-only';
import { randomInt } from 'node:crypto';
import { prisma } from '@/lib/db';
import { AppError, NotFoundError } from '@/lib/errors';
import { recordAudit } from '@/lib/audit';
import { requirePermission, requireSameInstitution, type Principal } from '@/lib/rbac/authorize';
import { assertCanEditOffering, assertCanViewOffering } from './course-builder';
import {
  checkCodeMatches,
  checkInWindow,
  findAbsencePattern,
  isLateArrival,
  summariseAttendance,
  type AttendanceEntry,
} from './attendance-rules';

function generateCheckInCode(): string {
  const alphabet = '23456789ABCDEFGHJKMNPQRSTVWXYZ';
  return Array.from({ length: 5 }, () => alphabet[randomInt(alphabet.length)]).join('');
}

export async function createSession(
  principal: Principal,
  offeringId: string,
  input: {
    title: string;
    mode: string;
    scheduledStart: Date;
    scheduledEnd: Date;
    venue?: string;
    selfCheckInEnabled?: boolean;
  },
) {
  const offering = await assertCanEditOffering(principal, offeringId);
  requirePermission(principal, 'attendance.manage', {
    institutionId: offering.institutionId,
    courseOfferingId: offeringId,
  });

  if (input.scheduledEnd <= input.scheduledStart) {
    throw new AppError('The session has to end after it starts.', 422, 'invalid_window');
  }

  const session = await prisma.attendanceSession.create({
    data: {
      institutionId: offering.institutionId,
      offeringId,
      title: input.title,
      mode: input.mode as never,
      scheduledStart: input.scheduledStart,
      scheduledEnd: input.scheduledEnd,
      venue: input.venue || null,
      selfCheckInEnabled: input.selfCheckInEnabled ?? false,
      checkInCode: input.selfCheckInEnabled ? generateCheckInCode() : null,
      createdById: principal.userId,
    },
  });

  // The register is created with every enrolled learner on it, unmarked. A
  // blank row is honest: it says nobody has taken the register yet, which is
  // different from saying the learner was absent.
  const enrolments = await prisma.courseEnrolment.findMany({
    where: { offeringId, status: 'ACTIVE' },
    select: { studentId: true },
  });

  if (enrolments.length > 0) {
    await prisma.attendanceRecord.createMany({
      data: enrolments.map((enrolment) => ({
        sessionId: session.id,
        studentId: enrolment.studentId,
        status: 'NOT_MARKED' as const,
      })),
      skipDuplicates: true,
    });
  }

  await prisma.calendarEvent.create({
    data: {
      institutionId: offering.institutionId,
      title: input.title,
      type: 'LECTURE',
      visibility: 'COURSE',
      startsAt: input.scheduledStart,
      endsAt: input.scheduledEnd,
      location: input.venue || null,
      offeringId,
      createdById: principal.userId,
    },
  });

  return session;
}

export async function loadRegister(principal: Principal, sessionId: string) {
  const session = await prisma.attendanceSession.findUnique({
    where: { id: sessionId },
    select: {
      id: true, institutionId: true, offeringId: true, title: true, mode: true,
      scheduledStart: true, scheduledEnd: true, venue: true,
      selfCheckInEnabled: true, checkInCode: true,
      offering: { select: { course: { select: { code: true, title: true } } } },
      records: {
        select: {
          id: true, status: true, method: true, markedAt: true, note: true,
          student: {
            select: { id: true, studentNumber: true, user: { select: { firstName: true, lastName: true } } },
          },
        },
      },
    },
  });
  if (!session) throw new NotFoundError('Attendance session');

  requireSameInstitution(principal, session.institutionId);
  const { viewer } = await assertCanViewOffering(principal, session.offeringId);

  // A learner never sees the whole class register, only their own row.
  const records =
    viewer === 'learner'
      ? session.records.filter((record) => record.student.id === principal.studentId)
      : [...session.records].sort((a, b) =>
          a.student.user.lastName.localeCompare(b.student.user.lastName),
        );

  return { session: { ...session, records }, viewer };
}

export async function markRegister(
  principal: Principal,
  sessionId: string,
  marks: { studentId: string; status: string; note?: string }[],
) {
  const session = await prisma.attendanceSession.findUnique({
    where: { id: sessionId },
    select: { id: true, institutionId: true, offeringId: true, title: true },
  });
  if (!session) throw new NotFoundError('Attendance session');

  requireSameInstitution(principal, session.institutionId);
  requirePermission(principal, 'attendance.manage', {
    institutionId: session.institutionId,
    courseOfferingId: session.offeringId,
  });

  await prisma.$transaction(
    marks.map((mark) =>
      prisma.attendanceRecord.upsert({
        where: { sessionId_studentId: { sessionId, studentId: mark.studentId } },
        create: {
          sessionId,
          studentId: mark.studentId,
          status: mark.status as never,
          method: 'MANUAL',
          markedById: principal.userId,
          markedAt: new Date(),
          note: mark.note ?? null,
        },
        update: {
          status: mark.status as never,
          method: 'MANUAL',
          markedById: principal.userId,
          markedAt: new Date(),
          note: mark.note ?? null,
        },
      }),
    ),
  );

  await recordAudit(principal, {
    action: 'attendance.marked',
    entityType: 'AttendanceSession',
    entityId: sessionId,
    institutionId: session.institutionId,
    after: { title: session.title, marked: marks.length },
  });

  return { marked: marks.length };
}

/**
 * A learner marking themselves present. The window, the code and the enrolment
 * are all checked here rather than in the page, because the page is the thing
 * an enterprising learner will try to work around.
 */
export async function selfCheckIn(principal: Principal, sessionId: string, code: string) {
  if (!principal.studentId) throw new AppError('Only a learner checks in.', 403, 'not_a_learner');

  const session = await prisma.attendanceSession.findUnique({
    where: { id: sessionId },
    select: {
      id: true, institutionId: true, offeringId: true, scheduledStart: true,
      scheduledEnd: true, selfCheckInEnabled: true, checkInCode: true,
    },
  });
  if (!session) throw new NotFoundError('Attendance session');
  requireSameInstitution(principal, session.institutionId);

  const enrolled = await prisma.courseEnrolment.count({
    where: { offeringId: session.offeringId, studentId: principal.studentId, status: 'ACTIVE' },
  });
  if (enrolled === 0) throw new AppError('You are not registered for this course.', 403, 'not_enrolled');

  const window = checkInWindow(session);
  if (window.state === 'early') {
    throw new AppError(
      `Check-in opens at ${window.opensAt.toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' })}.`,
      409,
      'check_in_not_open',
    );
  }
  if (window.state === 'closed') {
    throw new AppError('Check-in for this session has closed. Speak to your lecturer.', 409, 'check_in_closed');
  }

  if (!checkCodeMatches(session.checkInCode, code)) {
    throw new AppError('That code does not match this session.', 422, 'wrong_code');
  }

  const now = new Date();
  const status = isLateArrival(session.scheduledStart, now) ? 'LATE' : 'PRESENT';

  await prisma.attendanceRecord.upsert({
    where: { sessionId_studentId: { sessionId, studentId: principal.studentId } },
    create: {
      sessionId,
      studentId: principal.studentId,
      status: status as never,
      method: 'SELF_CHECK_IN',
      markedAt: now,
    },
    update: { status: status as never, method: 'SELF_CHECK_IN', markedAt: now },
  });

  return { status };
}

/** Attendance for one course delivery, per learner, with the flagged ones first. */
export async function attendanceReport(principal: Principal, offeringId: string) {
  const { offering } = await assertCanViewOffering(principal, offeringId);
  requirePermission(principal, 'attendance.read', {
    institutionId: offering.institutionId,
    courseOfferingId: offeringId,
  });

  const [sessions, enrolments] = await Promise.all([
    prisma.attendanceSession.findMany({
      where: { offeringId },
      orderBy: { scheduledStart: 'asc' },
      select: {
        id: true, title: true, scheduledStart: true, mode: true,
        records: { select: { studentId: true, status: true } },
        _count: { select: { records: true } },
      },
    }),
    prisma.courseEnrolment.findMany({
      where: { offeringId, status: { in: ['ACTIVE', 'COMPLETED'] } },
      select: {
        student: {
          select: { id: true, studentNumber: true, user: { select: { firstName: true, lastName: true } } },
        },
      },
    }),
  ]);

  const rows = enrolments.map((enrolment) => {
    const entries: AttendanceEntry[] = sessions.map((session) => ({
      sessionId: session.id,
      scheduledStart: session.scheduledStart,
      status:
        (session.records.find((record) => record.studentId === enrolment.student.id)?.status as never) ??
        'NOT_MARKED',
    }));

    return {
      student: enrolment.student,
      summary: summariseAttendance(entries),
      pattern: findAbsencePattern(entries),
    };
  });

  rows.sort((a, b) => {
    if (a.pattern.concerning !== b.pattern.concerning) return a.pattern.concerning ? -1 : 1;
    return a.summary.percentage - b.summary.percentage;
  });

  return { offering, sessions, rows };
}

/** A learner's own attendance across every course they are taking. */
export async function myAttendance(principal: Principal) {
  if (!principal.studentId) return [];

  const records = await prisma.attendanceRecord.findMany({
    where: { studentId: principal.studentId },
    select: {
      status: true,
      session: {
        select: {
          id: true,
          scheduledStart: true,
          offering: {
            select: { id: true, course: { select: { code: true, title: true } } },
          },
        },
      },
    },
  });

  const byOffering = new Map<string, { course: { code: string; title: string }; offeringId: string; entries: AttendanceEntry[] }>();

  for (const record of records) {
    const offeringId = record.session.offering.id;
    const bucket = byOffering.get(offeringId) ?? {
      offeringId,
      course: record.session.offering.course as { code: string; title: string },
      entries: [] as AttendanceEntry[],
    };
    bucket.entries.push({
      sessionId: record.session.id,
      status: record.status,
      scheduledStart: record.session.scheduledStart,
    } as AttendanceEntry);
    byOffering.set(offeringId, bucket);
  }

  return [...byOffering.values()].map((bucket) => ({
    offeringId: bucket.offeringId,
    course: bucket.course,
    summary: summariseAttendance(bucket.entries),
    pattern: findAbsencePattern(bucket.entries),
  }));
}
