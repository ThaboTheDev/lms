import 'server-only';
import { prisma } from '@/lib/db';
import { NotFoundError } from '@/lib/errors';
import { recordAudit } from '@/lib/audit';
import { requirePermission, requireSameInstitution, type Principal } from '@/lib/rbac/authorize';
import { buildTranscript, type Transcript } from './transcript-builder';
import type { CourseRecord } from './progression-rules';

/**
 * Loads every resolved and in-flight course record for one learner. This is the
 * single source the transcript, the progression engine and the graduation check
 * all read, so the three cannot disagree.
 */
export async function loadCourseRecords(studentId: string): Promise<CourseRecord[]> {
  const enrolments = await prisma.courseEnrolment.findMany({
    where: { studentId },
    orderBy: { enrolledAt: 'asc' },
    select: {
      result: true,
      finalMark: true,
      finalGrade: true,
      creditsAwarded: true,
      offering: {
        select: {
          course: { select: { id: true, code: true, title: true, credits: true } },
          academicTerm: {
            select: { name: true, academicYear: { select: { year: true } } },
          },
        },
      },
    },
  });

  // Attempts are counted per course so the progression rules can see a learner
  // who has sat the same module three times.
  const attempts = new Map<string, number>();

  return enrolments.map((enrolment) => {
    const courseId = enrolment.offering.course.id;
    const attempt = (attempts.get(courseId) ?? 0) + 1;
    attempts.set(courseId, attempt);

    return {
      courseId,
      code: enrolment.offering.course.code,
      title: enrolment.offering.course.title,
      credits: enrolment.offering.course.credits,
      creditsAwarded: enrolment.creditsAwarded,
      result: enrolment.result as CourseRecord['result'],
      finalMark: enrolment.finalMark !== null ? Number(enrolment.finalMark) : null,
      finalGrade: enrolment.finalGrade,
      yearOfStudy: 1,
      termLabel: enrolment.offering.academicTerm.name,
      academicYear: enrolment.offering.academicTerm.academicYear.year,
      attempt,
    };
  });
}

/**
 * Academic records are protected from ordinary users: a learner may read their
 * own, and everyone else needs academic_record.read in the institution.
 */
async function assertCanReadRecord(principal: Principal, studentId: string) {
  const student = await prisma.studentProfile.findUnique({
    where: { id: studentId },
    select: {
      id: true,
      institutionId: true,
      studentNumber: true,
      user: { select: { firstName: true, lastName: true } },
      institution: { select: { name: true } },
    },
  });
  if (!student) throw new NotFoundError('Student');

  if (principal.studentId !== studentId) {
    requireSameInstitution(principal, student.institutionId);
    requirePermission(principal, 'academic_record.read', { institutionId: student.institutionId });
  }

  return student;
}

export async function loadTranscript(principal: Principal, studentId: string): Promise<Transcript> {
  const student = await assertCanReadRecord(principal, studentId);

  const [records, enrolment, scheme] = await Promise.all([
    loadCourseRecords(studentId),
    prisma.programmeEnrolment.findFirst({
      where: { studentId },
      orderBy: { enrolledOn: 'desc' },
      select: {
        yearOfStudy: true,
        programme: {
          select: {
            code: true,
            title: true,
            qualification: { select: { title: true, nqfLevel: true } },
          },
        },
      },
    }),
    prisma.gradingScheme.findFirst({
      where: { institutionId: student.institutionId, isDefault: true },
      select: { bands: { select: { label: true, gradePoint: true } } },
    }),
  ]);

  return buildTranscript(
    {
      institutionName: student.institution.name,
      studentNumber: student.studentNumber,
      fullName: `${student.user.firstName} ${student.user.lastName}`,
      programmeTitle: enrolment?.programme.title ?? 'Not enrolled',
      programmeCode: enrolment?.programme.code ?? '',
      qualificationTitle: enrolment?.programme.qualification.title ?? '',
      nqfLevel: enrolment?.programme.qualification.nqfLevel ?? null,
      generatedAt: new Date(),
    },
    records,
    (scheme?.bands ?? [])
      .filter((band) => band.gradePoint !== null)
      .map((band) => ({ grade: band.label, point: Number(band.gradePoint) })),
  );
}

/**
 * Stores an immutable copy of the transcript. A transcript issued to an
 * employer must still read the same years later, even after a mark is corrected
 * or a grading scheme is changed, so the document is snapshotted rather than
 * recomputed on demand.
 */
export async function issueTranscript(principal: Principal, studentId: string) {
  const student = await prisma.studentProfile.findUnique({
    where: { id: studentId },
    select: { id: true, institutionId: true, studentNumber: true },
  });
  if (!student) throw new NotFoundError('Student');
  requireSameInstitution(principal, student.institutionId);
  requirePermission(principal, 'academic_record.read', { institutionId: student.institutionId });

  const transcript = await loadTranscript(principal, studentId);

  const academicYear = await prisma.academicYear.findFirst({
    where: { institutionId: student.institutionId, isCurrent: true },
    select: { id: true },
  });

  const snapshot = await prisma.transcriptSnapshot.create({
    data: {
      institutionId: student.institutionId,
      studentId,
      academicYearId: academicYear?.id ?? null,
      generatedById: principal.userId,
      payload: JSON.parse(JSON.stringify(transcript)) as never,
    },
    select: { id: true, generatedAt: true },
  });

  await recordAudit(principal, {
    action: 'transcript.issued',
    entityType: 'StudentProfile',
    entityId: studentId,
    institutionId: student.institutionId,
    after: {
      snapshotId: snapshot.id,
      studentNumber: student.studentNumber,
      creditsEarned: transcript.summary.earned,
      provisional: transcript.provisional,
    },
  });

  // TODO(phase-9): render the snapshot to PDF in the background and attach it.
  return snapshot;
}

export async function listTranscriptSnapshots(principal: Principal, studentId: string) {
  await assertCanReadRecord(principal, studentId);

  return prisma.transcriptSnapshot.findMany({
    where: { studentId },
    orderBy: { generatedAt: 'desc' },
    select: { id: true, generatedAt: true, fileId: true, academicYear: { select: { label: true } } },
  });
}

export async function loadSnapshot(principal: Principal, snapshotId: string) {
  const snapshot = await prisma.transcriptSnapshot.findUnique({
    where: { id: snapshotId },
    select: { id: true, studentId: true, institutionId: true, generatedAt: true, payload: true },
  });
  if (!snapshot) throw new NotFoundError('Transcript');
  await assertCanReadRecord(principal, snapshot.studentId);
  return snapshot;
}
