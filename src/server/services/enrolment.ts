import 'server-only';
import { prisma } from '@/lib/db';
import { AppError, NotFoundError } from '@/lib/errors';
import { recordAudit } from '@/lib/audit';
import { requirePermission, requireSameInstitution, type Principal } from '@/lib/rbac/authorize';
import { checkPrerequisites, type PrerequisiteEdge } from './curriculum-rules';

export interface RegistrationLine {
  offeringId: string;
  courseCode: string;
  courseTitle: string;
  credits: number;
  eligible: boolean;
  alreadyEnrolled: boolean;
  full: boolean;
  blockedBy: { courseId: string; reason: string }[];
}

/**
 * Works out what a learner may register for in a term: the courses their
 * curriculum places in that term, minus anything already taken, with
 * prerequisite and capacity checks applied. The registration screen renders
 * this directly, and bulk registration runs the same function per learner so
 * the two can never disagree.
 */
export async function buildRegistrationPlan(
  principal: Principal,
  studentId: string,
  academicTermId: string,
): Promise<{ lines: RegistrationLine[]; programmeCode: string }> {
  const enrolment = await prisma.programmeEnrolment.findFirst({
    where: { studentId, status: 'ACTIVE' },
    orderBy: { enrolledOn: 'desc' },
    select: {
      institutionId: true,
      yearOfStudy: true,
      programme: { select: { id: true, code: true } },
    },
  });
  if (!enrolment) throw new NotFoundError('Active programme enrolment');
  requireSameInstitution(principal, enrolment.institutionId);
  requirePermission(principal, 'enrolment.read', { institutionId: enrolment.institutionId });

  const term = await prisma.academicTerm.findUnique({
    where: { id: academicTermId },
    select: { id: true, code: true },
  });
  if (!term) throw new NotFoundError('Academic term');

  // Term codes are S1, S2, T1 and so on; the trailing digit is the term number.
  const termNumber = Number(term.code.replace(/\D/g, '')) || 1;

  const [curriculum, offerings, history, prerequisites] = await Promise.all([
    prisma.curriculumItem.findMany({
      where: {
        programmeId: enrolment.programme.id,
        yearOfStudy: enrolment.yearOfStudy,
        termNumber,
      },
      select: { courseId: true, credits: true, course: { select: { code: true, title: true, credits: true } } },
    }),
    prisma.courseOffering.findMany({
      where: { academicTermId, status: { in: ['OPEN', 'ACTIVE'] } },
      select: { id: true, courseId: true, capacity: true, _count: { select: { enrolments: true } } },
    }),
    prisma.courseEnrolment.findMany({
      where: { studentId },
      select: { offering: { select: { courseId: true, academicTermId: true } }, result: true },
    }),
    prisma.coursePrerequisite.findMany({
      where: { course: { institutionId: enrolment.institutionId } },
      select: { courseId: true, requiredCourseId: true, kind: true },
    }),
  ]);

  const edges: PrerequisiteEdge[] = prerequisites.map((edge) => ({
    ...edge,
    kind: edge.kind as PrerequisiteEdge['kind'],
  }));

  const completed = history.map((row) => ({
    courseId: row.offering.courseId,
    passed: ['PASS', 'PASS_WITH_DISTINCTION', 'COMPETENT'].includes(row.result),
  }));

  const enrolledThisTerm = history
    .filter((row) => row.offering.academicTermId === academicTermId)
    .map((row) => row.offering.courseId);

  const plannedCourseIds = curriculum.map((item) => item.courseId);

  const lines: RegistrationLine[] = curriculum.map((item) => {
    const offering = offerings.find((o) => o.courseId === item.courseId);
    const eligibility = checkPrerequisites(item.courseId, edges, completed, plannedCourseIds);
    const full = Boolean(offering?.capacity && offering._count.enrolments >= offering.capacity);

    return {
      offeringId: offering?.id ?? '',
      courseCode: item.course.code,
      courseTitle: item.course.title,
      credits: item.credits ?? item.course.credits,
      eligible: Boolean(offering) && eligibility.eligible && !full,
      alreadyEnrolled: enrolledThisTerm.includes(item.courseId),
      full,
      blockedBy: eligibility.blockedBy,
    };
  });

  return { lines, programmeCode: enrolment.programme.code };
}

/** Registers a learner for the chosen offerings, re-checking eligibility. */
export async function registerForCourses(
  principal: Principal,
  studentId: string,
  academicTermId: string,
  offeringIds: string[],
) {
  requirePermission(principal, 'enrolment.manage');
  const plan = await buildRegistrationPlan(principal, studentId, academicTermId);

  const allowed = new Set(
    plan.lines.filter((line) => line.eligible && !line.alreadyEnrolled).map((line) => line.offeringId),
  );
  const rejected = offeringIds.filter((id) => !allowed.has(id));
  if (rejected.length > 0) {
    throw new AppError(
      'One or more of the selected courses is not open to this learner. Refresh the registration and try again.',
      409,
      'not_eligible',
      { rejected },
    );
  }

  const student = await prisma.studentProfile.findUnique({
    where: { id: studentId },
    select: { institutionId: true, studentNumber: true },
  });
  if (!student) throw new NotFoundError('Student');

  const created = await prisma.$transaction(
    offeringIds.map((offeringId) =>
      prisma.courseEnrolment.create({
        data: {
          institutionId: student.institutionId,
          studentId,
          offeringId,
          status: 'ACTIVE',
        },
      }),
    ),
  );

  await recordAudit(principal, {
    action: 'enrolment.registered',
    entityType: 'StudentProfile',
    entityId: studentId,
    institutionId: student.institutionId,
    after: { studentNumber: student.studentNumber, offerings: offeringIds, term: academicTermId },
  });

  return created;
}

/**
 * Registers a whole programme (or one cohort in it) for a term, learner by
 * learner through the same plan the single-learner screen uses, so the
 * prerequisite, capacity and duplicate checks are exactly the same. Learners
 * who cannot be registered are reported, not silently skipped.
 */
export async function registerCohort(
  principal: Principal,
  input: { programmeId: string; academicTermId: string; cohortId?: string },
) {
  requirePermission(principal, 'enrolment.manage');
  const enrolments = await prisma.programmeEnrolment.findMany({
    where: {
      programmeId: input.programmeId,
      status: 'ACTIVE',
      institutionId: principal.institutionId ?? undefined,
      ...(input.cohortId ? { cohortId: input.cohortId } : {}),
    },
    select: { studentId: true, student: { select: { studentNumber: true } } },
  });

  let registered = 0;
  let courses = 0;
  const skipped: { studentNumber: string; reason: string }[] = [];
  for (const enrolment of enrolments) {
    try {
      const plan = await buildRegistrationPlan(principal, enrolment.studentId, input.academicTermId);
      const offeringIds = plan.lines.filter((line) => line.eligible && !line.alreadyEnrolled && line.offeringId).map((line) => line.offeringId as string);
      if (offeringIds.length === 0) {
        const blocked = plan.lines.find((line) => !line.eligible && !line.alreadyEnrolled);
        skipped.push({ studentNumber: enrolment.student.studentNumber, reason: blocked ? `${blocked.courseCode}: ${blocked.full ? 'full' : blocked.blockedBy?.join(', ') || 'not offered this term'}` : 'already registered for everything open to them' });
        continue;
      }
      await registerForCourses(principal, enrolment.studentId, input.academicTermId, offeringIds);
      registered += 1;
      courses += offeringIds.length;
    } catch (error) {
      skipped.push({ studentNumber: enrolment.student.studentNumber, reason: error instanceof Error ? error.message : 'could not be registered' });
    }
  }
  return { learners: enrolments.length, registered, courses, skipped };
}

