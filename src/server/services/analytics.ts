import 'server-only';
import { prisma } from '@/lib/db';
import { recordAudit } from '@/lib/audit';
import { requirePermission, type Principal } from '@/lib/rbac/authorize';
import { summariseAttendance, findAbsencePattern, type AttendanceEntry } from './attendance-rules';
import { toPercent } from './grading-rules';
import {
  assessRisk,
  scoreEngagement,
  suppressSmallGroups,
  type RiskAssessment,
} from './analytics-rules';

const ATTENDANCE_REQUIREMENT = 75;

export interface LearnerAnalytics {
  studentId: string;
  studentNumber: string;
  name: string;
  programmeCode: string | null;
  engagementScore: number;
  risk: RiskAssessment;
}

/**
 * Builds the at-risk picture for one institution. Every input is something the
 * institution recorded, and every learner who appears carries the reasons they
 * appeared, because a list of names with scores is an invitation to guess.
 */
export async function atRiskLearners(principal: Principal, limit = 50): Promise<LearnerAnalytics[]> {
  requirePermission(principal, 'analytics.read');
  const institutionId = principal.institutionId ?? undefined;

  const students = await prisma.studentProfile.findMany({
    where: { institutionId, admissionStatus: 'REGISTERED' },
    take: 500,
    select: {
      id: true,
      studentNumber: true,
      user: { select: { firstName: true, lastName: true } },
      programmeEnrolments: {
        take: 1,
        orderBy: { enrolledOn: 'desc' },
        select: { programme: { select: { code: true } } },
      },
      courseProgress: {
        select: { percentComplete: true, lessonsTotal: true, lessonsComplete: true, learningMinutes: true, lastActivityAt: true },
      },
      courseEnrolments: { select: { result: true, finalMark: true } },
      attendance: {
        select: { status: true, session: { select: { scheduledStart: true, id: true } } },
      },
      submissions: {
        select: {
          status: true,
          finalMark: true,
          assessment: { select: { maxMark: true, dueAt: true, weight: true } },
        },
      },
    },
  });

  const now = Date.now();
  const rows: LearnerAnalytics[] = [];

  for (const student of students) {
    const progress = student.courseProgress as {
      lessonsTotal: number;
      lessonsComplete: number;
      learningMinutes: number;
      lastActivityAt: Date | null;
    }[];

    const lastActivity = progress
      .map((entry) => entry.lastActivityAt?.getTime() ?? 0)
      .reduce((latest, value) => Math.max(latest, value), 0);

    const engagement = scoreEngagement({
      lessonsAvailable: progress.reduce((total, entry) => total + entry.lessonsTotal, 0),
      lessonsCompleted: progress.reduce((total, entry) => total + entry.lessonsComplete, 0),
      learningMinutes: progress.reduce((total, entry) => total + entry.learningMinutes, 0),
      daysSinceLastActivity: lastActivity > 0 ? Math.floor((now - lastActivity) / 86_400_000) : null,
      discussionPosts: 0,
    });

    const entries: AttendanceEntry[] = (student.attendance as {
      status: string;
      session: { id: string; scheduledStart: Date };
    }[]).map((record) => ({
      sessionId: record.session.id,
      status: record.status as never,
      scheduledStart: record.session.scheduledStart,
    }));

    const attendance = entries.length > 0 ? summariseAttendance(entries) : null;
    const pattern = findAbsencePattern(entries);

    const submissions = student.submissions as {
      status: string;
      finalMark: unknown;
      assessment: { maxMark: unknown; dueAt: Date | null; weight: unknown };
    }[];

    const due = submissions.filter((submission) => submission.assessment.dueAt && submission.assessment.dueAt.getTime() < now);
    const missed = due.filter((submission) => ['NOT_STARTED', 'IN_PROGRESS'].includes(submission.status));

    const marked = submissions.filter((submission) => submission.finalMark !== null);
    const averageMark =
      marked.length > 0
        ? marked.reduce(
            (total, submission) =>
              total + toPercent(Number(submission.finalMark), Number(submission.assessment.maxMark)),
            0,
          ) / marked.length
        : null;

    const incomplete = (student.courseEnrolments as { result: string }[]).filter((enrolment) =>
      ['INCOMPLETE', 'FAIL', 'NOT_YET_COMPETENT'].includes(enrolment.result),
    ).length;

    const risk = assessRisk({
      missedAssessments: missed.length,
      assessmentsDue: due.length,
      averageMarkPercent: averageMark,
      passMarkPercent: 50,
      attendancePercent: attendance?.percentage ?? null,
      attendanceRequirement: ATTENDANCE_REQUIREMENT,
      consecutiveAbsences: pattern.consecutiveAbsences,
      engagement,
      coursesIncomplete: incomplete,
    });

    if (risk.level === 'none') continue;

    rows.push({
      studentId: student.id,
      studentNumber: student.studentNumber,
      name: `${student.user.firstName} ${student.user.lastName}`,
      programmeCode: student.programmeEnrolments[0]?.programme.code ?? null,
      engagementScore: engagement.score,
      risk,
    });
  }

  return rows.sort((a, b) => b.risk.score - a.risk.score).slice(0, limit);
}

/**
 * Stores the flags so that support staff can work a list over days rather than
 * rebuilding it on every page load. The indicators are stored with the score,
 * because the score on its own is not actionable and not explainable.
 */
export async function refreshAtRiskFlags(principal: Principal) {
  requirePermission(principal, 'analytics.read');
  const institutionId = principal.institutionId;
  if (!institutionId) return { written: 0 };

  const rows = await atRiskLearners(principal, 500);

  await prisma.$transaction([
    prisma.atRiskFlag.deleteMany({ where: { institutionId, acknowledgedAt: null } }),
    prisma.atRiskFlag.createMany({
      data: rows.map((row) => ({
        institutionId,
        studentId: row.studentId,
        score: row.risk.score,
        indicators: {
          level: row.risk.level,
          basis: row.risk.basis,
          indicators: row.risk.indicators,
        } as never,
      })),
    }),
  ]);

  await recordAudit(principal, {
    action: 'analytics.at_risk_refreshed',
    entityType: 'Institution',
    entityId: institutionId,
    after: { flagged: rows.length },
  });

  return { written: rows.length };
}

/** Engagement and outcome figures by programme, with small groups suppressed. */
export async function programmeAnalytics(principal: Principal) {
  requirePermission(principal, 'analytics.read');
  const institutionId = principal.institutionId ?? undefined;

  const programmes = await prisma.programme.findMany({
    where: { institutionId },
    select: {
      id: true,
      code: true,
      title: true,
      enrolments: { where: { status: 'ACTIVE' }, select: { studentId: true } },
    },
  });

  const results = await prisma.courseEnrolment.groupBy({
    by: ['result'],
    where: { institutionId },
    _count: { _all: true },
  });

  const aggregates = programmes.map((programme) => ({
    label: `${programme.code} · ${programme.title}`,
    count: programme.enrolments.length,
    value: programme.enrolments.length,
  }));

  return {
    programmes: suppressSmallGroups(aggregates),
    results: (results as { result: string; _count: { _all: number } }[]).map((row) => ({
      result: row.result,
      count: row._count._all,
    })),
  };
}
