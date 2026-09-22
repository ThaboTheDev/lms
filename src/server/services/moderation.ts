import 'server-only';
import { prisma } from '@/lib/db';
import { AppError, NotFoundError } from '@/lib/errors';
import { recordAudit } from '@/lib/audit';
import { toPercent } from './grading-rules';
import { requirePermission, requireSameInstitution, type Principal } from '@/lib/rbac/authorize';
import {
  analyseDiscrepancies,
  applyAdjustment,
  buildSample,
  type Adjustment,
  type MarkPair,
} from './moderation-rules';

/**
 * Loads an assessment with its marked submissions and draws the moderation
 * sample. The sample is seeded by the assessment, so a moderator who reloads
 * the page gets the same scripts rather than a fresh set.
 */
export async function openModeration(principal: Principal, assessmentId: string) {
  const assessment = await prisma.assessment.findUnique({
    where: { id: assessmentId },
    select: {
      id: true, institutionId: true, offeringId: true, title: true, type: true,
      maxMark: true, passMark: true, status: true, releaseResultsAt: true,
      offering: { select: { id: true, course: { select: { code: true, title: true } } } },
      moderations: {
        orderBy: { moderatedAt: 'desc' },
        select: {
          id: true, type: true, outcome: true, sampleSize: true, adjustedMark: true,
          comments: true, moderatedAt: true,
          moderator: { select: { firstName: true, lastName: true } },
        },
      },
    },
  });
  if (!assessment) throw new NotFoundError('Assessment');

  requireSameInstitution(principal, assessment.institutionId);
  requirePermission(principal, 'moderation.perform', {
    institutionId: assessment.institutionId,
    courseOfferingId: assessment.offeringId,
  });

  const submissions = await prisma.submission.findMany({
    where: { assessmentId, finalMark: { not: null }, status: { in: ['GRADED', 'RETURNED'] } },
    select: {
      id: true, finalMark: true, grade: true,
      student: { select: { studentNumber: true } },
      moderations: { select: { adjustedMark: true, outcome: true } },
    },
  });

  const maxMark = Number(assessment.maxMark);

  const sample = buildSample(
    submissions.map((submission: { id: string; finalMark: unknown; student: { studentNumber: string } }) => ({
      submissionId: submission.id,
      studentNumber: submission.student.studentNumber,
      markPercent: toPercent(Number(submission.finalMark), maxMark),
    })),
    toPercent(Number(assessment.passMark), maxMark),
    assessmentId,
  );

  return { assessment, submissions, sample, maxMark };
}

export interface ModerationInput {
  assessmentId: string;
  type: 'PRE_ASSESSMENT' | 'INTERNAL' | 'EXTERNAL' | 'POST_ASSESSMENT';
  comments?: string;
  /** Moderator's own mark per sampled submission, where they re-marked. */
  sampleMarks?: { submissionId: string; moderatorMark: number }[];
  outcome?: string;
}

/**
 * Records a moderation. The comparison between the assessor's marks and the
 * moderator's is computed here rather than typed in, and the recommendation it
 * produces is stored alongside whatever outcome the moderator actually chose,
 * so a disagreement between the two is visible rather than lost.
 */
export async function recordModeration(principal: Principal, input: ModerationInput) {
  const assessment = await prisma.assessment.findUnique({
    where: { id: input.assessmentId },
    select: { id: true, institutionId: true, offeringId: true, title: true, maxMark: true },
  });
  if (!assessment) throw new NotFoundError('Assessment');

  requireSameInstitution(principal, assessment.institutionId);
  requirePermission(principal, 'moderation.perform', {
    institutionId: assessment.institutionId,
    courseOfferingId: assessment.offeringId,
  });

  let analysis = null;

  if (input.sampleMarks?.length) {
    const submissions = await prisma.submission.findMany({
      where: { id: { in: input.sampleMarks.map((entry) => entry.submissionId) } },
      select: { id: true, finalMark: true },
    });

    const pairs: MarkPair[] = input.sampleMarks.flatMap((entry) => {
      const submission = submissions.find((row: { id: string }) => row.id === entry.submissionId);
      if (!submission || submission.finalMark === null) return [];
      return [
        {
          submissionId: entry.submissionId,
          assessorMark: Number(submission.finalMark),
          moderatorMark: entry.moderatorMark,
        },
      ];
    });

    analysis = analyseDiscrepancies(pairs);
  }

  const outcome = (input.outcome ?? analysis?.recommendedVerdict ?? 'APPROVED') as never;
  const overridden = Boolean(
    input.outcome && analysis && input.outcome !== analysis.recommendedVerdict,
  );

  const comments = [
    ...(analysis?.reasons ?? []),
    ...(overridden
      ? [`Recorded as ${input.outcome} rather than the suggested ${analysis!.recommendedVerdict}.`]
      : []),
    ...(input.comments ? [input.comments] : []),
  ].join(' ');

  const record = await prisma.moderationRecord.create({
    data: {
      institutionId: assessment.institutionId,
      assessmentId: input.assessmentId,
      type: input.type as never,
      moderatorId: principal.userId,
      outcome,
      sampleSize: input.sampleMarks?.length ?? null,
      comments: comments || null,
    },
    select: { id: true },
  });

  await recordAudit(principal, {
    action: 'moderation.recorded',
    entityType: 'Assessment',
    entityId: input.assessmentId,
    institutionId: assessment.institutionId,
    after: {
      title: assessment.title,
      type: input.type,
      outcome,
      sampleSize: input.sampleMarks?.length ?? 0,
      meanDifference: analysis?.meanDifference ?? null,
      overridden,
    },
  });

  return { id: record.id, analysis };
}

/**
 * Applies a blanket adjustment to a whole cohort after moderation. Every mark
 * that moves is written to the audit log with its before and after, because a
 * cohort-wide change to results is the single thing an external examiner will
 * want to trace.
 */
export async function adjustCohortMarks(
  principal: Principal,
  assessmentId: string,
  adjustment: Adjustment,
  reason: string,
) {
  const assessment = await prisma.assessment.findUnique({
    where: { id: assessmentId },
    select: {
      id: true, institutionId: true, offeringId: true, title: true,
      maxMark: true, releaseResultsAt: true,
    },
  });
  if (!assessment) throw new NotFoundError('Assessment');

  requireSameInstitution(principal, assessment.institutionId);
  requirePermission(principal, 'moderation.perform', {
    institutionId: assessment.institutionId,
    courseOfferingId: assessment.offeringId,
  });

  if (!reason.trim()) {
    throw new AppError('Record why the cohort is being adjusted.', 422, 'reason_required');
  }

  const submissions = await prisma.submission.findMany({
    where: { assessmentId, finalMark: { not: null } },
    select: { id: true, finalMark: true },
  });

  const result = applyAdjustment(
    submissions.map((submission: { id: string; finalMark: unknown }) => ({
      submissionId: submission.id,
      mark: Number(submission.finalMark),
    })),
    adjustment,
    Number(assessment.maxMark),
  );

  if (result.needsExternalApproval) {
    const external = await prisma.moderationRecord.count({
      where: { assessmentId, type: 'EXTERNAL', outcome: { in: ['APPROVED', 'APPROVED_WITH_CHANGES'] } },
    });
    if (external === 0) {
      throw new AppError(
        'An adjustment this large needs an external moderation record first. Moving a whole cohort is a decision about the assessment, not about the learners.',
        409,
        'external_approval_required',
      );
    }
  }

  const changed = result.marks.filter((entry) => entry.changed);

  await prisma.$transaction(
    changed.map((entry) =>
      prisma.submission.update({
        where: { id: entry.submissionId },
        data: { finalMark: entry.after },
      }),
    ),
  );

  await prisma.submissionEvent.createMany({
    data: changed.map((entry) => ({
      submissionId: entry.submissionId,
      actorId: principal.userId,
      action: 'submission.moderated',
      note: `Moderation adjustment: ${entry.before} to ${entry.after}. ${reason.trim()}`,
    })),
  });

  await recordAudit(principal, {
    action: 'moderation.marks_adjusted',
    entityType: 'Assessment',
    entityId: assessmentId,
    institutionId: assessment.institutionId,
    before: { marks: result.marks.map((entry) => ({ id: entry.submissionId, mark: entry.before })) },
    after: {
      title: assessment.title,
      adjustment,
      reason: reason.trim(),
      affected: result.affected,
      marks: changed.map((entry) => ({ id: entry.submissionId, mark: entry.after })),
    },
  });

  return result;
}

/** Assessments with released results and no moderation on file. */
export async function moderationQueue(principal: Principal) {
  requirePermission(principal, 'moderation.perform');

  const assessments = await prisma.assessment.findMany({
    where: {
      institutionId: principal.institutionId ?? undefined,
      status: { in: ['PUBLISHED', 'CLOSED'] },
    },
    orderBy: { dueAt: 'desc' },
    take: 100,
    select: {
      id: true, title: true, type: true, dueAt: true, releaseResultsAt: true, weight: true,
      offering: { select: { id: true, course: { select: { code: true, title: true } } } },
      _count: { select: { submissions: true, moderations: true } },
    },
  });

  return assessments.map((assessment) => ({
    ...assessment,
    // A result released with no moderation is the case a quality officer needs
    // in front of them, so it is flagged rather than left to be noticed.
    releasedWithoutModeration:
      Boolean(assessment.releaseResultsAt) && assessment._count.moderations === 0,
  }));
}
