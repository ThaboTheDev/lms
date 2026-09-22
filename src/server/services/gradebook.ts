import 'server-only';
import { prisma } from '@/lib/db';
import { NotFoundError } from '@/lib/errors';
import { recordAudit } from '@/lib/audit';
import { requirePermission, type Principal } from '@/lib/rbac/authorize';
import { assertCanViewOffering } from './course-builder';
import {
  applyGradeBands,
  calculateCourseMark,
  checkWeighting,
  toCompetency,
  type AssessmentResult,
} from './grading-rules';

/**
 * The gradebook for one delivery: every enrolled learner against every weighted
 * assessment, with the weighted course mark computed the same way the final
 * result will be.
 */
export async function loadGradebook(principal: Principal, offeringId: string) {
  const { offering } = await assertCanViewOffering(principal, offeringId);
  requirePermission(principal, 'submission.read', {
    institutionId: offering.institutionId,
    courseOfferingId: offeringId,
  });

  const [assessments, enrolments] = await Promise.all([
    prisma.assessment.findMany({
      where: { offeringId, status: { in: ['PUBLISHED', 'CLOSED'] } },
      orderBy: { dueAt: 'asc' },
      select: { id: true, title: true, maxMark: true, weight: true, releaseResultsAt: true },
    }),
    prisma.courseEnrolment.findMany({
      where: { offeringId, status: { in: ['ACTIVE', 'COMPLETED'] } },
      select: {
        id: true,
        result: true,
        finalMark: true,
        student: {
          select: { id: true, studentNumber: true, user: { select: { firstName: true, lastName: true } } },
        },
      },
    }),
  ]);

  const submissions = await prisma.submission.findMany({
    where: { assessmentId: { in: assessments.map((a) => a.id) }, status: { in: ['GRADED', 'RETURNED'] } },
    orderBy: { attemptNumber: 'desc' },
    select: { assessmentId: true, studentId: true, finalMark: true, attemptNumber: true },
  });

  // Highest attempt wins where several exist; the list above is ordered so the
  // first row seen for a pair is the latest attempt.
  const best = new Map<string, number>();
  for (const submission of submissions) {
    const key = `${submission.studentId}:${submission.assessmentId}`;
    if (!best.has(key) && submission.finalMark !== null) {
      best.set(key, Number(submission.finalMark));
    }
  }

  const rows = enrolments.map((enrolment) => {
    const results: AssessmentResult[] = assessments.map((assessment) => ({
      assessmentId: assessment.id,
      title: assessment.title,
      weight: Number(assessment.weight),
      maxMark: Number(assessment.maxMark),
      mark: best.get(`${enrolment.student.id}:${assessment.id}`) ?? null,
      released: Boolean(assessment.releaseResultsAt),
    }));

    return {
      enrolmentId: enrolment.id,
      student: enrolment.student,
      results,
      courseMark: calculateCourseMark(results),
      recordedResult: enrolment.result,
      recordedMark: enrolment.finalMark ? Number(enrolment.finalMark) : null,
    };
  });

  return {
    offering,
    assessments,
    rows,
    problems: checkWeighting(assessments.map((a) => ({ title: a.title, weight: Number(a.weight) }))),
  };
}

/**
 * Writes the course result onto the enrolment. This is the number that flows
 * into the transcript and progression in Phase 5, so it is recorded explicitly
 * rather than recomputed on every read: an assessment corrected next year must
 * not silently change a result a learner has already graduated on.
 */
export async function finaliseCourseResults(principal: Principal, offeringId: string) {
  const { offering } = await assertCanViewOffering(principal, offeringId);
  requirePermission(principal, 'grade.publish', {
    institutionId: offering.institutionId,
    courseOfferingId: offeringId,
  });

  const { rows, problems } = await loadGradebook(principal, offeringId);

  const scheme = await prisma.gradingScheme.findFirst({
    where: { institutionId: offering.institutionId, isDefault: true },
    select: {
      type: true,
      bands: { select: { label: true, minPercent: true, maxPercent: true, gradePoint: true, isPass: true } },
    },
  });

  const bands = (scheme?.bands ?? []).map((band) => ({
    label: band.label,
    minPercent: Number(band.minPercent),
    maxPercent: Number(band.maxPercent),
    gradePoint: band.gradePoint ? Number(band.gradePoint) : null,
    isPass: band.isPass,
  }));

  const course = await prisma.courseOffering.findUnique({
    where: { id: offeringId },
    select: { course: { select: { credits: true, code: true } } },
  });
  if (!course) throw new NotFoundError('Course delivery');

  let finalised = 0;
  const skipped: string[] = [];

  for (const row of rows) {
    // A learner with work outstanding is left alone rather than being failed on
    // the strength of marks that were never entered.
    if (row.courseMark.percent === null || row.courseMark.provisional) {
      skipped.push(row.student.studentNumber);
      continue;
    }

    const graded = bands.length ? applyGradeBands(row.courseMark.percent, bands) : null;
    const competency = scheme?.type === 'COMPETENCY';

    const result = competency
      ? toCompetency(row.courseMark.percent, 50)
      : graded?.isPass
        ? row.courseMark.percent >= 75
          ? 'PASS_WITH_DISTINCTION'
          : 'PASS'
        : 'FAIL';

    await prisma.courseEnrolment.update({
      where: { id: row.enrolmentId },
      data: {
        finalMark: row.courseMark.percent,
        finalGrade: graded?.label ?? null,
        result: result as never,
        creditsAwarded: result === 'FAIL' || result === 'NOT_YET_COMPETENT' ? 0 : course.course.credits,
        resultsPublishedAt: new Date(),
        status: 'COMPLETED',
      },
    });
    finalised += 1;
  }

  await recordAudit(principal, {
    action: 'course.results_finalised',
    entityType: 'CourseOffering',
    entityId: offeringId,
    institutionId: offering.institutionId,
    after: { course: course.course.code, finalised, skipped: skipped.length, problems },
  });

  return { finalised, skipped, problems };
}

/** A learner's own results across every course they are taking. */
export async function myResults(principal: Principal) {
  if (!principal.studentId) return [];

  const enrolments = await prisma.courseEnrolment.findMany({
    where: { studentId: principal.studentId },
    orderBy: { enrolledAt: 'desc' },
    select: {
      id: true, result: true, finalMark: true, finalGrade: true, resultsPublishedAt: true,
      offering: {
        select: {
          id: true,
          course: { select: { code: true, title: true, credits: true } },
          academicTerm: { select: { name: true, academicYear: { select: { year: true } } } },
          assessments: {
            where: { status: { in: ['PUBLISHED', 'CLOSED'] } },
            select: {
              id: true, title: true, maxMark: true, weight: true, releaseResultsAt: true,
              submissions: {
                where: { studentId: principal.studentId },
                orderBy: { attemptNumber: 'desc' },
                take: 1,
                select: { finalMark: true, grade: true, returnedAt: true, status: true },
              },
            },
          },
        },
      },
    },
  });

  return enrolments.map((enrolment) => {
    const results: AssessmentResult[] = enrolment.offering.assessments.map((assessment) => {
      const submission = assessment.submissions[0];
      const released = Boolean(submission?.returnedAt);
      return {
        assessmentId: assessment.id,
        title: assessment.title,
        weight: Number(assessment.weight),
        maxMark: Number(assessment.maxMark),
        mark: released && submission?.finalMark !== null ? Number(submission!.finalMark) : null,
        released,
      };
    });

    return {
      ...enrolment,
      assessmentResults: results,
      // Learners see a running mark built only from results already released.
      runningMark: calculateCourseMark(results),
    };
  });
}
