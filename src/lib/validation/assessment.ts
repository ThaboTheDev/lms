import { z } from 'zod';

const optionalDateTime = z
  .string()
  .trim()
  .optional()
  .or(z.literal(''))
  .transform((value) => (value ? new Date(value) : null))
  .refine((value) => value === null || !Number.isNaN(value.getTime()), 'Use the date picker.');

export const assessmentSchema = z.object({
  offeringId: z.string().min(1),
  title: z.string().trim().min(3, 'Give the assessment a title.').max(160),
  instructions: z.string().trim().max(10_000).optional().or(z.literal('')),
  type: z.enum([
    'ASSIGNMENT', 'QUIZ', 'TEST', 'EXAMINATION', 'PROJECT',
    'RESEARCH', 'PRACTICAL', 'ORAL', 'PORTFOLIO', 'PEER_REVIEW',
  ]),
  category: z.enum(['DIAGNOSTIC', 'FORMATIVE', 'SUMMATIVE']),
  maxMark: z.coerce.number().min(1, 'The maximum mark must be at least 1.').max(1000),
  passMark: z.coerce.number().min(0).max(1000),
  weight: z.coerce.number().min(0, 'Weighting cannot be negative.').max(100),
  opensAt: optionalDateTime,
  dueAt: optionalDateTime,
  closesAt: optionalDateTime,
  timeLimitMinutes: z.coerce.number().int().min(0).max(600).optional(),
  maxAttempts: z.coerce.number().int().min(1).max(10).default(1),
  allowLate: z.coerce.boolean().default(false),
  latePenaltyPct: z.coerce.number().min(0).max(100).optional(),
  shuffleQuestions: z.coerce.boolean().default(false),
  rubricId: z.string().optional().or(z.literal('')),
  gradingSchemeId: z.string().optional().or(z.literal('')),
});

export const questionSchema = z.object({
  bankId: z.string().min(1),
  type: z.enum([
    'MULTIPLE_CHOICE', 'MULTIPLE_RESPONSE', 'TRUE_FALSE', 'SHORT_ANSWER',
    'LONG_ANSWER', 'ESSAY', 'MATCHING', 'ORDERING', 'FILL_BLANK',
    'NUMERICAL', 'FILE_UPLOAD',
  ]),
  prompt: z.string().trim().min(3, 'Write the question.').max(5000),
  explanation: z.string().trim().max(2000).optional().or(z.literal('')),
  defaultMark: z.coerce.number().min(0.5).max(100),
  difficulty: z.enum(['EASY', 'MODERATE', 'CHALLENGING']).default('MODERATE'),
  bloomLevel: z
    .enum(['REMEMBER', 'UNDERSTAND', 'APPLY', 'ANALYSE', 'EVALUATE', 'CREATE'])
    .optional()
    .or(z.literal('')),
  topic: z.string().trim().max(80).optional().or(z.literal('')),
  tags: z.string().trim().max(200).optional().or(z.literal('')),
  /** One option per line; a line ending in * is a correct answer. */
  options: z.string().trim().max(5000).optional().or(z.literal('')),
  acceptedAnswers: z.string().trim().max(1000).optional().or(z.literal('')),
  tolerance: z.coerce.number().min(0).max(1000).optional(),
});

/**
 * Options are authored as plain lines rather than a repeating form: a lecturer
 * writing twenty questions should be typing, not clicking "add option".
 * A trailing asterisk marks a correct answer, and "text = key" gives the match
 * or blank name.
 */
export function parseOptionLines(input: string) {
  return input
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const isCorrect = line.endsWith('*');
      const body = isCorrect ? line.slice(0, -1).trim() : line;
      const [content, matchKey] = body.split('=').map((part) => part.trim());
      return { content: content ?? body, isCorrect, matchKey: matchKey || undefined };
    });
}

export const gradeSchema = z.object({
  submissionId: z.string().min(1),
  manualMark: z.coerce.number().min(0).max(1000).optional(),
  feedback: z.string().trim().max(10_000).optional().or(z.literal('')),
  requestResubmission: z.coerce.boolean().default(false),
});
