import { NextResponse, type NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { requirePrincipal } from '@/lib/auth/current-user';
import { toErrorResponse } from '@/lib/http';
import { NotFoundError } from '@/lib/errors';
import { requirePermission } from '@/lib/rbac/authorize';
import { csvFilename, toCsv, type CsvCell } from '@/lib/csv';
import { formatMoney, toCents } from '@/lib/money';
import {
  academicReport,
  admissionsPipeline,
  deliveryReport,
  financeReport,
  headcountByCohort,
  headcountByProgramme,
} from '@/server/services/reporting';

export const dynamic = 'force-dynamic';

const words = (value: string) => value.toLowerCase().replace(/_/g, ' ');

/**
 * Report downloads as CSV. Each report checks the same permission as the
 * screen it comes from; the services enforce it again.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ report: string }> }) {
  try {
    const principal = await requirePrincipal();
    const { report } = await params;
    const year = request.nextUrl.searchParams.get('year') || undefined;
    const institutionId = principal.institutionId ?? '';
    let headers: string[] = [];
    let rows: CsvCell[][] = [];

    switch (report) {
      case 'headcount': {
        const academicYearId = year ?? (await prisma.academicYear.findFirst({ where: { institutionId, isCurrent: true }, select: { id: true } }))?.id;
        if (!academicYearId) throw new NotFoundError('Academic year');
        const data = await headcountByProgramme(principal, academicYearId);
        headers = ['Programme code', 'Programme', 'Qualification type', 'Active', 'Completed', 'Withdrawn'];
        rows = data.map((row) => [row.programmeCode, row.programmeTitle, words(row.qualificationType), row.active, row.completed, row.withdrawn]);
        break;
      }
      case 'cohorts': {
        const academicYearId = year ?? (await prisma.academicYear.findFirst({ where: { institutionId, isCurrent: true }, select: { id: true } }))?.id;
        if (!academicYearId) throw new NotFoundError('Academic year');
        const data = (await headcountByCohort(principal, academicYearId)) as unknown as Record<string, CsvCell>[];
        headers = data.length ? Object.keys(data[0]!) : ['cohort', 'count'];
        rows = data.map((row) => headers.map((key) => row[key]));
        break;
      }
      case 'admissions': {
        const data = await admissionsPipeline(principal, year);
        headers = ['Status', 'Applications'];
        rows = data.map((row) => [words(row.status), row.count]);
        break;
      }
      case 'distribution': {
        const data = await academicReport(principal, year);
        headers = ['Mark band', 'Course results'];
        rows = data.distribution.map((row) => [row.band, row.count]);
        break;
      }
      case 'summary': {
        requirePermission(principal, 'report.read');
        const [academic, delivery, finance] = await Promise.all([
          academicReport(principal, year),
          deliveryReport(principal),
          financeReport(principal).catch(() => null),
        ]);
        headers = ['Measure', 'Value'];
        rows = [
          ['Assessments published', academic.assessmentsPublished],
          ['Submissions marked', academic.submissionsMarked],
          ['Pass rate (%)', academic.passRate],
          ['Courses with results', academic.coursesWithResults],
          ['Course deliveries running', delivery.offeringsRunning],
          ['Lessons published', delivery.lessonsPublished],
          ['Average course progress (%)', delivery.averageCourseProgress],
          ['Attendance sessions marked', delivery.attendanceMarkedSessions],
          ['Attendance sessions scheduled', delivery.attendanceSessions],
          ['Active lecturers', delivery.activeLecturers],
          ...(finance
            ? ([
                ['Billed', formatMoney(finance.billedCents)],
                ['Collected', formatMoney(finance.collectedCents)],
                ['Outstanding', formatMoney(finance.outstandingCents)],
                ['Collection rate (%)', finance.collectionRate],
                ['Learners in arrears', finance.learnersInArrears],
              ] as CsvCell[][])
            : []),
        ];
        break;
      }
      case 'debtors': {
        requirePermission(principal, 'finance.read', { institutionId });
        const invoices = await prisma.invoice.findMany({
          where: { institutionId, status: { in: ['ISSUED', 'PARTIALLY_PAID', 'OVERDUE'] }, balance: { gt: 0 } },
          orderBy: [{ dueOn: 'asc' }, { number: 'asc' }],
          select: {
            number: true, dueOn: true, total: true, balance: true, status: true,
            student: { select: { studentNumber: true, user: { select: { firstName: true, lastName: true, email: true } } } },
          },
        });
        const today = Date.now();
        headers = ['Student number', 'Name', 'Email', 'Invoice', 'Due', 'Days overdue', 'Total', 'Balance', 'Status'];
        rows = invoices.map((invoice) => [
          invoice.student.studentNumber,
          `${invoice.student.user.lastName}, ${invoice.student.user.firstName}`,
          invoice.student.user.email,
          invoice.number,
          invoice.dueOn,
          invoice.dueOn ? Math.max(0, Math.floor((today - invoice.dueOn.getTime()) / 86_400_000)) : '',
          formatMoney(toCents(String(invoice.total))),
          formatMoney(toCents(String(invoice.balance))),
          words(invoice.status),
        ]);
        break;
      }
      case 'students': {
        requirePermission(principal, 'student.read', { institutionId });
        const students = await prisma.studentProfile.findMany({
          where: { institutionId },
          orderBy: { studentNumber: 'asc' },
          select: {
            studentNumber: true, admissionStatus: true,
            user: { select: { firstName: true, lastName: true, email: true, status: true } },
            programmeEnrolments: {
              orderBy: { enrolledOn: 'desc' },
              take: 1,
              select: { status: true, yearOfStudy: true, programme: { select: { code: true } }, academicYear: { select: { label: true } }, cohort: { select: { code: true } } },
            },
          },
        });
        headers = ['Student number', 'Surname', 'First name', 'Email', 'Account', 'Programme', 'Year of study', 'Academic year', 'Cohort', 'Enrolment'];
        rows = students.map((student) => {
          const enrolment = student.programmeEnrolments[0];
          return [
            student.studentNumber, student.user.lastName, student.user.firstName, student.user.email, words(student.user.status),
            enrolment?.programme.code ?? '', enrolment?.yearOfStudy ?? '', enrolment?.academicYear.label ?? '', enrolment?.cohort?.code ?? '', enrolment ? words(enrolment.status) : '',
          ];
        });
        break;
      }
      default:
        throw new NotFoundError('Report');
    }

    return new NextResponse(toCsv(headers, rows), {
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="${csvFilename(report)}"`,
      },
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
