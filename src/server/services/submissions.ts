import 'server-only';
import { notifyUsers } from './notifications';
import { prisma } from '@/lib/db';
import { AppError, NotFoundError } from '@/lib/errors';
import { recordAudit } from '@/lib/audit';
import { can, requirePermission, requireSameInstitution, type Principal } from '@/lib/rbac/authorize';
import { assertCanViewOffering } from './course-builder';
import {
  attemptDeadline,
  canStartAttempt,
  canSubmitAttempt,
  type AssessmentTiming,
} from './assessment-window';
import { applyLatePenalty, applyGradeBands, scoreRubric, toPercent } from './grading-rules';
import { drawFromPools, markAttempt, seededShuffle, type Answer, type MarkableQuestion } from './quiz-engine';

const TIMING_SELECT = {
  id: true, institutionId: true, offeringId: true, title: true, instructions: true,
  type: true, status: true, maxMark: true, passMark: true, weight: true,
  opensAt: true, dueAt: true, closesAt: true, timeLimitMinutes: true, maxAttempts: true,
  allowLate: true, latePenaltyPct: true, shuffleQuestions: true, releaseResultsAt: true,
  rubricId: true, gradingSchemeId: true,
} as const;

function timing(assessment: Record<string, unknown>): AssessmentTiming {
  return {
    status: assessment.status as string,
    opensAt: assessment.opensAt as Date | null,
    dueAt: assessment.dueAt as Date | null,
    closesAt: assessment.closesAt as Date | null,
    timeLimitMinutes: assessment.timeLimitMinutes as number | null,
    maxAttempts: assessment.maxAttempts as number,
    allowLate: assessment.allowLate as boolean,
  };
}

async function loadAssessmentForLearner(principal: Principal, assessmentId: string) {
  const assessment = await prisma.assessment.findUnique({
    where: { id: assessmentId },
    select: TIMING_SELECT,
  });
  if (!assessment) throw new NotFoundError('Assessment');
  requireSameInstitution(principal, assessment.institutionId);
  await assertCanViewOffering(principal, assessment.offeringId);
  return assessment;
}

/**
 * Starts an attempt and fixes the paper for it. The questions drawn from a pool
 * and their order are decided once, seeded by the attempt, so reloading the
 * page cannot reroll the paper and two learners do not sit the same one.
 */
export async function startAttempt(principal: Principal, assessmentId: string) {
  if (!principal.studentId) throw new AppError('Only a learner sits an assessment.', 403, 'not_a_learner');

  const assessment = await loadAssessmentForLearner(principal, assessmentId);

  const attempts = await prisma.submission.findMany({
    where: { assessmentId, studentId: principal.studentId },
    select: { attemptNumber: true, status: true, startedAt: true, submittedAt: true },
  });

  const gate = canStartAttempt(timing(assessment), attempts);
  if (gate.can === 'no') throw new AppError(gate.reason, 409, 'attempt_not_allowed');
  if (gate.can === 'resume') {
    const existing = await prisma.submission.findUnique({
      where: {
        assessmentId_studentId_attemptNumber: {
          assessmentId,
          studentId: principal.studentId,
          attemptNumber: gate.attemptNumber,
        },
      },
    });
    return existing!;
  }

  const submission = await prisma.submission.create({
    data: {
      assessmentId,
      studentId: principal.studentId,
      attemptNumber: gate.attemptNumber,
      status: 'IN_PROGRESS',
      startedAt: new Date(),
      isLate: gate.lateWarning,
    },
  });

  const paper = await composePaper(assessmentId, submission.id, assessment.shuffleQuestions);
  await prisma.submission.update({
    where: { id: submission.id },
    data: { answers: { paper, responses: {} } as never },
  });

  await prisma.submissionEvent.create({
    data: { submissionId: submission.id, actorId: principal.userId, action: 'attempt.started' },
  });

  return submission;
}

/** Fixed questions first, then one draw per pool, shuffled if configured. */
async function composePaper(assessmentId: string, seed: string, shuffle: boolean) {
  const [fixed, pools] = await Promise.all([
    prisma.assessmentQuestion.findMany({
      where: { assessmentId, questionId: { not: null } },
      orderBy: { orderIndex: 'asc' },
      select: { questionId: true, mark: true },
    }),
    prisma.questionPool.findMany({
      where: { assessmentId },
      select: {
        id: true, drawCount: true, markPerQuestion: true, difficulty: true, topic: true, bankId: true,
      },
    }),
  ]);

  const poolSpecs = await Promise.all(
    pools.map(async (pool) => ({
      poolId: pool.id,
      drawCount: pool.drawCount,
      markPerQuestion: Number(pool.markPerQuestion),
      difficulty: pool.difficulty as string | null,
      topic: pool.topic,
      candidates: await prisma.question.findMany({
        where: { bankId: pool.bankId, isActive: true },
        select: { id: true, difficulty: true, topic: true },
      }),
    })),
  );

  const drawn = drawFromPools(
    poolSpecs.map((spec) => ({
      ...spec,
      candidates: spec.candidates.map((c) => ({ id: c.id, difficulty: c.difficulty as string, topic: c.topic })),
    })),
    seed,
  );

  const paper = [
    ...fixed.map((item) => ({ questionId: item.questionId!, mark: Number(item.mark) })),
    ...drawn.map((item) => ({ questionId: item.questionId, mark: item.mark })),
  ];

  return shuffle ? seededShuffle(paper, `${seed}:order`) : paper;
}

/** Autosave. Answers are kept on the attempt until it is submitted. */
export async function saveAnswers(
  principal: Principal,
  submissionId: string,
  responses: Record<string, Answer>,
) {
  const submission = await prisma.submission.findUnique({
    where: { id: submissionId },
    select: { id: true, studentId: true, status: true, answers: true, assessmentId: true },
  });
  if (!submission) throw new NotFoundError('Attempt');
  if (submission.studentId !== principal.studentId) {
    throw new AppError('This is not your attempt.', 403, 'forbidden');
  }
  if (submission.status !== 'IN_PROGRESS') {
    throw new AppError('This attempt has already been submitted.', 409, 'already_submitted');
  }

  const current = (submission.answers ?? {}) as { paper?: unknown; responses?: Record<string, Answer> };

  await prisma.submission.update({
    where: { id: submissionId },
    data: { answers: { ...current, responses: { ...(current.responses ?? {}), ...responses } } as never },
  });

  return { saved: true, at: new Date() };
}

/**
 * Submits an attempt. Auto-markable questions are scored immediately; anything
 * needing a human leaves the attempt awaiting marking rather than being scored
 * as zero. The late rule is applied here, from the server clock.
 */
export async function submitAttempt(principal: Principal, submissionId: string, auto = false) {
  const submission = await prisma.submission.findUnique({
    where: { id: submissionId },
    select: {
      id: true, studentId: true, status: true, answers: true, startedAt: true,
      attemptNumber: true, assessmentId: true,
    },
  });
  if (!submission) throw new NotFoundError('Attempt');
  if (!auto && submission.studentId !== principal.studentId) {
    throw new AppError('This is not your attempt.', 403, 'forbidden');
  }

  const assessment = await prisma.assessment.findUnique({
    where: { id: submission.assessmentId },
    select: TIMING_SELECT,
  });
  if (!assessment) throw new NotFoundError('Assessment');

  // A server-initiated submission (the sweep for abandoned timed attempts)
  // happens after the deadline by definition. It is judged, and recorded, as
  // at the deadline: the learner's autosaved answers count, nothing later does.
  const deadline = attemptDeadline(timing(assessment), submission.startedAt);
  const now = new Date();
  const effectiveAt = auto && deadline && deadline < now ? deadline : now;

  const gate = canSubmitAttempt(
    timing(assessment),
    {
      attemptNumber: submission.attemptNumber,
      status: submission.status,
      startedAt: submission.startedAt,
      submittedAt: null,
    },
    effectiveAt,
  );
  if (!gate.can) throw new AppError(gate.reason, 409, 'submit_not_allowed');

  const stored = (submission.answers ?? {}) as {
    paper?: { questionId: string; mark: number }[];
    responses?: Record<string, Answer>;
  };
  const paper = stored.paper ?? [];
  const responses = stored.responses ?? {};

  const questions = await prisma.question.findMany({
    where: { id: { in: paper.map((item) => item.questionId) } },
    select: {
      id: true, type: true, prompt: true,
      options: { select: { id: true, content: true, isCorrect: true, matchKey: true, orderIndex: true } },
    },
  });

  const markable: MarkableQuestion[] = paper.flatMap((item) => {
    const question = questions.find((candidate) => candidate.id === item.questionId);
    if (!question) return [];
    const prompt = question.prompt as { settings?: Record<string, unknown> } | null;
    return [
      {
        id: question.id,
        type: question.type as never,
        mark: item.mark,
        options: question.options,
        settings: (prompt?.settings ?? {}) as never,
      },
    ];
  });

  const marking = markAttempt(markable, responses);
  const submittedAt = effectiveAt;

  const late = applyLatePenalty(marking.autoMark, submittedAt, {
    allowLate: assessment.allowLate,
    latePenaltyPct: assessment.latePenaltyPct ? Number(assessment.latePenaltyPct) : null,
    dueAt: assessment.dueAt,
    closesAt: assessment.closesAt,
  });

  const fullyAutoMarked = !marking.awaitingManualMarking && markable.length > 0;

  await prisma.$transaction(async (tx) => {
    await tx.submission.update({
      where: { id: submissionId },
      data: {
        status: fullyAutoMarked ? 'GRADED' : late.isLate ? 'LATE' : 'SUBMITTED',
        submittedAt,
        isLate: late.isLate,
        autoMark: marking.autoMark,
        finalMark: fullyAutoMarked ? late.finalMark : null,
        timeSpentSec: submission.startedAt
          ? Math.round((submittedAt.getTime() - submission.startedAt.getTime()) / 1000)
          : null,
        gradedAt: fullyAutoMarked ? submittedAt : null,
      },
    });

    for (const result of marking.results) {
      await tx.questionResponse.upsert({
        where: { submissionId_questionId: { submissionId, questionId: result.questionId } },
        create: {
          submissionId,
          questionId: result.questionId,
          response: (responses[result.questionId] ?? null) as never,
          awardedMark: result.awardedMark,
          isCorrect: result.isCorrect,
        },
        update: { awardedMark: result.awardedMark, isCorrect: result.isCorrect },
      });
    }

    await tx.submissionEvent.create({
      data: {
        submissionId,
        actorId: auto ? null : principal.userId,
        action: auto ? 'attempt.auto_submitted' : 'attempt.submitted',
        note: late.isLate ? `Late by ${late.daysLate} day(s); penalty ${late.penaltyApplied}.` : null,
      },
    });
  });

  return {
    submitted: true,
    awaitingMarking: marking.awaitingManualMarking,
    autoMark: marking.autoMark,
    isLate: late.isLate,
  };
}

export interface GradeInput {
  manualMark?: number;
  feedback?: string;
  rubricScores?: { criterionId: string; levelId?: string; score: number; comment?: string }[];
  questionMarks?: { questionId: string; awardedMark: number; feedback?: string }[];
  requestResubmission?: boolean;
}

/**
 * Records a mark. Where a rubric is attached the rubric decides the mark, so an
 * assessor cannot enter a total that the criteria do not support; the late
 * penalty is applied on top, from the submission time rather than now.
 */
export async function gradeSubmission(principal: Principal, submissionId: string, input: GradeInput) {
  const submission = await prisma.submission.findUnique({
    where: { id: submissionId },
    select: {
      id: true, status: true, autoMark: true, submittedAt: true, isLate: true,
      assessment: { select: TIMING_SELECT },
    },
  });
  if (!submission) throw new NotFoundError('Submission');

  const assessment = submission.assessment;
  requireSameInstitution(principal, assessment.institutionId);
  requirePermission(principal, 'submission.grade', {
    institutionId: assessment.institutionId,
    courseOfferingId: assessment.offeringId,
  });

  let earned = input.manualMark ?? Number(submission.autoMark ?? 0);

  if (assessment.rubricId && input.rubricScores?.length) {
    const criteria = await prisma.rubricCriterion.findMany({
      where: { rubricId: assessment.rubricId },
      select: { id: true, title: true, weight: true, maxScore: true },
    });

    const outcome = scoreRubric(
      criteria.map((criterion) => ({
        id: criterion.id,
        title: criterion.title,
        weight: Number(criterion.weight),
        maxScore: Number(criterion.maxScore),
      })),
      input.rubricScores,
    );

    earned = Math.round((outcome.percent / 100) * Number(assessment.maxMark) * 100) / 100;
  }

  if (input.questionMarks?.length) {
    const manualTotal = input.questionMarks.reduce((sum, entry) => sum + entry.awardedMark, 0);
    earned = Math.round((Number(submission.autoMark ?? 0) + manualTotal) * 100) / 100;
  }

  if (earned > Number(assessment.maxMark)) {
    throw new AppError(
      `The mark cannot exceed the maximum of ${Number(assessment.maxMark)}.`,
      422,
      'mark_too_high',
    );
  }

  const late = applyLatePenalty(earned, submission.submittedAt ?? new Date(), {
    allowLate: assessment.allowLate,
    latePenaltyPct: assessment.latePenaltyPct ? Number(assessment.latePenaltyPct) : null,
    dueAt: assessment.dueAt,
    closesAt: assessment.closesAt,
  });

  const bands = assessment.gradingSchemeId
    ? await prisma.gradeBand.findMany({
        where: { schemeId: assessment.gradingSchemeId },
        select: { label: true, minPercent: true, maxPercent: true, gradePoint: true, isPass: true },
      })
    : [];

  const percent = toPercent(late.finalMark, Number(assessment.maxMark));
  const graded = bands.length
    ? applyGradeBands(
        percent,
        bands.map((band) => ({
          label: band.label,
          minPercent: Number(band.minPercent),
          maxPercent: Number(band.maxPercent),
          gradePoint: band.gradePoint ? Number(band.gradePoint) : null,
          isPass: band.isPass,
        })),
      )
    : null;

  await prisma.$transaction(async (tx) => {
    await tx.submission.update({
      where: { id: submissionId },
      data: {
        manualMark: input.manualMark ?? null,
        finalMark: late.finalMark,
        grade: graded?.label ?? null,
        feedback: input.feedback ?? null,
        status: input.requestResubmission ? 'RESUBMISSION_REQUESTED' : 'GRADED',
        gradedById: principal.userId,
        gradedAt: new Date(),
      },
    });

    for (const score of input.rubricScores ?? []) {
      await tx.rubricScore.upsert({
        where: { submissionId_criterionId: { submissionId, criterionId: score.criterionId } },
        create: {
          submissionId,
          criterionId: score.criterionId,
          levelId: score.levelId ?? null,
          score: score.score,
          comment: score.comment ?? null,
        },
        update: { levelId: score.levelId ?? null, score: score.score, comment: score.comment ?? null },
      });
    }

    for (const entry of input.questionMarks ?? []) {
      await tx.questionResponse.updateMany({
        where: { submissionId, questionId: entry.questionId },
        data: { awardedMark: entry.awardedMark, feedback: entry.feedback ?? null, gradedById: principal.userId },
      });
    }

    await tx.submissionEvent.create({
      data: {
        submissionId,
        actorId: principal.userId,
        action: input.requestResubmission ? 'submission.resubmission_requested' : 'submission.graded',
        note: late.isLate ? `Late penalty of ${late.penaltyApplied} applied.` : null,
      },
    });
  });

  await recordAudit(principal, {
    action: 'submission.graded',
    entityType: 'Submission',
    entityId: submissionId,
    institutionId: assessment.institutionId,
    before: { status: submission.status },
    after: { finalMark: late.finalMark, grade: graded?.label ?? null, latePenalty: late.penaltyApplied },
  });

  return { finalMark: late.finalMark, grade: graded?.label ?? null, percent };
}

/**
 * Releases results to learners. Marks are held back until someone decides to
 * publish them, which is what lets a lecturer mark a class over several days
 * without learners comparing partial results as they appear.
 */
export async function releaseResults(principal: Principal, assessmentId: string) {
  const assessment = await prisma.assessment.findUnique({
    where: { id: assessmentId },
    select: { id: true, institutionId: true, offeringId: true, title: true },
  });
  if (!assessment) throw new NotFoundError('Assessment');
  requireSameInstitution(principal, assessment.institutionId);
  requirePermission(principal, 'grade.publish', {
    institutionId: assessment.institutionId,
    courseOfferingId: assessment.offeringId,
  });

  const outstanding = await prisma.submission.count({
    where: { assessmentId, status: { in: ['SUBMITTED', 'LATE', 'UNDER_REVIEW'] } },
  });
  if (outstanding > 0) {
    throw new AppError(
      `${outstanding} submissions are still unmarked. Mark them first, or void them.`,
      409,
      'marking_incomplete',
    );
  }

  const learners = (await prisma.submission.findMany({
    where: { assessmentId, status: 'GRADED' },
    select: { student: { select: { userId: true } } },
  })) as { student: { userId: string } }[];

  const released = await prisma.$transaction(async (tx) => {
    const count = await tx.submission.updateMany({
      where: { assessmentId, status: 'GRADED' },
      data: { returnedAt: new Date(), status: 'RETURNED' },
    });
    await tx.assessment.update({
      where: { id: assessmentId },
      data: { releaseResultsAt: new Date(), status: 'CLOSED' },
    });
    return count.count;
  });

  await recordAudit(principal, {
    action: 'assessment.results_released',
    entityType: 'Assessment',
    entityId: assessmentId,
    institutionId: assessment.institutionId,
    after: { title: assessment.title, released },
  });

  await notifyUsers(
    assessment.institutionId,
    learners.map((row) => row.student.userId),
    {
      type: 'grade.released',
      title: `Results released: ${assessment.title}`,
      body: 'Your mark and your marker\'s feedback are ready to read.',
      linkUrl: `/courses/${assessment.offeringId}/assessments/${assessmentId}`,
    },
  );
  return { released };
}

/** A learner's own view of one attempt, with results withheld until released. */
export async function loadAttemptForLearner(principal: Principal, submissionId: string) {
  const submission = await prisma.submission.findUnique({
    where: { id: submissionId },
    select: {
      id: true, studentId: true, status: true, answers: true, startedAt: true,
      submittedAt: true, finalMark: true, grade: true, feedback: true, returnedAt: true,
      attemptNumber: true,
      assessment: { select: TIMING_SELECT },
    },
  });
  if (!submission) throw new NotFoundError('Attempt');

  const isOwner = submission.studentId === principal.studentId;
  if (!isOwner) {
    requirePermission(principal, 'submission.read', {
      institutionId: submission.assessment.institutionId,
      courseOfferingId: submission.assessment.offeringId,
    });
  }

  const released = Boolean(submission.returnedAt);
  const stored = (submission.answers ?? {}) as {
    paper?: { questionId: string; mark: number }[];
    responses?: Record<string, Answer>;
  };

  const questions = stored.paper?.length
    ? await prisma.question.findMany({
        where: { id: { in: stored.paper.map((item) => item.questionId) } },
        select: {
          id: true, type: true, prompt: true, explanation: true,
          options: {
            orderBy: { orderIndex: 'asc' },
            select: { id: true, content: true, matchKey: true, orderIndex: true, isCorrect: released || !isOwner },
          },
        },
      })
    : [];

  return {
    submission: {
      ...submission,
      finalMark: isOwner && !released ? null : submission.finalMark,
      grade: isOwner && !released ? null : submission.grade,
      feedback: isOwner && !released ? null : submission.feedback,
    },
    paper: stored.paper ?? [],
    responses: stored.responses ?? {},
    questions,
    deadline: attemptDeadline(timing(submission.assessment), submission.startedAt),
    canSeeResults: released || !isOwner,
  };
}

/** Everything one assessment has received, for the marking screen. */
export async function listSubmissions(principal: Principal, assessmentId: string) {
  const assessment = await prisma.assessment.findUnique({
    where: { id: assessmentId },
    select: { ...TIMING_SELECT, offering: { select: { course: { select: { code: true, title: true } } } } },
  });
  if (!assessment) throw new NotFoundError('Assessment');
  requireSameInstitution(principal, assessment.institutionId);
  requirePermission(principal, 'submission.read', {
    institutionId: assessment.institutionId,
    courseOfferingId: assessment.offeringId,
  });

  const [submissions, enrolled] = await Promise.all([
    prisma.submission.findMany({
      where: { assessmentId },
      orderBy: [{ submittedAt: 'asc' }],
      select: {
        id: true, attemptNumber: true, status: true, submittedAt: true, isLate: true,
        autoMark: true, finalMark: true, grade: true, returnedAt: true,
        student: {
          select: { id: true, studentNumber: true, user: { select: { firstName: true, lastName: true } } },
        },
      },
    }),
    prisma.courseEnrolment.count({ where: { offeringId: assessment.offeringId, status: 'ACTIVE' } }),
  ]);

  return {
    assessment,
    submissions,
    enrolled,
    canRelease: can(principal, 'grade.publish', {
      institutionId: assessment.institutionId,
      courseOfferingId: assessment.offeringId,
    }),
  };
}

/**
 * Attaches an uploaded file to an assignment attempt. A learner may replace
 * their work up to the moment they submit; afterwards the file list is fixed,
 * which is what makes the submission evidence rather than a shared folder.
 */
export async function attachSubmissionFile(principal: Principal, submissionId: string, fileId: string) {
  const submission = await prisma.submission.findUnique({
    where: { id: submissionId },
    select: { id: true, studentId: true, status: true },
  });
  if (!submission) throw new NotFoundError('Attempt');
  if (submission.studentId !== principal.studentId) {
    throw new AppError('This is not your submission.', 403, 'forbidden');
  }
  if (submission.status !== 'IN_PROGRESS' && submission.status !== 'RESUBMISSION_REQUESTED') {
    throw new AppError('This submission is closed. Ask your lecturer to reopen it.', 409, 'already_submitted');
  }

  const file = await prisma.fileObject.findUnique({
    where: { id: fileId },
    select: { id: true, uploadedById: true, originalName: true },
  });
  if (!file || file.uploadedById !== principal.userId) {
    throw new AppError('That file is not yours to submit.', 403, 'forbidden');
  }

  await prisma.submissionFile.create({ data: { submissionId, fileId } });
  await prisma.submissionEvent.create({
    data: {
      submissionId,
      actorId: principal.userId,
      action: 'submission.file_added',
      note: file.originalName,
    },
  });

  return { attached: true };
}

export async function removeSubmissionFile(principal: Principal, submissionId: string, fileId: string) {
  const submission = await prisma.submission.findUnique({
    where: { id: submissionId },
    select: { studentId: true, status: true },
  });
  if (!submission) throw new NotFoundError('Attempt');
  if (submission.studentId !== principal.studentId) {
    throw new AppError('This is not your submission.', 403, 'forbidden');
  }
  if (submission.status !== 'IN_PROGRESS' && submission.status !== 'RESUBMISSION_REQUESTED') {
    throw new AppError('Submitted work cannot be changed.', 409, 'already_submitted');
  }

  await prisma.submissionFile.deleteMany({ where: { submissionId, fileId } });
}

/** The marking view of one submission, with the rubric and the learner's work. */
export async function loadSubmissionForMarking(principal: Principal, submissionId: string) {
  const submission = await prisma.submission.findUnique({
    where: { id: submissionId },
    select: {
      id: true, attemptNumber: true, status: true, submittedAt: true, isLate: true,
      autoMark: true, manualMark: true, finalMark: true, grade: true, feedback: true,
      answers: true, timeSpentSec: true, returnedAt: true,
      student: {
        select: { id: true, studentNumber: true, user: { select: { firstName: true, lastName: true } } },
      },
      files: {
        select: { fileId: true, uploadedAt: true, file: { select: { originalName: true, mimeType: true, sizeBytes: true, scanStatus: true } } },
      },
      responses: {
        select: { questionId: true, response: true, awardedMark: true, isCorrect: true, feedback: true },
      },
      rubricScores: { select: { criterionId: true, levelId: true, score: true, comment: true } },
      events: {
        orderBy: { createdAt: 'desc' },
        select: { id: true, action: true, note: true, createdAt: true },
      },
      assessment: {
        select: {
          ...TIMING_SELECT,
          offering: { select: { id: true, course: { select: { code: true, title: true } } } },
          rubric: {
            select: {
              id: true, title: true,
              criteria: {
                orderBy: { orderIndex: 'asc' },
                select: {
                  id: true, title: true, description: true, weight: true, maxScore: true,
                  levels: { orderBy: { orderIndex: 'asc' }, select: { id: true, label: true, descriptor: true, score: true } },
                },
              },
            },
          },
        },
      },
    },
  });
  if (!submission) throw new NotFoundError('Submission');

  requireSameInstitution(principal, submission.assessment.institutionId);
  requirePermission(principal, 'submission.read', {
    institutionId: submission.assessment.institutionId,
    courseOfferingId: submission.assessment.offeringId,
  });

  const stored = (submission.answers ?? {}) as {
    paper?: { questionId: string; mark: number }[];
    responses?: Record<string, unknown>;
  };

  const questions = stored.paper?.length
    ? await prisma.question.findMany({
        where: { id: { in: stored.paper.map((item) => item.questionId) } },
        select: {
          id: true, type: true, prompt: true, explanation: true,
          options: { orderBy: { orderIndex: 'asc' }, select: { id: true, content: true, isCorrect: true, matchKey: true } },
        },
      })
    : [];

  return {
    submission,
    paper: stored.paper ?? [],
    questions,
    canGrade: can(principal, 'submission.grade', {
      institutionId: submission.assessment.institutionId,
      courseOfferingId: submission.assessment.offeringId,
    }),
  };
}
