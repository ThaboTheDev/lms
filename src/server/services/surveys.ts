import 'server-only';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { env } from '@/lib/env';
import { AppError, NotFoundError } from '@/lib/errors';
import { recordAudit } from '@/lib/audit';
import type { Principal } from '@/lib/rbac/authorize';
import { assertCanEditOffering, assertCanViewOffering } from './course-builder';
import {
  aggregateSurvey,
  respondentKey,
  surveyIsOpen,
  validateSurveyAnswers,
  type SurveyAnswer,
  type SurveyQuestionShape,
} from './survey-rules';

const questionSelect = { id: true, prompt: true, type: true, options: true, isRequired: true, orderIndex: true } as const;

async function surveyWithOffering(surveyId: string) {
  const survey = await prisma.survey.findUnique({
    where: { id: surveyId },
    select: {
      id: true,
      offeringId: true,
      institutionId: true,
      title: true,
      description: true,
      isAnonymous: true,
      status: true,
      opensAt: true,
      closesAt: true,
      questions: { orderBy: { orderIndex: 'asc' }, select: questionSelect },
      _count: { select: { responses: true } },
    },
  });
  if (!survey?.offeringId) throw new NotFoundError('Survey');
  return survey as typeof survey & { offeringId: string };
}

const shape = (questions: { id: string; prompt: string; type: string; options: string[]; isRequired: boolean }[]) =>
  questions.map((question) => ({ ...question, type: question.type as SurveyQuestionShape['type'] }));

export async function createSurvey(
  principal: Principal,
  offeringId: string,
  input: { title: string; description?: string; isAnonymous: boolean; closesAt?: Date | null },
) {
  const offering = await assertCanEditOffering(principal, offeringId);
  const survey = await prisma.survey.create({
    data: {
      institutionId: offering.institutionId,
      offeringId,
      title: input.title,
      description: input.description || null,
      isAnonymous: input.isAnonymous,
      closesAt: input.closesAt ?? null,
      createdById: principal.userId,
    },
    select: { id: true },
  });
  await recordAudit(principal, {
    action: 'survey.created',
    entityType: 'Survey',
    entityId: survey.id,
    institutionId: offering.institutionId,
    after: { title: input.title, isAnonymous: input.isAnonymous },
  });
  return survey;
}

export async function addSurveyQuestion(
  principal: Principal,
  surveyId: string,
  input: { prompt: string; type: SurveyQuestionShape['type']; options: string[]; isRequired: boolean },
) {
  const survey = await surveyWithOffering(surveyId);
  await assertCanEditOffering(principal, survey.offeringId);
  if (survey._count.responses > 0) {
    throw new AppError('People have already answered; add questions to a new survey instead.', 409, 'survey_answered');
  }
  if (input.type === 'CHOICE' && input.options.length < 2) {
    throw new AppError('Give at least two options, one per line.', 422, 'survey_options');
  }
  return prisma.surveyQuestion.create({
    data: {
      surveyId,
      prompt: input.prompt,
      type: input.type,
      options: input.type === 'CHOICE' ? input.options : [],
      isRequired: input.isRequired,
      orderIndex: survey.questions.length,
    },
    select: { id: true },
  });
}

export async function removeSurveyQuestion(principal: Principal, questionId: string) {
  const question = await prisma.surveyQuestion.findUnique({ where: { id: questionId }, select: { surveyId: true } });
  if (!question) throw new NotFoundError('Question');
  const survey = await surveyWithOffering(question.surveyId);
  await assertCanEditOffering(principal, survey.offeringId);
  if (survey._count.responses > 0) throw new AppError('People have already answered this survey.', 409, 'survey_answered');
  await prisma.surveyQuestion.delete({ where: { id: questionId } });
}

export async function setSurveyStatus(principal: Principal, surveyId: string, status: 'OPEN' | 'CLOSED') {
  const survey = await surveyWithOffering(surveyId);
  const offering = await assertCanEditOffering(principal, survey.offeringId);
  if (status === 'OPEN' && survey.questions.length === 0) {
    throw new AppError('Add at least one question before opening the survey.', 422, 'survey_empty');
  }
  await prisma.survey.update({ where: { id: surveyId }, data: { status } });
  await recordAudit(principal, {
    action: status === 'OPEN' ? 'survey.opened' : 'survey.closed',
    entityType: 'Survey',
    entityId: surveyId,
    institutionId: offering.institutionId,
  });
}

/** The surveys of a delivery: every one for staff, the open ones for learners with whether they have answered. */
export async function listSurveys(principal: Principal, offeringId: string) {
  const { viewer } = await assertCanViewOffering(principal, offeringId);
  const surveys = await prisma.survey.findMany({
    where: { offeringId, ...(viewer === 'learner' ? { status: { in: ['OPEN', 'CLOSED'] } } : {}) },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      title: true,
      status: true,
      isAnonymous: true,
      opensAt: true,
      closesAt: true,
      _count: { select: { responses: true, questions: true } },
    },
  });
  const answered = new Set(
    viewer === 'learner'
      ? (
          await prisma.surveyResponse.findMany({
            where: {
              surveyId: { in: surveys.map((survey) => survey.id) },
              respondentKey: { in: surveys.map((survey) => respondentKey(env.AUTH_SECRET, survey.id, principal.userId)) },
            },
            select: { surveyId: true },
          })
        ).map((row) => row.surveyId)
      : [],
  );
  return {
    viewer,
    surveys: surveys.map((survey) => ({ ...survey, open: surveyIsOpen(survey), answered: answered.has(survey.id) })),
  };
}

/** One survey: its questions, whether this person may still answer, and (for staff) the results. */
export async function loadSurvey(principal: Principal, surveyId: string) {
  const survey = await surveyWithOffering(surveyId);
  const { viewer } = await assertCanViewOffering(principal, survey.offeringId);
  if (viewer === 'learner' && survey.status === 'DRAFT') throw new NotFoundError('Survey');

  const key = respondentKey(env.AUTH_SECRET, surveyId, principal.userId);
  const answered = Boolean(
    await prisma.surveyResponse.findUnique({ where: { surveyId_respondentKey: { surveyId, respondentKey: key } }, select: { id: true } }),
  );

  let results = null;
  if (viewer === 'staff') {
    const responses = await prisma.surveyResponse.findMany({ where: { surveyId }, select: { answers: true } });
    results = aggregateSurvey(
      shape(survey.questions),
      responses.map((row) => row.answers as Record<string, SurveyAnswer>),
      { anonymous: survey.isAnonymous, seed: surveyId },
    );
  }

  return { survey, viewer, answered, open: surveyIsOpen(survey), results };
}

export async function submitSurveyResponse(principal: Principal, surveyId: string, raw: Record<string, string | undefined>) {
  const survey = await surveyWithOffering(surveyId);
  const { viewer } = await assertCanViewOffering(principal, survey.offeringId);
  if (viewer !== 'learner') throw new AppError('Surveys are answered by the learners on the course.', 403, 'forbidden');
  if (!surveyIsOpen(survey)) throw new AppError('This survey is not taking responses.', 409, 'survey_closed');

  const { answers, problems } = validateSurveyAnswers(shape(survey.questions), raw);
  if (Object.keys(problems).length) return { ok: false as const, problems };

  try {
    await prisma.surveyResponse.create({
      data: {
        surveyId,
        respondentKey: respondentKey(env.AUTH_SECRET, surveyId, principal.userId),
        // Named only on a survey that says it is not anonymous.
        respondentId: survey.isAnonymous ? null : principal.userId,
        answers: answers as never,
      },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new AppError('You have already answered this survey.', 409, 'survey_answered');
    }
    throw error;
  }
  // Deliberately no audit row naming the respondent of an anonymous survey.
  return { ok: true as const, problems: {} };
}
