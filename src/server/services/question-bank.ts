import 'server-only';
import { prisma } from '@/lib/db';
import { AppError, NotFoundError } from '@/lib/errors';
import { recordAudit } from '@/lib/audit';
import { requirePermission, requireSameInstitution, type Principal } from '@/lib/rbac/authorize';
import { needsManualMarking, type QuestionType } from './quiz-engine';

export interface QuestionInput {
  type: QuestionType;
  prompt: string;
  explanation?: string;
  defaultMark: number;
  difficulty: 'EASY' | 'MODERATE' | 'CHALLENGING';
  bloomLevel?: string | null;
  topic?: string | null;
  tags?: string[];
  courseOutcomeId?: string | null;
  settings?: Record<string, unknown>;
  options: {
    content: string;
    isCorrect?: boolean;
    feedback?: string;
    matchKey?: string;
  }[];
}

/**
 * A question that cannot be answered correctly is worse than no question: it
 * marks every learner down and nobody notices until an appeal. The shape of
 * each type is therefore checked before it is saved rather than at marking time.
 */
export function validateQuestion(input: QuestionInput): string[] {
  const problems: string[] = [];
  const correct = input.options.filter((option) => option.isCorrect);

  switch (input.type) {
    case 'MULTIPLE_CHOICE':
      if (input.options.length < 2) problems.push('Give at least two options.');
      if (correct.length !== 1) problems.push('Mark exactly one option as correct.');
      break;
    case 'MULTIPLE_RESPONSE':
      if (input.options.length < 3) problems.push('Give at least three options.');
      if (correct.length < 1) problems.push('Mark at least one option as correct.');
      if (correct.length === input.options.length) problems.push('Not every option can be correct.');
      break;
    case 'TRUE_FALSE':
      if (input.options.length !== 2) problems.push('True or false questions have exactly two options.');
      if (correct.length !== 1) problems.push('Mark one option as correct.');
      break;
    case 'SHORT_ANSWER':
      if (correct.length === 0 && !(input.settings?.acceptedAnswers as string[])?.length) {
        problems.push('List at least one accepted answer.');
      }
      break;
    case 'NUMERICAL': {
      if (correct.length !== 1) problems.push('Give exactly one correct value.');
      const value = Number(correct[0]?.content);
      if (correct.length === 1 && !Number.isFinite(value)) problems.push('The correct value must be a number.');
      break;
    }
    case 'MATCHING':
      if (input.options.length < 2) problems.push('Give at least two pairs.');
      if (input.options.some((option) => !option.matchKey)) problems.push('Every item needs its match.');
      break;
    case 'ORDERING':
      if (input.options.length < 3) problems.push('Give at least three items to order.');
      break;
    case 'FILL_BLANK':
      if (input.options.length === 0) problems.push('Add the blanks and what fills them.');
      if (input.options.some((option) => !option.matchKey)) problems.push('Every blank needs a name.');
      break;
    default:
      break;
  }

  if (input.defaultMark <= 0) problems.push('The mark must be greater than zero.');
  if (!input.prompt.trim()) problems.push('Write the question.');
  return problems;
}

export async function createBank(principal: Principal, input: { name: string; courseId?: string; description?: string }) {
  requirePermission(principal, 'question_bank.manage');
  const institutionId = principal.institutionId;
  if (!institutionId) throw new NotFoundError('Institution');

  return prisma.questionBank.create({
    data: {
      institutionId,
      name: input.name.trim(),
      description: input.description || null,
      courseId: input.courseId || null,
      createdById: principal.userId,
    },
  });
}

export async function addQuestion(principal: Principal, bankId: string, input: QuestionInput) {
  requirePermission(principal, 'question_bank.manage');

  const bank = await prisma.questionBank.findUnique({
    where: { id: bankId },
    select: { id: true, institutionId: true, name: true },
  });
  if (!bank) throw new NotFoundError('Question bank');
  requireSameInstitution(principal, bank.institutionId);

  const problems = validateQuestion(input);
  if (problems.length > 0) {
    throw new AppError(problems[0]!, 422, 'invalid_question', { problems });
  }

  const question = await prisma.question.create({
    data: {
      institutionId: bank.institutionId,
      bankId,
      type: input.type as never,
      prompt: { text: input.prompt, settings: input.settings ?? {} } as never,
      explanation: input.explanation || null,
      defaultMark: input.defaultMark,
      difficulty: input.difficulty as never,
      bloomLevel: (input.bloomLevel || null) as never,
      topic: input.topic || null,
      tags: (input.tags ?? []).map((tag) => tag.trim().toLowerCase()).filter(Boolean),
      courseOutcomeId: input.courseOutcomeId || null,
      createdById: principal.userId,
      options: {
        create: input.options.map((option, index) => ({
          content: option.content,
          isCorrect: option.isCorrect ?? false,
          feedback: option.feedback || null,
          matchKey: option.matchKey || null,
          orderIndex: index,
        })),
      },
    },
  });

  await recordAudit(principal, {
    action: 'question.created',
    entityType: 'Question',
    entityId: question.id,
    institutionId: bank.institutionId,
    after: { bank: bank.name, type: input.type, needsManualMarking: needsManualMarking(input.type) },
  });

  return question;
}

export async function listBanks(principal: Principal) {
  requirePermission(principal, 'question_bank.read');

  return prisma.questionBank.findMany({
    where: { institutionId: principal.institutionId ?? undefined },
    orderBy: { name: 'asc' },
    select: {
      id: true,
      name: true,
      description: true,
      course: { select: { code: true, title: true } },
      _count: { select: { questions: true } },
    },
  });
}

export async function loadBank(principal: Principal, bankId: string) {
  requirePermission(principal, 'question_bank.read');

  const bank = await prisma.questionBank.findUnique({
    where: { id: bankId },
    select: {
      id: true,
      institutionId: true,
      name: true,
      description: true,
      course: { select: { id: true, code: true, title: true } },
      questions: {
        where: { isActive: true },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true, type: true, prompt: true, defaultMark: true, difficulty: true,
          bloomLevel: true, topic: true, tags: true,
          _count: { select: { options: true, usedIn: true } },
        },
      },
    },
  });
  if (!bank) throw new NotFoundError('Question bank');
  requireSameInstitution(principal, bank.institutionId);
  return bank;
}

/** Attaches a bank question to an assessment at a given mark. */
export async function attachQuestion(
  principal: Principal,
  assessmentId: string,
  questionId: string,
  mark?: number,
) {
  const assessment = await prisma.assessment.findUnique({
    where: { id: assessmentId },
    select: { id: true, institutionId: true, offeringId: true, status: true },
  });
  if (!assessment) throw new NotFoundError('Assessment');
  requireSameInstitution(principal, assessment.institutionId);
  requirePermission(principal, 'assessment.manage', {
    institutionId: assessment.institutionId,
    courseOfferingId: assessment.offeringId,
  });

  const submitted = await prisma.submission.count({
    where: { assessmentId, status: { notIn: ['NOT_STARTED', 'VOID'] } },
  });
  if (submitted > 0) {
    throw new AppError(
      'Learners have already sat this assessment, so its questions are fixed.',
      409,
      'assessment_in_use',
    );
  }

  const question = await prisma.question.findUnique({
    where: { id: questionId },
    select: { id: true, institutionId: true, defaultMark: true },
  });
  if (!question) throw new NotFoundError('Question');
  requireSameInstitution(principal, question.institutionId);

  const last = await prisma.assessmentQuestion.findFirst({
    where: { assessmentId },
    orderBy: { orderIndex: 'desc' },
    select: { orderIndex: true },
  });

  return prisma.assessmentQuestion.create({
    data: {
      assessmentId,
      questionId,
      mark: mark ?? Number(question.defaultMark),
      orderIndex: (last?.orderIndex ?? -1) + 1,
    },
  });
}

/** A pool draws N questions per attempt, so no two papers are identical. */
export async function addPool(
  principal: Principal,
  assessmentId: string,
  input: { bankId: string; name: string; drawCount: number; markPerQuestion: number; difficulty?: string; topic?: string },
) {
  const assessment = await prisma.assessment.findUnique({
    where: { id: assessmentId },
    select: { id: true, institutionId: true, offeringId: true },
  });
  if (!assessment) throw new NotFoundError('Assessment');
  requireSameInstitution(principal, assessment.institutionId);
  requirePermission(principal, 'assessment.manage', {
    institutionId: assessment.institutionId,
    courseOfferingId: assessment.offeringId,
  });

  const available = await prisma.question.count({
    where: {
      bankId: input.bankId,
      isActive: true,
      ...(input.difficulty ? { difficulty: input.difficulty as never } : {}),
      ...(input.topic ? { topic: input.topic } : {}),
    },
  });

  if (available < input.drawCount) {
    throw new AppError(
      `The bank has ${available} matching questions but the pool draws ${input.drawCount}.`,
      422,
      'pool_too_large',
    );
  }

  return prisma.questionPool.create({
    data: {
      assessmentId,
      bankId: input.bankId,
      name: input.name,
      drawCount: input.drawCount,
      markPerQuestion: input.markPerQuestion,
      difficulty: (input.difficulty || null) as never,
      topic: input.topic || null,
    },
  });
}
