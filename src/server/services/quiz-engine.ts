/**
 * Automatic marking. Pure: the same functions score a live attempt, re-score an
 * attempt after a question is corrected, and run in the tests below, so a
 * marking rule can never differ between those three paths.
 *
 * Anything that needs a human (essays, long answers, uploaded work) is returned
 * as ungraded rather than guessed at.
 */

export type QuestionType =
  | 'MULTIPLE_CHOICE' | 'MULTIPLE_RESPONSE' | 'TRUE_FALSE' | 'SHORT_ANSWER'
  | 'LONG_ANSWER' | 'ESSAY' | 'MATCHING' | 'ORDERING' | 'FILL_BLANK'
  | 'NUMERICAL' | 'FILE_UPLOAD';

export interface QuestionOption {
  id: string;
  content: string;
  isCorrect: boolean;
  /** For matching: the key this option pairs with. For fill blank: the slot. */
  matchKey?: string | null;
  orderIndex: number;
}

export interface MarkableQuestion {
  id: string;
  type: QuestionType;
  mark: number;
  options: QuestionOption[];
  /** Settings carried on the question prompt: tolerance, accepted answers. */
  settings?: {
    tolerance?: number;
    acceptedAnswers?: string[];
    caseSensitive?: boolean;
    negativeMarking?: boolean;
  };
}

export type Answer =
  | { kind: 'choice'; optionId: string }
  | { kind: 'choices'; optionIds: string[] }
  | { kind: 'boolean'; value: boolean }
  | { kind: 'text'; value: string }
  | { kind: 'number'; value: number }
  | { kind: 'pairs'; pairs: { optionId: string; matchKey: string }[] }
  | { kind: 'order'; optionIds: string[] }
  | { kind: 'blanks'; values: Record<string, string> }
  | { kind: 'files'; fileIds: string[] }
  | { kind: 'none' };

export interface QuestionResult {
  questionId: string;
  awardedMark: number | null;
  isCorrect: boolean | null;
  needsManualMarking: boolean;
  note?: string;
}

const MANUAL_TYPES: QuestionType[] = ['LONG_ANSWER', 'ESSAY', 'FILE_UPLOAD'];

export function needsManualMarking(type: QuestionType): boolean {
  return MANUAL_TYPES.includes(type);
}

function normalise(value: string, caseSensitive = false): string {
  const trimmed = value.trim().replace(/\s+/g, ' ');
  return caseSensitive ? trimmed : trimmed.toLowerCase();
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Partial credit for multiple response: each correct option chosen earns its
 * share, each wrong one loses the same share, and the question floors at zero.
 * A blanket tick of every box therefore earns only the difference between the
 * right and wrong choices, and a paper of pure guesses tends to nothing.
 */
function scoreMultipleResponse(question: MarkableQuestion, chosen: string[]): number {
  const correct = question.options.filter((option) => option.isCorrect).map((option) => option.id);
  if (correct.length === 0) return 0;

  const share = question.mark / correct.length;
  const hits = chosen.filter((id) => correct.includes(id)).length;
  const misses = chosen.filter((id) => !correct.includes(id)).length;

  return round(Math.max(0, hits * share - misses * share));
}

function scoreMatching(question: MarkableQuestion, pairs: { optionId: string; matchKey: string }[]): number {
  const expected = new Map(question.options.map((option) => [option.id, option.matchKey ?? '']));
  if (expected.size === 0) return 0;

  const share = question.mark / expected.size;
  const correct = pairs.filter((pair) => expected.get(pair.optionId) === pair.matchKey).length;
  return round(correct * share);
}

/** Ordering is all or nothing: a sequence that is nearly right is still wrong. */
function scoreOrdering(question: MarkableQuestion, submitted: string[]): number {
  const expected = [...question.options]
    .sort((a, b) => a.orderIndex - b.orderIndex)
    .map((option) => option.id);
  const same =
    expected.length === submitted.length && expected.every((id, index) => submitted[index] === id);
  return same ? question.mark : 0;
}

function scoreBlanks(question: MarkableQuestion, values: Record<string, string>): number {
  const slots = question.options.filter((option) => option.matchKey);
  if (slots.length === 0) return 0;

  const caseSensitive = question.settings?.caseSensitive ?? false;
  const share = question.mark / slots.length;

  const correct = slots.filter((slot) => {
    const given = values[slot.matchKey!];
    if (given === undefined) return false;
    return normalise(given, caseSensitive) === normalise(slot.content, caseSensitive);
  }).length;

  return round(correct * share);
}

function scoreShortAnswer(question: MarkableQuestion, given: string): number {
  const caseSensitive = question.settings?.caseSensitive ?? false;
  const accepted = [
    ...(question.settings?.acceptedAnswers ?? []),
    ...question.options.filter((option) => option.isCorrect).map((option) => option.content),
  ];
  const match = accepted.some((answer) => normalise(answer, caseSensitive) === normalise(given, caseSensitive));
  return match ? question.mark : 0;
}

/** Numerical answers are compared within a tolerance, defaulting to exact. */
function scoreNumerical(question: MarkableQuestion, given: number): number {
  const tolerance = question.settings?.tolerance ?? 0;
  const expected = question.options.find((option) => option.isCorrect);
  if (!expected) return 0;

  const target = Number(expected.content);
  if (!Number.isFinite(target) || !Number.isFinite(given)) return 0;

  return Math.abs(given - target) <= tolerance ? question.mark : 0;
}

export function markQuestion(question: MarkableQuestion, answer: Answer | undefined): QuestionResult {
  if (needsManualMarking(question.type)) {
    return { questionId: question.id, awardedMark: null, isCorrect: null, needsManualMarking: true };
  }

  if (!answer || answer.kind === 'none') {
    return { questionId: question.id, awardedMark: 0, isCorrect: false, needsManualMarking: false, note: 'No answer given.' };
  }

  let awarded = 0;

  switch (question.type) {
    case 'MULTIPLE_CHOICE': {
      if (answer.kind !== 'choice') break;
      const option = question.options.find((candidate) => candidate.id === answer.optionId);
      awarded = option?.isCorrect ? question.mark : 0;
      break;
    }
    case 'TRUE_FALSE': {
      if (answer.kind === 'boolean') {
        const correct = question.options.find((option) => option.isCorrect);
        awarded = correct && normalise(correct.content) === String(answer.value) ? question.mark : 0;
      } else if (answer.kind === 'choice') {
        const option = question.options.find((candidate) => candidate.id === answer.optionId);
        awarded = option?.isCorrect ? question.mark : 0;
      }
      break;
    }
    case 'MULTIPLE_RESPONSE':
      if (answer.kind === 'choices') awarded = scoreMultipleResponse(question, answer.optionIds);
      break;
    case 'MATCHING':
      if (answer.kind === 'pairs') awarded = scoreMatching(question, answer.pairs);
      break;
    case 'ORDERING':
      if (answer.kind === 'order') awarded = scoreOrdering(question, answer.optionIds);
      break;
    case 'FILL_BLANK':
      if (answer.kind === 'blanks') awarded = scoreBlanks(question, answer.values);
      break;
    case 'SHORT_ANSWER':
      if (answer.kind === 'text') awarded = scoreShortAnswer(question, answer.value);
      break;
    case 'NUMERICAL':
      if (answer.kind === 'number') awarded = scoreNumerical(question, answer.value);
      break;
    default:
      awarded = 0;
  }

  return {
    questionId: question.id,
    awardedMark: round(awarded),
    isCorrect: awarded >= question.mark,
    needsManualMarking: false,
  };
}

export interface AttemptMarking {
  results: QuestionResult[];
  autoMark: number;
  autoMarkableTotal: number;
  manualTotal: number;
  awaitingManualMarking: boolean;
}

export function markAttempt(
  questions: MarkableQuestion[],
  answers: Record<string, Answer>,
): AttemptMarking {
  const results = questions.map((question) => markQuestion(question, answers[question.id]));

  const autoMark = results.reduce((sum, result) => sum + (result.awardedMark ?? 0), 0);
  const autoMarkableTotal = questions
    .filter((question) => !needsManualMarking(question.type))
    .reduce((sum, question) => sum + question.mark, 0);
  const manualTotal = questions
    .filter((question) => needsManualMarking(question.type))
    .reduce((sum, question) => sum + question.mark, 0);

  return {
    results,
    autoMark: round(autoMark),
    autoMarkableTotal: round(autoMarkableTotal),
    manualTotal: round(manualTotal),
    awaitingManualMarking: results.some((result) => result.needsManualMarking),
  };
}

/* ------------------------------------------------------- question pools -- */

/**
 * Deterministic shuffle. The seed is the attempt id, so a learner who reloads
 * mid-attempt sees the same paper in the same order, while two learners get
 * different papers. A random shuffle on every render would let a learner reroll
 * a pool until they liked the questions.
 */
export function seededShuffle<T>(items: T[], seed: string): T[] {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }

  const shuffled = [...items];
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    hash = (Math.imul(hash, 1103515245) + 12345) & 0x7fffffff;
    const j = hash % (i + 1);
    const swap = shuffled[i]!;
    shuffled[i] = shuffled[j]!;
    shuffled[j] = swap;
  }
  return shuffled;
}

export interface PoolSpec {
  poolId: string;
  drawCount: number;
  markPerQuestion: number;
  candidates: { id: string; difficulty?: string; topic?: string | null }[];
  difficulty?: string | null;
  topic?: string | null;
}

/** Draws each pool's questions for one attempt, filtered then shuffled. */
export function drawFromPools(pools: PoolSpec[], seed: string) {
  return pools.flatMap((pool) => {
    const eligible = pool.candidates.filter(
      (candidate) =>
        (!pool.difficulty || candidate.difficulty === pool.difficulty) &&
        (!pool.topic || candidate.topic === pool.topic),
    );

    return seededShuffle(eligible, `${seed}:${pool.poolId}`)
      .slice(0, pool.drawCount)
      .map((candidate) => ({ questionId: candidate.id, mark: pool.markPerQuestion, poolId: pool.poolId }));
  });
}
