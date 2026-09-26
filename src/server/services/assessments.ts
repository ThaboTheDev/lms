import 'server-only';
import { notifyUsers } from './notifications';
import { prisma } from '@/lib/db';
import { AppError, NotFoundError } from '@/lib/errors';
import { recordAudit } from '@/lib/audit';
import { can, requirePermission, requireSameInstitution, type Principal } from '@/lib/rbac/authorize';
import { assertCanEditOffering, assertCanViewOffering } from './course-builder';
import { checkWeighting } from './grading-rules';

export interface AssessmentInput {
  title: string;
  instructions?: string;
  type: string;
  category: string;
  maxMark: number;
  passMark: number;
  weight: number;
  opensAt?: Date | null;
  dueAt?: Date | null;
  closesAt?: Date | null;
  timeLimitMinutes?: number | null;
  maxAttempts: number;
  allowLate: boolean;
  latePenaltyPct?: number | null;
  shuffleQuestions?: boolean;
  rubricId?: string | null;
  gradingSchemeId?: string | null;
}

function validateDates(input: AssessmentInput) {
  const { opensAt, dueAt, closesAt } = input;
  if (opensAt && dueAt && opensAt > dueAt) {
    throw new AppError('The due date cannot be before the assessment opens.', 422, 'invalid_window');
  }
  if (dueAt && closesAt && dueAt > closesAt) {
    throw new AppError('The closing date cannot be before the due date.', 422, 'invalid_window');
  }
  if (input.passMark > input.maxMark) {
    throw new AppError('The pass mark cannot be higher than the maximum mark.', 422, 'invalid_marks');
  }
}

export async function createAssessment(
  principal: Principal,
  offeringId: string,
  input: AssessmentInput,
) {
  const offering = await assertCanEditOffering(principal, offeringId);
  requirePermission(principal, 'assessment.manage', {
    institutionId: offering.institutionId,
    courseOfferingId: offeringId,
  });
  validateDates(input);

  const assessment = await prisma.assessment.create({
    data: {
      institutionId: offering.institutionId,
      offeringId,
      title: input.title,
      instructions: input.instructions || null,
      type: input.type as never,
      category: input.category as never,
      maxMark: input.maxMark,
      passMark: input.passMark,
      weight: input.weight,
      opensAt: input.opensAt ?? null,
      dueAt: input.dueAt ?? null,
      closesAt: input.closesAt ?? null,
      timeLimitMinutes: input.timeLimitMinutes ?? null,
      maxAttempts: input.maxAttempts,
      allowLate: input.allowLate,
      latePenaltyPct: input.latePenaltyPct ?? null,
      shuffleQuestions: input.shuffleQuestions ?? false,
      rubricId: input.rubricId || null,
      gradingSchemeId: input.gradingSchemeId || null,
      status: 'DRAFT',
      createdById: principal.userId,
    },
  });

  await recordAudit(principal, {
    action: 'assessment.created',
    entityType: 'Assessment',
    entityId: assessment.id,
    institutionId: offering.institutionId,
    after: { title: input.title, type: input.type, weight: input.weight },
  });

  return assessment;
}

export async function updateAssessment(
  principal: Principal,
  assessmentId: string,
  input: Partial<AssessmentInput>,
) {
  const existing = await loadForEdit(principal, assessmentId);

  if (existing.status === 'PUBLISHED') {
    const hasSubmissions = await prisma.submission.count({
      where: { assessmentId, status: { not: 'NOT_STARTED' } },
    });
    // Changing the marks out of a paper learners have already sat would
    // silently rescale their results, so the structural fields lock once work
    // has been submitted. Dates and instructions stay editable.
    if (hasSubmissions > 0 && (input.maxMark !== undefined || input.weight !== undefined)) {
      throw new AppError(
        'Learners have already submitted, so the maximum mark and weighting cannot change. Moderate the marks instead.',
        409,
        'assessment_in_use',
      );
    }
  }

  const merged = { ...existing, ...input } as AssessmentInput;
  validateDates(merged);

  const updated = await prisma.assessment.update({
    where: { id: assessmentId },
    data: input as never,
  });

  // A moved deadline moves on the calendar too, or learners plan to the old one.
  if (updated.dueAt && existing.dueAt?.getTime() !== updated.dueAt.getTime()) {
    await prisma.calendarEvent.updateMany({
      where: { assessmentId },
      data: { startsAt: updated.dueAt, endsAt: updated.dueAt },
    });
  }

  await recordAudit(principal, {
    action: 'assessment.updated',
    entityType: 'Assessment',
    entityId: assessmentId,
    institutionId: existing.institutionId,
    before: { title: existing.title, dueAt: existing.dueAt, status: existing.status },
    after: { title: updated.title, dueAt: updated.dueAt, status: updated.status },
  });

  return updated;
}

/**
 * Publishing is the point at which learners can see and sit the assessment, so
 * it is also the last chance to catch an assessment with no questions or no
 * marks in it.
 */
export async function publishAssessment(principal: Principal, assessmentId: string) {
  const assessment = await loadForEdit(principal, assessmentId);

  const [questionCount, poolCount] = await Promise.all([
    prisma.assessmentQuestion.count({ where: { assessmentId } }),
    prisma.questionPool.count({ where: { assessmentId } }),
  ]);

  const needsQuestions = ['QUIZ', 'TEST', 'EXAMINATION'].includes(assessment.type);
  if (needsQuestions && questionCount === 0 && poolCount === 0) {
    throw new AppError('Add questions before publishing this assessment.', 409, 'no_questions');
  }
  if (Number(assessment.maxMark) <= 0) {
    throw new AppError('Set a maximum mark before publishing.', 409, 'no_marks');
  }
  if (!assessment.dueAt) {
    throw new AppError('Set a due date before publishing.', 409, 'no_due_date');
  }

  const updated = await prisma.assessment.update({
    where: { id: assessmentId },
    data: { status: 'PUBLISHED' },
  });

  // Learners find deadlines on the calendar, not only inside the course.
  await prisma.calendarEvent.create({
    data: {
      institutionId: assessment.institutionId,
      title: `${assessment.title} due`,
      type: assessment.type === 'EXAMINATION' ? 'EXAMINATION' : 'ASSESSMENT_DUE',
      visibility: 'COURSE',
      startsAt: assessment.dueAt,
      endsAt: assessment.dueAt,
      offeringId: assessment.offeringId,
      assessmentId,
      createdById: principal.userId,
    },
  });

  await recordAudit(principal, {
    action: 'assessment.published',
    entityType: 'Assessment',
    entityId: assessmentId,
    institutionId: assessment.institutionId,
    before: { status: assessment.status },
    after: { status: 'PUBLISHED' },
  });

  const enrolled = (await prisma.courseEnrolment.findMany({
    where: { offeringId: assessment.offeringId, status: 'ACTIVE' },
    select: { student: { select: { userId: true } } },
  })) as { student: { userId: string } }[];
  await notifyUsers(
    assessment.institutionId,
    enrolled.map((row) => row.student.userId),
    {
      type: 'assessment.published',
      title: `New assessment: ${assessment.title}`,
      body: `Due ${assessment.dueAt.toLocaleString('en-ZA', { dateStyle: 'long', timeStyle: 'short', timeZone: 'Africa/Johannesburg' })}.`,
      linkUrl: `/courses/${assessment.offeringId}/assessments/${assessmentId}`,
    },
  );
  return updated;
}

export async function loadForEdit(principal: Principal, assessmentId: string) {
  const assessment = await prisma.assessment.findUnique({
    where: { id: assessmentId },
    select: {
      id: true, institutionId: true, offeringId: true, title: true, instructions: true,
      type: true, category: true, maxMark: true, passMark: true, weight: true,
      opensAt: true, dueAt: true, closesAt: true, timeLimitMinutes: true,
      maxAttempts: true, allowLate: true, latePenaltyPct: true, shuffleQuestions: true,
      rubricId: true, gradingSchemeId: true, status: true,
    },
  });
  if (!assessment) throw new NotFoundError('Assessment');
  requireSameInstitution(principal, assessment.institutionId);
  await assertCanEditOffering(principal, assessment.offeringId);
  requirePermission(principal, 'assessment.manage', {
    institutionId: assessment.institutionId,
    courseOfferingId: assessment.offeringId,
  });
  return assessment;
}

/** The assessment plan for a course, with the weighting check attached. */
export async function listCourseAssessments(principal: Principal, offeringId: string) {
  const { offering, viewer } = await assertCanViewOffering(principal, offeringId);

  const assessments = await prisma.assessment.findMany({
    where: {
      offeringId,
      ...(viewer === 'learner' ? { status: 'PUBLISHED' } : {}),
    },
    orderBy: [{ dueAt: 'asc' }, { title: 'asc' }],
    select: {
      id: true, title: true, type: true, category: true, status: true,
      maxMark: true, passMark: true, weight: true, opensAt: true, dueAt: true,
      closesAt: true, timeLimitMinutes: true, maxAttempts: true, allowLate: true,
      releaseResultsAt: true,
      _count: { select: { submissions: true, questions: true } },
      submissions:
        viewer === 'learner' && principal.studentId
          ? {
              where: { studentId: principal.studentId },
              select: {
                attemptNumber: true, status: true, startedAt: true, submittedAt: true,
                finalMark: true, grade: true, returnedAt: true,
              },
            }
          : false,
    },
  });

  const problems =
    viewer === 'staff'
      ? checkWeighting(assessments.map((a) => ({ title: a.title, weight: Number(a.weight) })))
      : [];

  return { offering, viewer, assessments, problems };
}

/** Everything waiting for this marker, across every course they touch. */
export async function markingQueue(principal: Principal) {
  requirePermission(principal, 'submission.grade');

  const submissions = await prisma.submission.findMany({
    where: {
      status: { in: ['SUBMITTED', 'LATE', 'UNDER_REVIEW'] },
      assessment: {
        institutionId: principal.institutionId ?? undefined,
        offering: can(principal, 'course.manage')
          ? {}
          : { staff: { some: { userId: principal.userId, role: { in: ['LECTURER', 'ASSESSOR', 'FACILITATOR'] } } } },
      },
    },
    orderBy: { submittedAt: 'asc' },
    take: 100,
    select: {
      id: true, attemptNumber: true, status: true, submittedAt: true, isLate: true,
      autoMark: true,
      student: { select: { id: true, studentNumber: true, user: { select: { firstName: true, lastName: true } } } },
      assessment: {
        select: {
          id: true, title: true, type: true, maxMark: true, dueAt: true,
          offering: { select: { id: true, course: { select: { code: true, title: true } } } },
        },
      },
    },
  });

  return submissions;
}
