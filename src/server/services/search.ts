import 'server-only';
import type { Route } from 'next';
import { prisma } from '@/lib/db';
import { can, type Principal } from '@/lib/rbac/authorize';

export interface SearchHit {
  label: string;
  detail: string;
  href: Route;
}

export interface SearchGroup {
  title: string;
  hits: SearchHit[];
}

const LIMIT = 8;

/**
 * One box for the things people look up all day. Each kind of record is
 * searched only if the person may read it, with the same institution scoping
 * as everywhere else, so the results never show more than the screens would.
 */
export async function searchEverything(principal: Principal, raw: string): Promise<SearchGroup[]> {
  const q = raw.trim().slice(0, 80);
  const institutionId = principal.institutionId;
  if (q.length < 2 || !institutionId) return [];

  const text = { contains: q, mode: 'insensitive' as const };
  const scope = { institutionId };
  const groups: Promise<SearchGroup | null>[] = [];

  if (can(principal, 'student.read', scope)) {
    groups.push(
      prisma.studentProfile
        .findMany({
          where: {
            institutionId,
            OR: [
              { studentNumber: text },
              { user: { firstName: text } },
              { user: { lastName: text } },
              { user: { email: text } },
            ],
          },
          take: LIMIT,
          orderBy: { studentNumber: 'asc' },
          select: { id: true, studentNumber: true, user: { select: { firstName: true, lastName: true, email: true } } },
        })
        .then((rows) => ({
          title: 'Students',
          hits: rows.map((row) => ({
            label: `${row.user.firstName} ${row.user.lastName}`,
            detail: `${row.studentNumber} · ${row.user.email}`,
            href: `/students/${row.id}` as Route,
          })),
        })),
    );
  }

  if (can(principal, 'user.read', scope)) {
    groups.push(
      prisma.user
        .findMany({
          where: { institutionId, deletedAt: null, studentProfile: null, OR: [{ firstName: text }, { lastName: text }, { email: text }] },
          take: LIMIT,
          orderBy: { lastName: 'asc' },
          select: { id: true, firstName: true, lastName: true, email: true, status: true },
        })
        .then((rows) => ({
          title: 'Staff',
          hits: rows.map((row) => ({
            label: `${row.firstName} ${row.lastName}`,
            detail: `${row.email}${row.status === 'ACTIVE' ? '' : ` · ${row.status.toLowerCase()}`}`,
            href: `/admin/users/${row.id}` as Route,
          })),
        })),
    );
  }

  if (can(principal, 'course.read', scope)) {
    const everything = can(principal, 'course.manage', scope);
    groups.push(
      prisma.courseOffering
        .findMany({
          where: {
            institutionId,
            AND: [
              { OR: [{ course: { code: text } }, { course: { title: text } }] },
              // Without course.manage, only courses the person teaches or takes.
              ...(everything
                ? []
                : [
                    {
                      OR: [
                        { staff: { some: { userId: principal.userId } } },
                        ...(principal.studentId ? [{ enrolments: { some: { studentId: principal.studentId } } }] : []),
                      ],
                    },
                  ]),
            ],
          },
          take: LIMIT,
          orderBy: [{ course: { code: 'asc' } }],
          select: {
            id: true,
            sectionCode: true,
            course: { select: { code: true, title: true } },
            academicTerm: { select: { name: true, academicYear: { select: { year: true } } } },
          },
        })
        .then((rows) => ({
          title: 'Courses',
          hits: rows.map((row) => ({
            label: `${row.course.code} · ${row.course.title}`,
            detail: `${row.academicTerm.name} ${row.academicTerm.academicYear.year}${row.sectionCode !== 'A' ? ` · section ${row.sectionCode}` : ''}`,
            href: `/courses/${row.id}` as Route,
          })),
        })),
    );
  }

  if (can(principal, 'programme.read', scope)) {
    groups.push(
      prisma.programme
        .findMany({
          where: { institutionId, OR: [{ code: text }, { title: text }] },
          take: LIMIT,
          orderBy: { code: 'asc' },
          select: { id: true, code: true, title: true, isActive: true },
        })
        .then((rows) => ({
          title: 'Programmes',
          hits: rows.map((row) => ({
            label: `${row.code} · ${row.title}`,
            detail: row.isActive ? 'Active' : 'Inactive',
            href: `/programmes/${row.id}` as Route,
          })),
        })),
    );
  }

  if (can(principal, 'application.read', scope)) {
    groups.push(
      prisma.application
        .findMany({
          where: { institutionId, OR: [{ referenceNumber: text }, { firstName: text }, { lastName: text }, { email: text }] },
          take: LIMIT,
          orderBy: { createdAt: 'desc' },
          select: { id: true, referenceNumber: true, firstName: true, lastName: true, status: true },
        })
        .then((rows) => ({
          title: 'Applications',
          hits: rows.map((row) => ({
            label: `${row.firstName} ${row.lastName}`,
            detail: `${row.referenceNumber} · ${row.status.toLowerCase().replace(/_/g, ' ')}`,
            href: `/admissions/${row.id}` as Route,
          })),
        })),
    );
  }

  if (can(principal, 'finance.read', scope)) {
    groups.push(
      prisma.invoice
        .findMany({
          where: {
            institutionId,
            OR: [{ number: text }, { student: { studentNumber: text } }, { student: { user: { lastName: text } } }],
          },
          take: LIMIT,
          orderBy: { number: 'desc' },
          select: { id: true, number: true, status: true, student: { select: { studentNumber: true, user: { select: { firstName: true, lastName: true } } } } },
        })
        .then((rows) => ({
          title: 'Invoices',
          hits: rows.map((row) => ({
            label: row.number,
            detail: `${row.student.user.firstName} ${row.student.user.lastName} · ${row.student.studentNumber} · ${row.status.toLowerCase().replace(/_/g, ' ')}`,
            href: `/finance/invoices/${row.id}` as Route,
          })),
        })),
    );
  }

  if (can(principal, 'certificate.read', scope)) {
    groups.push(
      prisma.certificate
        .findMany({
          where: { institutionId, OR: [{ number: text }, { verificationCode: text }, { title: text }] },
          take: LIMIT,
          orderBy: { issuedOn: 'desc' },
          select: { id: true, number: true, title: true, status: true },
        })
        .then((rows) => ({
          title: 'Certificates',
          hits: rows.map((row) => ({
            label: row.number,
            detail: `${row.title} · ${row.status.toLowerCase()}`,
            href: `/certificates/${row.id}` as Route,
          })),
        })),
    );
  }

  if (can(principal, 'ticket.read', scope)) {
    groups.push(
      prisma.supportTicket
        .findMany({
          where: { institutionId, OR: [{ number: text }, { subject: text }] },
          take: LIMIT,
          orderBy: { createdAt: 'desc' },
          select: { id: true, number: true, subject: true, status: true },
        })
        .then((rows) => ({
          title: 'Support tickets',
          hits: rows.map((row) => ({
            label: `${row.number} · ${row.subject}`,
            detail: row.status.toLowerCase().replace(/_/g, ' '),
            href: `/support/${row.id}` as Route,
          })),
        })),
    );
  }

  const settled = await Promise.all(groups);
  return settled.filter((group): group is SearchGroup => Boolean(group && group.hits.length > 0));
}
