/**
 * The two edges of a quiz attempt, kept pure so the tests can hold them to
 * account:
 *
 * - `learnerQuestion` decides what a learner's browser is sent. Anything that
 *   scores an answer (the right option, the text of a blank, a matching pair,
 *   the correct order, a numerical value) stays on the server: whatever is in
 *   the page can be read by the person sitting the quiz.
 *
 * - `answersFromForm` reads the answers back from ordinary form fields. The
 *   form works as a plain HTML form, so an attempt submitted before the
 *   scripts load, or with scripts off, carries its answers rather than
 *   arriving blank and being marked as zero.
 */
import { seededShuffle, type Answer } from './quiz-engine';

export interface SourceOption {
  id: string;
  content: string;
  matchKey: string | null;
  orderIndex: number;
}

export interface SourceQuestion {
  id: string;
  type: string;
  prompt: unknown;
  options: SourceOption[];
}

export interface LearnerQuestion {
  id: string;
  type: string;
  text: string;
  /** What to choose from, or the items to match or order. Never how they score. */
  options: { id: string; label: string }[];
  /** Fill in the blank: the names of the blanks, not what fills them. */
  blanks: string[];
  /** Matching: the right-hand column, sorted then shuffled so its order says nothing. */
  matches: string[];
}

function promptText(prompt: unknown): string {
  return ((prompt ?? {}) as { text?: string }).text ?? '';
}

function trueFalseLabel(content: string): string {
  const value = content.trim().toLowerCase();
  if (value === 'true') return 'True';
  if (value === 'false') return 'False';
  return content;
}

/** The learner's view of one question on their paper. `seed` is the attempt, so a reload shows the same order. */
export function learnerQuestion(question: SourceQuestion, seed: string): LearnerQuestion {
  const base: LearnerQuestion = {
    id: question.id,
    type: question.type,
    text: promptText(question.prompt),
    options: [],
    blanks: [],
    matches: [],
  };
  const authored = [...question.options].sort((a, b) => a.orderIndex - b.orderIndex);

  switch (question.type) {
    case 'MULTIPLE_CHOICE':
    case 'MULTIPLE_RESPONSE':
      return { ...base, options: authored.map((option) => ({ id: option.id, label: option.content })) };

    case 'TRUE_FALSE':
      return { ...base, options: authored.map((option) => ({ id: option.id, label: trueFalseLabel(option.content) })) };

    case 'MATCHING': {
      // Sorted first: the order the author typed the pairs in would otherwise
      // line the matches up with their items.
      const matches = [...new Set(authored.map((option) => option.matchKey ?? '').filter(Boolean))].sort();
      return {
        ...base,
        options: authored.map((option) => ({ id: option.id, label: option.content })),
        matches: seededShuffle(matches, `${seed}:${question.id}:matches`),
      };
    }

    case 'ORDERING': {
      // Stored in the correct order, so shown shuffled; and never shown in the
      // correct order, which would hand over the answer.
      let shuffled = seededShuffle(authored, `${seed}:${question.id}:order`);
      if (shuffled.length > 1 && shuffled.every((option, index) => option.id === authored[index]!.id)) {
        shuffled = [...shuffled.slice(1), shuffled[0]!];
      }
      return { ...base, options: shuffled.map((option) => ({ id: option.id, label: option.content })) };
    }

    case 'FILL_BLANK':
      return { ...base, blanks: authored.map((option) => option.matchKey ?? '').filter(Boolean) };

    default:
      // Short and long answers, essays, numbers and uploads show only the prompt.
      return base;
  }
}

/** Form field names, shared by the form and the parser. */
export const attemptField = {
  shown: 'shown',
  answer: (questionId: string) => `answer:${questionId}`,
  blank: (questionId: string, blank: string) => `blank:${questionId}:${blank}`,
  match: (questionId: string, optionId: string) => `match:${questionId}:${optionId}`,
  order: (questionId: string, optionId: string) => `order:${questionId}:${optionId}`,
  file: (questionId: string) => `file:${questionId}`,
};

/** Items in the order their chosen positions put them; unplaced items keep their place after the placed ones. */
export function orderFromPositions(entries: { optionId: string; position: string }[]): string[] {
  return entries
    .map((entry, index) => {
      const position = Number(entry.position);
      return { ...entry, index, rank: entry.position.trim() && Number.isFinite(position) ? position : Number.POSITIVE_INFINITY };
    })
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map((entry) => entry.optionId);
}

/**
 * Answers for every question the form showed (each carries a `shown` marker).
 * A shown question with nothing filled in maps to null, so an answer cleared
 * on the page is cleared on the attempt too. Questions the form did not show
 * are left out and keep whatever was saved.
 */
export function answersFromForm(
  entries: Iterable<[string, unknown]>,
  questions: { id: string; type: string }[],
): Record<string, Answer | null> {
  const values = new Map<string, string[]>();
  const order: string[] = [];
  for (const [key, raw] of entries) {
    if (typeof raw !== 'string') continue;
    if (!values.has(key)) {
      values.set(key, []);
      order.push(key);
    }
    values.get(key)!.push(raw);
  }

  const shown = new Set(values.get(attemptField.shown) ?? []);
  const first = (key: string) => values.get(key)?.[0] ?? '';
  const withPrefix = (prefix: string) =>
    order.filter((key) => key.startsWith(prefix)).map((key) => ({ rest: key.slice(prefix.length), value: first(key) }));

  const result: Record<string, Answer | null> = {};

  for (const question of questions) {
    if (!shown.has(question.id)) continue;
    const given = (values.get(attemptField.answer(question.id)) ?? []).filter((value) => value !== '');

    switch (question.type) {
      case 'MULTIPLE_CHOICE':
      case 'TRUE_FALSE': {
        const optionId = given[0];
        result[question.id] = optionId ? { kind: 'choice', optionId } : null;
        break;
      }
      case 'MULTIPLE_RESPONSE': {
        const optionIds = [...new Set(given)];
        result[question.id] = optionIds.length ? { kind: 'choices', optionIds } : null;
        break;
      }
      case 'SHORT_ANSWER':
      case 'LONG_ANSWER':
      case 'ESSAY': {
        const text = given[0] ?? '';
        result[question.id] = text.trim() ? { kind: 'text', value: text } : null;
        break;
      }
      case 'NUMERICAL': {
        // A decimal comma is how most South Africans write a fraction.
        const raw = (given[0] ?? '').trim().replace(/\s/g, '').replace(',', '.');
        const value = Number(raw);
        result[question.id] = raw && Number.isFinite(value) ? { kind: 'number', value } : null;
        break;
      }
      case 'FILL_BLANK': {
        const blanks = withPrefix(`blank:${question.id}:`);
        const filled = Object.fromEntries(blanks.map(({ rest, value }) => [rest, value]));
        result[question.id] = blanks.some(({ value }) => value.trim()) ? { kind: 'blanks', values: filled } : null;
        break;
      }
      case 'MATCHING': {
        const pairs = withPrefix(`match:${question.id}:`)
          .filter(({ value }) => value)
          .map(({ rest, value }) => ({ optionId: rest, matchKey: value }));
        result[question.id] = pairs.length ? { kind: 'pairs', pairs } : null;
        break;
      }
      case 'ORDERING': {
        const positions = withPrefix(`order:${question.id}:`).map(({ rest, value }) => ({ optionId: rest, position: value }));
        result[question.id] = positions.some(({ position }) => position.trim())
          ? { kind: 'order', optionIds: orderFromPositions(positions) }
          : null;
        break;
      }
      case 'FILE_UPLOAD': {
        const fileIds = [...new Set((values.get(attemptField.file(question.id)) ?? []).filter(Boolean))];
        result[question.id] = fileIds.length ? { kind: 'files', fileIds } : null;
        break;
      }
      default:
        break;
    }
  }

  return result;
}
