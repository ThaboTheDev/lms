import { describe, expect, it } from 'vitest';
import {
  drawFromPools,
  markAttempt,
  markQuestion,
  needsManualMarking,
  seededShuffle,
  type Answer,
  type MarkableQuestion,
} from '@/server/services/quiz-engine';

const option = (id: string, content: string, isCorrect = false, matchKey?: string, orderIndex = 0) => ({
  id,
  content,
  isCorrect,
  matchKey,
  orderIndex,
});

function question(overrides: Partial<MarkableQuestion>): MarkableQuestion {
  return {
    id: 'q1',
    type: 'MULTIPLE_CHOICE',
    mark: 4,
    options: [],
    ...overrides,
  };
}

describe('multiple choice and true or false', () => {
  const mcq = question({
    options: [option('a', 'Planning', true), option('b', 'Painting')],
  });

  it('awards the full mark for the right option', () => {
    expect(markQuestion(mcq, { kind: 'choice', optionId: 'a' }).awardedMark).toBe(4);
  });

  it('awards nothing for the wrong option', () => {
    const result = markQuestion(mcq, { kind: 'choice', optionId: 'b' });
    expect(result.awardedMark).toBe(0);
    expect(result.isCorrect).toBe(false);
  });

  it('treats a missing answer as zero, not as unmarked', () => {
    const result = markQuestion(mcq, undefined);
    expect(result.awardedMark).toBe(0);
    expect(result.needsManualMarking).toBe(false);
  });

  it('marks true or false from a boolean', () => {
    const tf = question({
      type: 'TRUE_FALSE',
      mark: 2,
      options: [option('t', 'true', true), option('f', 'false')],
    });
    expect(markQuestion(tf, { kind: 'boolean', value: true }).awardedMark).toBe(2);
    expect(markQuestion(tf, { kind: 'boolean', value: false }).awardedMark).toBe(0);
  });
});

describe('multiple response partial credit', () => {
  const mrq = question({
    type: 'MULTIPLE_RESPONSE',
    mark: 6,
    options: [
      option('a', 'Planning', true),
      option('b', 'Organising', true),
      option('c', 'Leading', true),
      option('d', 'Painting'),
    ],
  });

  it('gives each correct option its share', () => {
    expect(markQuestion(mrq, { kind: 'choices', optionIds: ['a', 'b'] }).awardedMark).toBe(4);
  });

  it('cancels a correct option with a wrong one', () => {
    expect(markQuestion(mrq, { kind: 'choices', optionIds: ['a', 'd'] }).awardedMark).toBe(0);
  });

  it('docks a mark share for the wrong option when every box is ticked', () => {
    // Three correct at two marks each, one distractor: 6 earned less 2 lost.
    expect(markQuestion(mrq, { kind: 'choices', optionIds: ['a', 'b', 'c', 'd'] }).awardedMark).toBe(4);
  });

  it('leaves a guess across an evenly split question worth nothing', () => {
    const even = question({
      type: 'MULTIPLE_RESPONSE',
      mark: 4,
      options: [
        option('a', 'Right one', true),
        option('b', 'Right two', true),
        option('c', 'Wrong one'),
        option('d', 'Wrong two'),
      ],
    });
    expect(markQuestion(even, { kind: 'choices', optionIds: ['a', 'b', 'c', 'd'] }).awardedMark).toBe(0);
  });

  it('never goes negative', () => {
    expect(markQuestion(mrq, { kind: 'choices', optionIds: ['d'] }).awardedMark).toBe(0);
  });

  it('awards everything for exactly the right set', () => {
    expect(markQuestion(mrq, { kind: 'choices', optionIds: ['a', 'b', 'c'] }).awardedMark).toBe(6);
  });
});

describe('text and numerical answers', () => {
  const short = question({
    type: 'SHORT_ANSWER',
    mark: 3,
    options: [option('a', 'Vereeniging', true)],
    settings: { acceptedAnswers: ['Vereeniging', 'Vereniging'] },
  });

  it('ignores case and stray whitespace', () => {
    expect(markQuestion(short, { kind: 'text', value: '  vereeniging ' }).awardedMark).toBe(3);
  });

  it('accepts any of the listed answers', () => {
    expect(markQuestion(short, { kind: 'text', value: 'Vereniging' }).awardedMark).toBe(3);
  });

  it('rejects something else', () => {
    expect(markQuestion(short, { kind: 'text', value: 'Sasolburg' }).awardedMark).toBe(0);
  });

  it('honours case sensitivity when the question asks for it', () => {
    const cased = question({
      type: 'SHORT_ANSWER',
      mark: 1,
      options: [option('a', 'NaCl', true)],
      settings: { caseSensitive: true },
    });
    expect(markQuestion(cased, { kind: 'text', value: 'nacl' }).awardedMark).toBe(0);
    expect(markQuestion(cased, { kind: 'text', value: 'NaCl' }).awardedMark).toBe(1);
  });

  it('applies a numerical tolerance', () => {
    const numeric = question({
      type: 'NUMERICAL',
      mark: 5,
      options: [option('a', '3.14', true)],
      settings: { tolerance: 0.01 },
    });
    expect(markQuestion(numeric, { kind: 'number', value: 3.145 }).awardedMark).toBe(5);
    expect(markQuestion(numeric, { kind: 'number', value: 3.2 }).awardedMark).toBe(0);
  });
});

describe('matching, ordering and blanks', () => {
  it('gives partial credit for matching', () => {
    const matching = question({
      type: 'MATCHING',
      mark: 4,
      options: [option('a', 'Cape Town', false, 'Western Cape'), option('b', 'Polokwane', false, 'Limpopo')],
    });
    const answer: Answer = {
      kind: 'pairs',
      pairs: [
        { optionId: 'a', matchKey: 'Western Cape' },
        { optionId: 'b', matchKey: 'Gauteng' },
      ],
    };
    expect(markQuestion(matching, answer).awardedMark).toBe(2);
  });

  it('marks ordering all or nothing', () => {
    const ordering = question({
      type: 'ORDERING',
      mark: 5,
      options: [option('a', 'First', false, undefined, 0), option('b', 'Second', false, undefined, 1), option('c', 'Third', false, undefined, 2)],
    });
    expect(markQuestion(ordering, { kind: 'order', optionIds: ['a', 'b', 'c'] }).awardedMark).toBe(5);
    expect(markQuestion(ordering, { kind: 'order', optionIds: ['a', 'c', 'b'] }).awardedMark).toBe(0);
  });

  it('gives a share per blank filled correctly', () => {
    const blanks = question({
      type: 'FILL_BLANK',
      mark: 4,
      options: [option('a', 'planning', false, 'first'), option('b', 'controlling', false, 'last')],
    });
    const answer: Answer = { kind: 'blanks', values: { first: 'Planning', last: 'leading' } };
    expect(markQuestion(blanks, answer).awardedMark).toBe(2);
  });
});

describe('work that needs a person', () => {
  it('leaves essays and uploads unmarked rather than guessing', () => {
    for (const type of ['ESSAY', 'LONG_ANSWER', 'FILE_UPLOAD'] as const) {
      expect(needsManualMarking(type)).toBe(true);
      const result = markQuestion(question({ type, mark: 20 }), { kind: 'text', value: 'An answer' });
      expect(result.awardedMark).toBeNull();
      expect(result.needsManualMarking).toBe(true);
    }
  });

  it('reports what is auto marked and what is still waiting', () => {
    const marking = markAttempt(
      [
        question({ id: 'q1', mark: 4, options: [option('a', 'Right', true), option('b', 'Wrong')] }),
        question({ id: 'q2', type: 'ESSAY', mark: 16, options: [] }),
      ],
      { q1: { kind: 'choice', optionId: 'a' } },
    );

    expect(marking.autoMark).toBe(4);
    expect(marking.autoMarkableTotal).toBe(4);
    expect(marking.manualTotal).toBe(16);
    expect(marking.awaitingManualMarking).toBe(true);
  });
});

describe('papers drawn from pools', () => {
  const candidates = Array.from({ length: 10 }, (_, index) => ({
    id: `q${index}`,
    difficulty: index < 5 ? 'EASY' : 'CHALLENGING',
    topic: index % 2 === 0 ? 'ratios' : 'ledgers',
  }));

  it('gives the same paper for the same attempt and a different one for another', () => {
    const first = seededShuffle(candidates, 'attempt-1').map((c) => c.id);
    const again = seededShuffle(candidates, 'attempt-1').map((c) => c.id);
    const other = seededShuffle(candidates, 'attempt-2').map((c) => c.id);

    expect(first).toEqual(again);
    expect(first).not.toEqual(other);
  });

  it('draws the requested number, filtered by difficulty', () => {
    const drawn = drawFromPools(
      [{ poolId: 'p1', drawCount: 3, markPerQuestion: 2, candidates, difficulty: 'EASY' }],
      'attempt-1',
    );
    expect(drawn).toHaveLength(3);
    expect(drawn.every((item) => item.mark === 2)).toBe(true);
    expect(drawn.every((item) => Number(item.questionId.slice(1)) < 5)).toBe(true);
  });

  it('filters by topic as well', () => {
    const drawn = drawFromPools(
      [{ poolId: 'p1', drawCount: 2, markPerQuestion: 1, candidates, topic: 'ledgers' }],
      'seed',
    );
    expect(drawn).toHaveLength(2);
    expect(drawn.every((item) => Number(item.questionId.slice(1)) % 2 === 1)).toBe(true);
  });
});
