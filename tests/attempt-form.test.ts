import { describe, expect, it } from 'vitest';
import {
  answersFromForm,
  attemptField,
  learnerQuestion,
  orderFromPositions,
  type SourceQuestion,
} from '@/server/services/attempt-form';
import { markAttempt, type MarkableQuestion, type QuestionType } from '@/server/services/quiz-engine';
import { optionsForType, settingsForType } from '@/lib/validation/question-form';

const option = (id: string, content: string, orderIndex: number, extra: { isCorrect?: boolean; matchKey?: string } = {}) => ({
  id,
  content,
  orderIndex,
  isCorrect: extra.isCorrect ?? false,
  matchKey: extra.matchKey ?? null,
});

const PAPER: (SourceQuestion & { mark: number; options: ReturnType<typeof option>[]; settings?: MarkableQuestion['settings'] })[] = [
  {
    id: 'mc', type: 'MULTIPLE_CHOICE', mark: 2, prompt: { text: 'Capital of Gauteng?' },
    options: [option('mc-a', 'Pretoria', 0), option('mc-b', 'Johannesburg', 1, { isCorrect: true })],
  },
  {
    id: 'tf', type: 'TRUE_FALSE', mark: 1, prompt: { text: 'The Vaal flows into the Orange.' },
    options: [option('tf-t', 'true', 0, { isCorrect: true }), option('tf-f', 'false', 1)],
  },
  {
    id: 'mr', type: 'MULTIPLE_RESPONSE', mark: 2, prompt: { text: 'Official languages?' },
    options: [option('mr-a', 'isiZulu', 0, { isCorrect: true }), option('mr-b', 'Sesotho', 1, { isCorrect: true }), option('mr-c', 'Latin', 2)],
  },
  {
    id: 'blank', type: 'FILL_BLANK', mark: 2, prompt: { text: 'The ___ is the currency.' },
    options: [option('b-1', 'rand', 0, { matchKey: 'currency', isCorrect: true }), option('b-2', 'cents', 1, { matchKey: 'subunit', isCorrect: true })],
  },
  {
    id: 'match', type: 'MATCHING', mark: 3, prompt: { text: 'Match the city to its province.' },
    options: [
      option('m-1', 'Durban', 0, { matchKey: 'KwaZulu-Natal' }),
      option('m-2', 'Gqeberha', 1, { matchKey: 'Eastern Cape' }),
      option('m-3', 'Polokwane', 2, { matchKey: 'Limpopo' }),
    ],
  },
  {
    id: 'order', type: 'ORDERING', mark: 2, prompt: { text: 'Order the steps.' },
    options: [option('o-1', 'Register', 0), option('o-2', 'Attend', 1), option('o-3', 'Write the exam', 2)],
  },
  {
    id: 'num', type: 'NUMERICAL', mark: 1, prompt: { text: 'Pi to two places?' },
    options: [option('n-1', '3.14', 0, { isCorrect: true })], settings: { tolerance: 0.001 },
  },
  {
    id: 'short', type: 'SHORT_ANSWER', mark: 1, prompt: { text: 'Largest city?' },
    options: [], settings: { acceptedAnswers: ['Johannesburg', 'Joburg'] },
  },
];

const SEED = 'attempt-123';

describe('learnerQuestion: what the browser is sent', () => {
  const projected = PAPER.map((question) => learnerQuestion(question, SEED));
  const payload = JSON.stringify(projected);

  it('never carries correctness, blank answers, pairs or numerical values', () => {
    expect(payload).not.toContain('isCorrect');
    expect(payload).not.toContain('matchKey');
    expect(payload).not.toContain('rand'); // text that fills a blank
    expect(payload).not.toContain('cents');
    expect(payload).not.toContain('3.14'); // the numerical answer
    expect(payload).not.toContain('Joburg'); // accepted short answers
  });

  it('keeps what is needed to answer', () => {
    const blank = projected.find((q) => q.id === 'blank')!;
    expect(blank.blanks).toEqual(['currency', 'subunit']);
    const tf = projected.find((q) => q.id === 'tf')!;
    expect(tf.options.map((o) => o.label)).toEqual(['True', 'False']);
    const match = projected.find((q) => q.id === 'match')!;
    expect(new Set(match.matches)).toEqual(new Set(['KwaZulu-Natal', 'Eastern Cape', 'Limpopo']));
    expect(match.options.map((o) => o.label)).toEqual(['Durban', 'Gqeberha', 'Polokwane']);
  });

  it('never shows ordering items in the correct order, and shows the same order on reload', () => {
    for (let n = 0; n < 50; n += 1) {
      const shown = learnerQuestion(PAPER[5]!, `seed-${n}`).options.map((o) => o.id);
      expect(shown).not.toEqual(['o-1', 'o-2', 'o-3']);
      expect(new Set(shown)).toEqual(new Set(['o-1', 'o-2', 'o-3']));
    }
    expect(learnerQuestion(PAPER[5]!, SEED)).toEqual(learnerQuestion(PAPER[5]!, SEED));
  });

  it('does not line the matches up with the items in authored order', () => {
    const lined = PAPER[4]!.options.map((o) => o.matchKey);
    const differs = Array.from({ length: 20 }, (_, n) => learnerQuestion(PAPER[4]!, `s${n}`).matches).some(
      (matches) => matches.join('|') !== lined.join('|'),
    );
    expect(differs).toBe(true);
  });
});

describe('answersFromForm: a plain form submission carries the answers', () => {
  const questions = PAPER.map(({ id, type }) => ({ id, type }));
  const shownAll = PAPER.map((q) => [attemptField.shown, q.id] as [string, string]);

  it('reads every question type from ordinary fields', () => {
    const answers = answersFromForm(
      [
        ...shownAll,
        [attemptField.answer('mc'), 'mc-b'],
        [attemptField.answer('tf'), 'tf-t'],
        [attemptField.answer('mr'), 'mr-a'],
        [attemptField.answer('mr'), 'mr-b'],
        [attemptField.answer('mr'), 'mr-b'],
        [attemptField.blank('blank', 'currency'), 'Rand'],
        [attemptField.blank('blank', 'subunit'), 'cents'],
        [attemptField.match('match', 'm-1'), 'KwaZulu-Natal'],
        [attemptField.match('match', 'm-2'), ''],
        [attemptField.order('order', 'o-3'), '3'],
        [attemptField.order('order', 'o-1'), '1'],
        [attemptField.order('order', 'o-2'), '2'],
        [attemptField.answer('num'), '3,14'],
        [attemptField.answer('short'), 'Joburg'],
      ],
      questions,
    );

    expect(answers.mc).toEqual({ kind: 'choice', optionId: 'mc-b' });
    expect(answers.tf).toEqual({ kind: 'choice', optionId: 'tf-t' });
    expect(answers.mr).toEqual({ kind: 'choices', optionIds: ['mr-a', 'mr-b'] });
    expect(answers.blank).toEqual({ kind: 'blanks', values: { currency: 'Rand', subunit: 'cents' } });
    expect(answers.match).toEqual({ kind: 'pairs', pairs: [{ optionId: 'm-1', matchKey: 'KwaZulu-Natal' }] });
    expect(answers.order).toEqual({ kind: 'order', optionIds: ['o-1', 'o-2', 'o-3'] });
    expect(answers.num).toEqual({ kind: 'number', value: 3.14 });
    expect(answers.short).toEqual({ kind: 'text', value: 'Joburg' });
  });

  it('maps a shown but empty question to null, so a cleared answer is cleared', () => {
    const answers = answersFromForm([[attemptField.shown, 'mc'], [attemptField.shown, 'short'], [attemptField.answer('short'), '   ']], questions);
    expect(answers).toEqual({ mc: null, short: null });
  });

  it('leaves out questions the form did not show', () => {
    const answers = answersFromForm([[attemptField.answer('mc'), 'mc-b']], questions);
    expect(answers).toEqual({});
  });

  it('ignores files and anything that is not text', () => {
    const answers = answersFromForm([[attemptField.shown, 'mc'], [attemptField.answer('mc'), { name: 'x' }]], questions);
    expect(answers.mc).toBeNull();
  });

  it('rejects a numerical answer that is not a number rather than scoring NaN', () => {
    const answers = answersFromForm([[attemptField.shown, 'num'], [attemptField.answer('num'), 'about three']], questions);
    expect(answers.num).toBeNull();
  });

  it('collects uploaded files once each', () => {
    const answers = answersFromForm(
      [[attemptField.shown, 'up'], [attemptField.file('up'), 'f1'], [attemptField.file('up'), ''], [attemptField.file('up'), 'f1'], [attemptField.file('up'), 'f2']],
      [{ id: 'up', type: 'FILE_UPLOAD' }],
    );
    expect(answers.up).toEqual({ kind: 'files', fileIds: ['f1', 'f2'] });
  });

  it('round trip: the learner view, filled in correctly as a plain form, earns full marks', () => {
    const views = Object.fromEntries(PAPER.map((q) => [q.id, learnerQuestion(q, SEED)]));
    const correctMatch = Object.fromEntries(PAPER[4]!.options.map((o) => [o.id, o.matchKey!]));
    const fields: [string, string][] = [
      ...shownAll,
      [attemptField.answer('mc'), 'mc-b'],
      [attemptField.answer('tf'), views.tf!.options.find((o) => o.label === 'True')!.id],
      [attemptField.answer('mr'), 'mr-a'],
      [attemptField.answer('mr'), 'mr-b'],
      ...views.blank!.blanks.map((blank) => [attemptField.blank('blank', blank), blank === 'currency' ? 'rand' : 'cents'] as [string, string]),
      ...views.match!.options.map((o) => [attemptField.match('match', o.id), correctMatch[o.id]!] as [string, string]),
      ...views.order!.options.map((o) => [attemptField.order('order', o.id), String(['o-1', 'o-2', 'o-3'].indexOf(o.id) + 1)] as [string, string]),
      [attemptField.answer('num'), '3.14'],
      [attemptField.answer('short'), 'johannesburg'],
    ];

    const parsed = answersFromForm(fields, PAPER.map(({ id, type }) => ({ id, type })));
    const responses = Object.fromEntries(Object.entries(parsed).filter(([, a]) => a)) as Record<string, never>;
    const marking = markAttempt(
      PAPER.map((q) => ({ id: q.id, type: q.type as QuestionType, mark: q.mark, options: q.options, settings: q.settings })),
      responses,
    );

    const total = PAPER.reduce((sum, q) => sum + q.mark, 0);
    expect(marking.autoMark).toBe(total);
  });
});

describe('orderFromPositions', () => {
  it('sorts by position and keeps unplaced items after the placed ones, in their shown order', () => {
    expect(
      orderFromPositions([
        { optionId: 'a', position: '' },
        { optionId: 'b', position: '2' },
        { optionId: 'c', position: '1' },
        { optionId: 'd', position: '' },
      ]),
    ).toEqual(['c', 'b', 'a', 'd']);
  });

  it('keeps shown order between equal positions', () => {
    expect(orderFromPositions([{ optionId: 'a', position: '1' }, { optionId: 'b', position: '1' }])).toEqual(['a', 'b']);
  });
});

describe('question form: options come only from the fields the type uses', () => {
  it('builds true or false from its own field and ignores the options box', () => {
    expect(optionsForType('TRUE_FALSE', { options: 'Yes*\nNo', trueFalseAnswer: 'false' })).toEqual([
      { content: 'true', isCorrect: false },
      { content: 'false', isCorrect: true },
    ]);
  });

  it('reads a numerical value from its own field, with or without the asterisk, and falls back to options', () => {
    expect(optionsForType('NUMERICAL', { correctValue: '3.14' })).toEqual([{ content: '3.14', isCorrect: true }]);
    expect(optionsForType('NUMERICAL', { correctValue: '', options: '2.5*' })).toEqual([{ content: '2.5', isCorrect: true }]);
    expect(optionsForType('NUMERICAL', {})).toEqual([]);
  });

  it('ignores the options box for types that do not use it', () => {
    expect(optionsForType('SHORT_ANSWER', { options: 'stray*' })).toEqual([]);
    expect(optionsForType('ESSAY', { options: 'stray*' })).toEqual([]);
  });

  it('parses option lines for the types that use them', () => {
    expect(optionsForType('MULTIPLE_CHOICE', { options: 'A\nB*' }).map((o) => o.isCorrect)).toEqual([false, true]);
  });

  it('keeps settings to the type they belong to', () => {
    expect(settingsForType('MULTIPLE_CHOICE', { tolerance: 0, acceptedAnswers: 'x' })).toEqual({});
    expect(settingsForType('NUMERICAL', { tolerance: 0.5 })).toEqual({ tolerance: 0.5 });
    expect(settingsForType('SHORT_ANSWER', { acceptedAnswers: 'Joburg\n\n Johannesburg ' })).toEqual({
      acceptedAnswers: ['Joburg', 'Johannesburg'],
    });
  });
});
