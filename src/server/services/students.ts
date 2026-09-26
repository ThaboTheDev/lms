import 'server-only';
import { sendInvitation } from './outbound';
import { grantRoleOnce, requireRoleForInstitution } from './role-grants';
import { prisma } from '@/lib/db';
import { NotFoundError, AuthorisationError, AppError } from '@/lib/errors';
import { recordAudit } from '@/lib/audit';
import { hashPassword } from '@/lib/auth/password';
import { randomToken } from '@/lib/crypto';
import { requirePermission, requireSameInstitution, type Principal, can } from '@/lib/rbac/authorize';
import { projectStudent, type StudentView } from './student-view';
import { allocateStudentNumber } from './student-numbers';
import type { CreateStudentInput } from '@/lib/validation/student';

const STUDENT_SELECT = {
  id: true,
  studentNumber: true,
  admissionStatus: true,
  city: true,
  province: true,
  homeLanguage: true,
  nationalIdRef: true,
  passportNumber: true,
  dateOfBirth: true,
  nationality: true,
  addressLine1: true,
  addressLine2: true,
  postalCode: true,
  emergencyName: true,
  emergencyPhone: true,
  emergencyRelation: true,
  supportNeeds: true,
  supportConsentAt: true,
  institutionId: true,
  user: { select: { firstName: true, lastName: true, preferredName: true, email: true, phone: true } },
} as const;

type StudentRow = {
  institutionId: string;
  user: { firstName: string; lastName: string; preferredName: string | null; email: string; phone: string | null };
} & Record<string, unknown>;

function flatten(row: StudentRow) {
  const { user, ...rest } = row;
  return { ...rest, ...user } as never;
}

export interface StudentListFilters {
  query?: string;
  programmeId?: string;
  admissionStatus?: string;
  academicYearId?: string;
}

/** Paged list for the registrar screen. Always tenant scoped, never unbounded. */
export async function listStudents(
  principal: Principal,
  filters: StudentListFilters,
  paging: { skip: number; perPage: number },
) {
  // The register is institution-wide: a grant for one course does not open it.
  requirePermission(principal, 'student.read', { institutionId: principal.institutionId ?? '' });

  const where = {
    institutionId: principal.institutionId ?? undefined,
    ...(filters.admissionStatus ? { admissionStatus: filters.admissionStatus as never } : {}),
    ...(filters.programmeId || filters.academicYearId
      ? {
          programmeEnrolments: {
            some: {
              ...(filters.programmeId ? { programmeId: filters.programmeId } : {}),
              ...(filters.academicYearId ? { academicYearId: filters.academicYearId } : {}),
            },
          },
        }
      : {}),
    ...(filters.query
      ? {
          OR: [
            { studentNumber: { contains: filters.query } },
            { user: { firstName: { contains: filters.query, mode: 'insensitive' as const } } },
            { user: { lastName: { contains: filters.query, mode: 'insensitive' as const } } },
            { user: { email: { contains: filters.query, mode: 'insensitive' as const } } },
          ],
        }
      : {}),
  };

  const [total, rows] = await Promise.all([
    prisma.studentProfile.count({ where }),
    prisma.studentProfile.findMany({
      where,
      skip: paging.skip,
      take: paging.perPage,
      orderBy: { studentNumber: 'asc' },
      select: {
        ...STUDENT_SELECT,
        programmeEnrolments: {
          take: 1,
          orderBy: { enrolledOn: 'desc' },
          select: {
            status: true,
            yearOfStudy: true,
            programme: { select: { id: true, code: true, title: true } },
          },
        },
      },
    }),
  ]);

  const scope = { institutionId: principal.institutionId ?? '' };

  return {
    total,
    students: rows.map((row) => ({
      ...projectStudent(principal, flatten(row as never), scope),
      programme: (row as never as { programmeEnrolments: { programme: { code: string; title: string } }[] })
        .programmeEnrolments[0]?.programme ?? null,
      yearOfStudy: (row as never as { programmeEnrolments: { yearOfStudy: number }[] })
        .programmeEnrolments[0]?.yearOfStudy ?? null,
    })),
  };
}

export interface StudentDetail {
  student: StudentView;
  programmeEnrolments: unknown[];
  courseEnrolments: unknown[];
}

export async function getStudent(principal: Principal, studentId: string): Promise<StudentDetail> {
  const row = await prisma.studentProfile.findUnique({
    where: { id: studentId },
    select: {
      ...STUDENT_SELECT,
      programmeEnrolments: {
        orderBy: { enrolledOn: 'desc' },
        select: {
          id: true,
          status: true,
          yearOfStudy: true,
          enrolledOn: true,
          programme: { select: { id: true, code: true, title: true } },
          academicYear: { select: { year: true, label: true } },
          cohort: { select: { code: true, name: true } },
        },
      },
      courseEnrolments: {
        orderBy: { enrolledAt: 'desc' },
        select: {
          id: true,
          status: true,
          result: true,
          finalMark: true,
          finalGrade: true,
          resultsPublishedAt: true,
          offering: {
            select: {
              id: true,
              sectionCode: true,
              course: { select: { code: true, title: true, credits: true } },
              academicTerm: { select: { name: true, academicYear: { select: { year: true } } } },
            },
          },
        },
      },
    },
  });

  if (!row) throw new NotFoundError('Student');

  const isSelf = principal.studentId === studentId;
  let scope: { institutionId: string; courseOfferingId?: string } = { institutionId: row.institutionId };
  if (!isSelf) {
    requireSameInstitution(principal, row.institutionId);
    if (!can(principal, 'student.read', scope)) {
      // Teaching staff whose role is granted for a course may open the profile
      // of a learner on that course, and nobody else's.
      const shared = await prisma.courseEnrolment.findFirst({
        where: { studentId: row.id, offering: { staff: { some: { userId: principal.userId } } } },
        select: { offeringId: true },
      });
      const courseScope = shared ? { institutionId: row.institutionId, courseOfferingId: shared.offeringId } : null;
      if (!courseScope || !can(principal, 'student.read', courseScope)) throw new AuthorisationError();
      scope = courseScope;
    }
  }

  const student = projectStudent(principal, flatten(row as never), scope);

  // Marks are only visible to the learner once the offering has released them.
  const courseEnrolments = (row.courseEnrolments as never as Record<string, unknown>[]).map((enrolment) =>
    isSelf && !enrolment.resultsPublishedAt
      ? { ...enrolment, finalMark: null, finalGrade: null, result: 'PENDING' }
      : enrolment,
  );

  return { student, programmeEnrolments: row.programmeEnrolments as never, courseEnrolments };
}

/**
 * Creates the learner: a user account, the student profile with an allocated
 * student number, and the programme enrolment, in one transaction. The account
 * is created in INVITED state with a random password; the learner sets their own
 * through the invitation email.
 */
export async function createStudent(principal: Principal, input: CreateStudentInput) {
  requirePermission(principal, 'student.manage');
  const institutionId = principal.institutionId;
  if (!institutionId) throw new NotFoundError('Institution');

  const taken = await prisma.user.findUnique({ where: { email: input.email.trim().toLowerCase() }, select: { id: true } });
  if (taken) {
    throw new AppError('Somebody already uses that email address.', 409, 'duplicate_email', { email: 'Somebody already uses that email address.' });
  }

  const studentNumber = await allocateStudentNumber(institutionId);
  const placeholderPassword = await hashPassword(randomToken(24));

  const student = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        institutionId,
        email: input.email,
        firstName: input.firstName,
        lastName: input.lastName,
        preferredName: input.preferredName || null,
        phone: input.phone || null,
        passwordHash: placeholderPassword,
        status: 'INVITED',
      },
    });

    const studentRole = await requireRoleForInstitution(tx, institutionId, 'STUDENT');
    await grantRoleOnce(tx, { userId: user.id, roleId: studentRole.id, institutionId, grantedById: principal.userId });

    const profile = await tx.studentProfile.create({
      data: {
        institutionId,
        userId: user.id,
        studentNumber,
        admissionStatus: 'REGISTERED',
        nationalIdRef: input.nationalIdRef || null,
        passportNumber: input.passportNumber || null,
        dateOfBirth: input.dateOfBirth ?? null,
        nationality: input.nationality || null,
        homeLanguage: input.homeLanguage || null,
        addressLine1: input.addressLine1 || null,
        addressLine2: input.addressLine2 || null,
        city: input.city || null,
        province: input.province || null,
        postalCode: input.postalCode || null,
        country: input.country || 'ZA',
        emergencyName: input.emergencyName || null,
        emergencyPhone: input.emergencyPhone || null,
        emergencyRelation: input.emergencyRelation || null,
      },
    });

    await tx.programmeEnrolment.create({
      data: {
        institutionId,
        studentId: profile.id,
        programmeId: input.programmeId,
        academicYearId: input.academicYearId,
        cohortId: input.cohortId || null,
        status: 'ACTIVE',
      },
    });

    return profile;
  });

  await recordAudit(principal, {
    action: 'student.created',
    entityType: 'StudentProfile',
    entityId: student.id,
    after: { studentNumber, programmeId: input.programmeId },
  });

  await sendInvitation(student.userId, principal.displayName);
  return student;
}

export async function updateStudentContact(
  principal: Principal,
  studentId: string,
  data: Record<string, string | null>,
) {
  const existing = await prisma.studentProfile.findUnique({
    where: { id: studentId },
    select: { id: true, institutionId: true, userId: true },
  });
  if (!existing) throw new NotFoundError('Student');

  const isSelf = principal.studentId === studentId;
  if (!isSelf) {
    requireSameInstitution(principal, existing.institutionId);
    requirePermission(principal, 'student.manage', { institutionId: existing.institutionId });
  }

  const updated = await prisma.studentProfile.update({
    where: { id: studentId },
    data: {
      addressLine1: data.addressLine1 || null,
      addressLine2: data.addressLine2 || null,
      city: data.city || null,
      province: data.province || null,
      postalCode: data.postalCode || null,
      homeLanguage: data.homeLanguage || null,
      emergencyName: data.emergencyName || null,
      emergencyPhone: data.emergencyPhone || null,
      emergencyRelation: data.emergencyRelation || null,
    },
  });

  await recordAudit(principal, {
    action: 'student.contact_updated',
    entityType: 'StudentProfile',
    entityId: studentId,
    after: { city: updated.city, province: updated.province },
  });

  return updated;
}
