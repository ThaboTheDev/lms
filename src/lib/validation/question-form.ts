import { parseOptionLines } from './assessment';

/** Question types whose answers are typed as option lines. */
export const OPTION_LINE_TYPES = ['MULTIPLE_CHOICE', 'MULTIPLE_RESPONSE', 'MATCHING', 'ORDERING', 'FILL_BLANK'];

export interface QuestionFormFields {
  options?: string | null;
  correctValue?: string | null;
  trueFalseAnswer?: string | null;
  acceptedAnswers?: string | null;
  tolerance?: number | null;
}

export interface QuestionOptionInput {
  content: string;
  isCorrect: boolean;
  matchKey?: string;
}

/**
 * The options a question is saved with, read only from the fields its type
 * uses. Until the scripts arrive (or when they never do) the form shows every
 * field at once, so text left in a field that belongs to another type must
 * not leak into this one.
 */
export function optionsForType(type: string, fields: QuestionFormFields): QuestionOptionInput[] {
  if (OPTION_LINE_TYPES.includes(type)) {
    return fields.options ? parseOptionLines(fields.options) : [];
  }

  if (type === 'TRUE_FALSE') {
    const answer = (fields.trueFalseAnswer ?? '').trim().toLowerCase();
    if (answer !== 'true' && answer !== 'false') return [];
    return [
      { content: 'true', isCorrect: answer === 'true' },
      { content: 'false', isCorrect: answer === 'false' },
    ];
  }

  if (type === 'NUMERICAL') {
    // Its own field; a page rendered before that field existed sent it as options.
    const raw = fields.correctValue?.trim() || fields.options?.trim() || '';
    const first = raw.split('\n').map((line) => line.trim()).find(Boolean);
    if (!first) return [];
    const value = (first.endsWith('*') ? first.slice(0, -1).trim() : first).replace(/\s/g, '');
    // A decimal comma, as learners may answer with too.
    return [{ content: /^-?\d+,\d+$/.test(value) ? value.replace(',', '.') : value, isCorrect: true }];
  }

  return [];
}

/** Settings that belong to the type: a tolerance only for numbers, accepted answers only for short answers. */
export function settingsForType(type: string, fields: QuestionFormFields): Record<string, unknown> {
  if (type === 'NUMERICAL' && fields.tolerance !== undefined && fields.tolerance !== null) {
    return { tolerance: fields.tolerance };
  }
  if (type === 'SHORT_ANSWER' && fields.acceptedAnswers) {
    return {
      acceptedAnswers: fields.acceptedAnswers
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean),
    };
  }
  return {};
}
