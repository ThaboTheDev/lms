/**
 * Surveys: checking a response and adding responses up. Pure, so the rules
 * that protect a respondent's anonymity are tested rather than trusted.
 */
import { createHmac } from 'node:crypto';

export type SurveyQuestionType = 'RATING' | 'CHOICE' | 'TEXT';

export interface SurveyQuestionShape {
  id: string;
  prompt: string;
  type: SurveyQuestionType;
  options: string[];
  isRequired: boolean;
}

export type SurveyAnswer = number | string;

/** Ratings run from 1 (strongly disagree) to 5 (strongly agree). */
export const RATING_SCALE = [1, 2, 3, 4, 5] as const;
export const RATING_LABELS: Record<number, string> = {
  1: 'Strongly disagree',
  2: 'Disagree',
  3: 'Neutral',
  4: 'Agree',
  5: 'Strongly agree',
};

/** Below this many responses an anonymous survey shows no results: five answers can name one person. */
export const MINIMUM_RESPONSES_FOR_RESULTS = 5;

const MAX_TEXT = 2000;

/**
 * One response per person, without recording who on an anonymous survey: a
 * keyed hash of survey and person. It cannot be reversed without the server's
 * secret, and it differs between surveys, so responses cannot be linked across
 * surveys either.
 */
export function respondentKey(secret: string, surveyId: string, userId: string): string {
  return createHmac('sha256', secret).update(`survey:${surveyId}:${userId}`).digest('hex');
}

/** The answers a form posted, checked against the questions. Unknown questions are ignored. */
export function validateSurveyAnswers(
  questions: SurveyQuestionShape[],
  raw: Record<string, string | undefined>,
): { answers: Record<string, SurveyAnswer>; problems: Record<string, string> } {
  const answers: Record<string, SurveyAnswer> = {};
  const problems: Record<string, string> = {};

  for (const question of questions) {
    const value = (raw[question.id] ?? '').trim();
    if (!value) {
      if (question.isRequired) problems[question.id] = 'Please answer this question.';
      continue;
    }
    if (question.type === 'RATING') {
      const rating = Number(value);
      if (!RATING_SCALE.includes(rating as 1)) problems[question.id] = 'Choose a point on the scale.';
      else answers[question.id] = rating;
    } else if (question.type === 'CHOICE') {
      if (!question.options.includes(value)) problems[question.id] = 'Choose one of the options.';
      else answers[question.id] = value;
    } else {
      answers[question.id] = value.slice(0, MAX_TEXT);
    }
  }
  return { answers, problems };
}

export type QuestionResult =
  | { questionId: string; type: 'RATING'; answered: number; mean: number | null; distribution: Record<number, number> }
  | { questionId: string; type: 'CHOICE'; answered: number; counts: Record<string, number> }
  | { questionId: string; type: 'TEXT'; answered: number; comments: string[] };

export interface SurveyResults {
  responses: number;
  /** False when an anonymous survey has too few responses to show anything safely. */
  shown: boolean;
  questions: QuestionResult[];
}

/** Adds responses up. Comments are shuffled out of submission order, so their order says nothing about who wrote them. */
export function aggregateSurvey(
  questions: SurveyQuestionShape[],
  responses: Record<string, SurveyAnswer>[],
  { anonymous, seed }: { anonymous: boolean; seed: string },
): SurveyResults {
  const shown = !anonymous || responses.length >= MINIMUM_RESPONSES_FOR_RESULTS;
  if (!shown) return { responses: responses.length, shown, questions: [] };

  const results = questions.map((question): QuestionResult => {
    const given = responses.map((response) => response[question.id]).filter((value) => value !== undefined && value !== '');
    if (question.type === 'RATING') {
      const ratings = given.map(Number).filter((value) => RATING_SCALE.includes(value as 1));
      const distribution = Object.fromEntries(RATING_SCALE.map((point) => [point, ratings.filter((value) => value === point).length]));
      const mean = ratings.length ? Math.round((ratings.reduce((sum, value) => sum + value, 0) / ratings.length) * 100) / 100 : null;
      return { questionId: question.id, type: 'RATING', answered: ratings.length, mean, distribution };
    }
    if (question.type === 'CHOICE') {
      const counts = Object.fromEntries(question.options.map((option) => [option, given.filter((value) => value === option).length]));
      return { questionId: question.id, type: 'CHOICE', answered: given.length, counts };
    }
    const comments = given.map(String);
    return { questionId: question.id, type: 'TEXT', answered: comments.length, comments: anonymous ? shuffled(comments, `${seed}:${question.id}`) : comments };
  });

  return { responses: responses.length, shown, questions: results };
}

function shuffled<T>(items: T[], seed: string): T[] {
  const out = [...items];
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i += 1) hash = Math.imul(hash ^ seed.charCodeAt(i), 16777619);
  for (let i = out.length - 1; i > 0; i -= 1) {
    hash = (Math.imul(hash, 1103515245) + 12345) & 0x7fffffff;
    const j = hash % (i + 1);
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/** Whether a survey takes responses now. */
export function surveyIsOpen(
  survey: { status: string; opensAt: Date | null; closesAt: Date | null },
  at = new Date(),
): boolean {
  if (survey.status !== 'OPEN') return false;
  if (survey.opensAt && at < survey.opensAt) return false;
  if (survey.closesAt && at > survey.closesAt) return false;
  return true;
}
