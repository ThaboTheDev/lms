import 'server-only';
import { prisma } from '@/lib/db';
import { recordAudit } from '@/lib/audit';
import { requirePermission, requireSameInstitution, type Principal } from '@/lib/rbac/authorize';
import { NotFoundError } from '@/lib/errors';
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

  const evaluated = await atRiskLearners(principal, 500);

  // Somebody followed up recently: the learner is not flagged again for the
  // same picture, only if it has got worse since.
  const followedUp = await prisma.atRiskFlag.findMany({
    where: { institutionId, acknowledgedAt: { gte: followUpWindowStart() } },
    select: { studentId: true, score: true },
  });
  const scoreWhenFollowedUp = new Map<string, number>();
  for (const flag of followedUp) {
    scoreWhenFollowedUp.set(flag.studentId, Math.max(flag.score, scoreWhenFollowedUp.get(flag.studentId) ?? 0));
  }
  const rows = evaluated.filter((row) => {
    const previous = scoreWhenFollowedUp.get(row.studentId);
    return previous === undefined || row.risk.score > previous;
  });

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

/** How long a follow-up keeps a learner off the list, unless things get worse. */
export const FOLLOW_UP_DAYS = 14;

function followUpWindowStart(at = new Date()): Date {
  return new Date(at.getTime() - FOLLOW_UP_DAYS * 24 * 60 * 60 * 1000);
}

interface StoredIndicators {
  level?: 'urgent' | 'concern' | 'watch' | 'none';
  basis?: string;
  indicators?: { key: string; statement: string }[];
}

export interface StoredFlag {
  id: string;
  studentId: string;
  studentNumber: string;
  name: string;
  programmeCode: string | null;
  score: number;
  level: 'urgent' | 'concern' | 'watch' | 'none';
  indicators: { key: string; statement: string }[];
  generatedAt: Date;
  acknowledgedAt: Date | null;
  acknowledgedBy: string | null;
}

/**
 * The list the nightly evaluation stored: what support staff work through
 * over days. Open flags first, most pressing first, then the ones somebody
 * followed up in the last fortnight with who and when.
 */
export async function listAtRiskFlags(principal: Principal): Promise<{
  open: StoredFlag[];
  followedUp: StoredFlag[];
  evaluatedAt: Date | null;
}> {
  requirePermission(principal, 'analytics.read');
  const institutionId = principal.institutionId;
  if (!institutionId) return { open: [], followedUp: [], evaluatedAt: null };

  const flags = await prisma.atRiskFlag.findMany({
    where: {
      institutionId,
      OR: [{ acknowledgedAt: null }, { acknowledgedAt: { gte: followUpWindowStart() } }],
    },
    orderBy: [{ score: 'desc' }, { generatedAt: 'desc' }],
    take: 500,
    select: {
      id: true,
      score: true,
      indicators: true,
      generatedAt: true,
      acknowledgedAt: true,
      acknowledgedById: true,
      student: {
        select: {
          id: true,
          studentNumber: true,
          user: { select: { firstName: true, lastName: true } },
          programmeEnrolments: {
            take: 1,
            orderBy: { enrolledOn: 'desc' },
            select: { programme: { select: { code: true } } },
          },
        },
      },
    },
  });

  const acknowledgerIds = [...new Set(flags.map((flag) => flag.acknowledgedById).filter((id): id is string => Boolean(id)))];
  const acknowledgers = acknowledgerIds.length
    ? await prisma.user.findMany({ where: { id: { in: acknowledgerIds } }, select: { id: true, firstName: true, lastName: true } })
    : [];
  const nameOf = new Map(acknowledgers.map((user) => [user.id, `${user.firstName} ${user.lastName}`]));

  const latest = await prisma.atRiskFlag.aggregate({ where: { institutionId }, _max: { generatedAt: true } });

  const shaped = flags.map((flag): StoredFlag => {
    const stored = (flag.indicators ?? {}) as StoredIndicators;
    return {
      id: flag.id,
      studentId: flag.student.id,
      studentNumber: flag.student.studentNumber,
      name: `${flag.student.user.firstName} ${flag.student.user.lastName}`,
      programmeCode: flag.student.programmeEnrolments[0]?.programme.code ?? null,
      score: flag.score,
      level: stored.level ?? 'watch',
      indicators: stored.indicators ?? [],
      generatedAt: flag.generatedAt,
      acknowledgedAt: flag.acknowledgedAt,
      acknowledgedBy: flag.acknowledgedById ? (nameOf.get(flag.acknowledgedById) ?? 'a colleague') : null,
    };
  });

  return {
    open: shaped.filter((flag) => !flag.acknowledgedAt),
    followedUp: shaped
      .filter((flag) => flag.acknowledgedAt)
      .sort((a, b) => b.acknowledgedAt!.getTime() - a.acknowledgedAt!.getTime()),
    evaluatedAt: latest._max.generatedAt,
  };
}

/** Records that somebody has followed up on a flag. */
export async function acknowledgeAtRiskFlag(principal: Principal, flagId: string) {
  requirePermission(principal, 'analytics.read');
  const flag = await prisma.atRiskFlag.findUnique({
    where: { id: flagId },
    select: { id: true, institutionId: true, studentId: true, acknowledgedAt: true },
  });
  if (!flag) throw new NotFoundError('Flag');
  requireSameInstitution(principal, flag.institutionId);
  if (flag.acknowledgedAt) return { acknowledged: false };

  await prisma.atRiskFlag.update({
    where: { id: flagId },
    data: { acknowledgedAt: new Date(), acknowledgedById: principal.userId },
  });
  await recordAudit(principal, {
    action: 'analytics.at_risk_followed_up',
    entityType: 'StudentProfile',
    entityId: flag.studentId,
  });
  return { acknowledged: true };
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
