import 'server-only';
import { prisma } from '@/lib/db';
import { requirePermission, type Principal } from '@/lib/rbac/authorize';

export interface HeadcountRow {
  programmeId: string;
  programmeCode: string;
  programmeTitle: string;
  qualificationType: string;
  active: number;
  completed: number;
  withdrawn: number;
}

/**
 * Registrar headcount by programme for one academic year. Counted with grouped
 * aggregates rather than by loading enrolment rows, so the figure stays cheap
 * at twenty thousand learners.
 */
export async function headcountByProgramme(
  principal: Principal,
  academicYearId: string,
): Promise<HeadcountRow[]> {
  requirePermission(principal, 'report.read');
  const institutionId = principal.institutionId ?? undefined;

  const [grouped, programmes] = await Promise.all([
    prisma.programmeEnrolment.groupBy({
      by: ['programmeId', 'status'],
      where: { institutionId, academicYearId },
      _count: { _all: true },
    }),
    prisma.programme.findMany({
      where: { institutionId },
      select: {
        id: true,
        code: true,
        title: true,
        qualification: { select: { type: true } },
      },
      orderBy: { code: 'asc' },
    }),
  ]);

  return programmes.map((programme) => {
    const rows = grouped.filter((row) => row.programmeId === programme.id);
    const countFor = (status: string) =>
      rows.find((row) => row.status === status)?._count._all ?? 0;

    return {
      programmeId: programme.id,
      programmeCode: programme.code,
      programmeTitle: programme.title,
      qualificationType: programme.qualification.type,
      active: countFor('ACTIVE'),
      completed: countFor('COMPLETED'),
      withdrawn: countFor('WITHDRAWN') + countFor('EXCLUDED'),
    };
  });
}

/** Counts of live applications by status, for the admissions pipeline view. */
export async function admissionsPipeline(principal: Principal, academicYearId?: string) {
  requirePermission(principal, 'application.read');
  const institutionId = principal.institutionId ?? undefined;

  const grouped = await prisma.application.groupBy({
    by: ['status'],
    where: { institutionId, ...(academicYearId ? { academicYearId } : {}) },
    _count: { _all: true },
  });

  return grouped.map((row) => ({ status: row.status, count: row._count._all }));
}

/** Cohort headcount, used for timetabling and venue planning. */
export async function headcountByCohort(principal: Principal, academicYearId: string) {
  requirePermission(principal, 'report.read');

  const cohorts = await prisma.cohort.findMany({
    where: { institutionId: principal.institutionId ?? undefined, academicYearId },
    select: {
      id: true,
      code: true,
      name: true,
      programme: { select: { code: true } },
      _count: { select: { enrolments: true } },
    },
    orderBy: { code: 'asc' },
  });

  return cohorts.map((cohort) => ({
    id: cohort.id,
    code: cohort.code,
    name: cohort.name,
    programmeCode: cohort.programme.code,
    learners: cohort._count.enrolments,
  }));
}

/* -------------------------------------------- institutional reporting ---- */

import { toCents, sum as sumCents } from '@/lib/money';

export interface AcademicReport {
  assessmentsPublished: number;
  submissionsMarked: number;
  passRate: number | null;
  distribution: { band: string; count: number }[];
  coursesWithResults: number;
}

/**
 * Academic performance across the institution. Pass rate is computed from
 * resolved course results only; courses still being marked are counted
 * separately rather than dragging the figure down.
 */
export async function academicReport(
  principal: Principal,
  academicYearId?: string,
): Promise<AcademicReport> {
  requirePermission(principal, 'report.read');
  const institutionId = principal.institutionId ?? undefined;

  const termFilter = academicYearId
    ? { offering: { academicTerm: { academicYearId } } }
    : {};

  const [published, marked, results] = await Promise.all([
    prisma.assessment.count({ where: { institutionId, status: { in: ['PUBLISHED', 'CLOSED'] } } }),
    prisma.submission.count({ where: { status: { in: ['GRADED', 'RETURNED'] } } }),
    prisma.courseEnrolment.findMany({
      where: { institutionId, result: { not: 'PENDING' }, ...termFilter },
      select: { result: true, finalMark: true },
    }),
  ]);

  const rows = results as { result: string; finalMark: unknown }[];
  const resolved = rows.filter((row) => row.result !== 'WITHDRAWN' && row.result !== 'INCOMPLETE');
  const passed = resolved.filter((row) =>
    ['PASS', 'PASS_WITH_DISTINCTION', 'COMPETENT'].includes(row.result),
  );

  const bands = [
    { band: '0 to 39', min: 0, max: 39.99 },
    { band: '40 to 49', min: 40, max: 49.99 },
    { band: '50 to 59', min: 50, max: 59.99 },
    { band: '60 to 74', min: 60, max: 74.99 },
    { band: '75 and above', min: 75, max: 100 },
  ];

  const distribution = bands.map((band) => ({
    band: band.band,
    count: rows.filter((row) => {
      if (row.finalMark === null || row.finalMark === undefined) return false;
      const mark = Number(row.finalMark);
      return mark >= band.min && mark <= band.max;
    }).length,
  }));

  return {
    assessmentsPublished: published,
    submissionsMarked: marked,
    passRate: resolved.length > 0 ? Math.round((passed.length / resolved.length) * 1000) / 10 : null,
    distribution,
    coursesWithResults: resolved.length,
  };
}

export interface DeliveryReport {
  offeringsRunning: number;
  lessonsPublished: number;
  averageCourseProgress: number | null;
  attendanceMarkedSessions: number;
  attendanceSessions: number;
  activeLecturers: number;
}

export async function deliveryReport(principal: Principal): Promise<DeliveryReport> {
  requirePermission(principal, 'report.read');
  const institutionId = principal.institutionId ?? undefined;

  const [offerings, lessons, progress, sessions, markedSessions, lecturers] = await Promise.all([
    prisma.courseOffering.count({ where: { institutionId, status: 'ACTIVE' } }),
    prisma.lesson.count({ where: { isPublished: true, section: { offering: { institutionId } } } }),
    prisma.courseProgress.aggregate({
      where: { offering: { institutionId } },
      _avg: { percentComplete: true },
    }),
    prisma.attendanceSession.count({ where: { institutionId } }),
    prisma.attendanceSession.count({
      where: { institutionId, records: { some: { status: { not: 'NOT_MARKED' } } } },
    }),
    prisma.offeringStaff.findMany({
      where: { role: 'LECTURER', offering: { institutionId, status: 'ACTIVE' } },
      select: { userId: true },
    }),
  ]);

  return {
    offeringsRunning: offerings,
    lessonsPublished: lessons,
    averageCourseProgress:
      progress._avg.percentComplete !== null && progress._avg.percentComplete !== undefined
        ? Math.round(Number(progress._avg.percentComplete) * 10) / 10
        : null,
    attendanceSessions: sessions,
    attendanceMarkedSessions: markedSessions,
    activeLecturers: new Set((lecturers as { userId: string }[]).map((row) => row.userId)).size,
  };
}

export interface FinanceReport {
  billedCents: number;
  collectedCents: number;
  outstandingCents: number;
  collectionRate: number | null;
  learnersInArrears: number;
}

export async function financeReport(principal: Principal): Promise<FinanceReport> {
  requirePermission(principal, 'report.read');
  const institutionId = principal.institutionId ?? undefined;

  const [invoices, payments, arrears] = await Promise.all([
    prisma.invoice.findMany({
      where: { institutionId, status: { notIn: ['DRAFT', 'CANCELLED'] } },
      select: { total: true, balance: true },
    }),
    prisma.payment.aggregate({
      where: { institutionId, status: 'CLEARED' },
      _sum: { amount: true },
    }),
    prisma.invoice.findMany({
      where: { institutionId, status: 'OVERDUE' },
      select: { studentId: true },
    }),
  ]);

  const rows = invoices as { total: unknown; balance: unknown }[];
  const billed = sumCents(rows.map((invoice) => toCents(String(invoice.total))));
  const outstanding = sumCents(
    rows.map((invoice) => Math.max(0, toCents(String(invoice.balance)))),
  );
  const collected = toCents(String(payments._sum.amount ?? 0));

  return {
    billedCents: billed,
    collectedCents: collected,
    outstandingCents: outstanding,
    collectionRate: billed > 0 ? Math.round(((billed - outstanding) / billed) * 1000) / 10 : null,
    learnersInArrears: new Set((arrears as { studentId: string }[]).map((row) => row.studentId)).size,
  };
}
