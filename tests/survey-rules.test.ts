import { describe, expect, it } from 'vitest';
import {
  MINIMUM_RESPONSES_FOR_RESULTS,
  aggregateSurvey,
  respondentKey,
  surveyIsOpen,
  validateSurveyAnswers,
  type SurveyAnswer,
  type SurveyQuestionShape,
} from '@/server/services/survey-rules';

const QUESTIONS: SurveyQuestionShape[] = [
  { id: 'q1', prompt: 'The lectures helped', type: 'RATING', options: [], isRequired: true },
  { id: 'q2', prompt: 'Pace', type: 'CHOICE', options: ['Too slow', 'About right', 'Too fast'], isRequired: true },
  { id: 'q3', prompt: 'Anything else?', type: 'TEXT', options: [], isRequired: false },
];

describe('respondentKey', () => {
  it('is stable for one person and survey, and differs across surveys and people', () => {
    const key = respondentKey('secret', 's1', 'u1');
    expect(respondentKey('secret', 's1', 'u1')).toBe(key);
    expect(respondentKey('secret', 's2', 'u1')).not.toBe(key);
    expect(respondentKey('secret', 's1', 'u2')).not.toBe(key);
    expect(key).not.toContain('u1');
  });
});

describe('validateSurveyAnswers', () => {
  it('accepts a complete response and trims comments to size', () => {
    const { answers, problems } = validateSurveyAnswers(QUESTIONS, { q1: '4', q2: 'About right', q3: 'x'.repeat(5000) });
    expect(problems).toEqual({});
    expect(answers.q1).toBe(4);
    expect(answers.q2).toBe('About right');
    expect(String(answers.q3)).toHaveLength(2000);
  });

  it('flags missing required answers and values off the scale or the list', () => {
    expect(validateSurveyAnswers(QUESTIONS, {}).problems).toEqual({ q1: expect.any(String), q2: expect.any(String) });
    expect(validateSurveyAnswers(QUESTIONS, { q1: '9', q2: 'Whatever' }).problems).toEqual({ q1: expect.any(String), q2: expect.any(String) });
  });

  it('ignores answers to questions that are not on the survey', () => {
    expect(validateSurveyAnswers(QUESTIONS, { q1: '3', q2: 'Too fast', injected: 'x' }).answers).toEqual({ q1: 3, q2: 'Too fast' });
  });
});

describe('aggregateSurvey', () => {
  const responses: Record<string, SurveyAnswer>[] = [
    { q1: 5, q2: 'About right', q3: 'first' },
    { q1: 4, q2: 'Too fast', q3: 'second' },
    { q1: 4, q2: 'About right' },
    { q1: 2, q2: 'About right', q3: 'fourth' },
    { q1: 5, q2: 'Too slow', q3: 'fifth' },
  ];

  it('shows nothing from an anonymous survey below the threshold', () => {
    const results = aggregateSurvey(QUESTIONS, responses.slice(0, MINIMUM_RESPONSES_FOR_RESULTS - 1), { anonymous: true, seed: 's' });
    expect(results.shown).toBe(false);
    expect(results.questions).toEqual([]);
  });

  it('adds responses up once there are enough', () => {
    const results = aggregateSurvey(QUESTIONS, responses, { anonymous: true, seed: 's' });
    expect(results.shown).toBe(true);
    const rating = results.questions[0]!;
    expect(rating).toMatchObject({ type: 'RATING', answered: 5, mean: 4, distribution: { 1: 0, 2: 1, 3: 0, 4: 2, 5: 2 } });
    expect(results.questions[1]).toMatchObject({ type: 'CHOICE', counts: { 'Too slow': 1, 'About right': 3, 'Too fast': 1 } });
    const comments = results.questions[2]!;
    expect(comments.type === 'TEXT' && [...comments.comments].sort()).toEqual(['fifth', 'first', 'fourth', 'second']);
  });

  it('does not list anonymous comments in the order they were given', () => {
    const many = Array.from({ length: 12 }, (_, index) => ({ q1: 3, q2: 'About right', q3: `comment ${index}` }));
    const results = aggregateSurvey(QUESTIONS, many, { anonymous: true, seed: 'survey-1' });
    const comments = results.questions[2]!;
    expect(comments.type === 'TEXT' && comments.comments).not.toEqual(many.map((row) => row.q3));
  });

  it('shows a named survey whatever its size, in order', () => {
    const results = aggregateSurvey(QUESTIONS, responses.slice(0, 2), { anonymous: false, seed: 's' });
    expect(results.shown).toBe(true);
  });
});

describe('surveyIsOpen', () => {
  const at = new Date('2026-09-26T10:00:00Z');
  it('is open only while open and inside its window', () => {
    expect(surveyIsOpen({ status: 'OPEN', opensAt: null, closesAt: null }, at)).toBe(true);
    expect(surveyIsOpen({ status: 'DRAFT', opensAt: null, closesAt: null }, at)).toBe(false);
    expect(surveyIsOpen({ status: 'OPEN', opensAt: null, closesAt: new Date('2026-09-26T09:00:00Z') }, at)).toBe(false);
    expect(surveyIsOpen({ status: 'OPEN', opensAt: new Date('2026-09-27T00:00:00Z'), closesAt: null }, at)).toBe(false);
  });
});
