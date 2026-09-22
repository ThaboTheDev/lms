import { describe, expect, it } from 'vitest';
import {
  allowedPopTransitions,
  findDuplicates,
  findPopTransition,
  isPopTerminal,
  normaliseReference,
  reviewFlags,
  type PopCandidate,
} from '@/server/services/pop-workflow';

function candidate(overrides: Partial<PopCandidate> = {}): PopCandidate {
  return {
    id: 'pop1',
    studentId: 'stu1',
    declaredAmount: 2_500_00,
    declaredDate: new Date('2026-03-10T00:00:00Z'),
    reference: 'KIHL 202600001',
    status: 'PENDING',
    ...overrides,
  };
}

describe('review pipeline', () => {
  it('lets a reviewer move a pending document anywhere sensible', () => {
    expect(allowedPopTransitions('PENDING').map((rule) => rule.to)).toContain('APPROVED');
    expect(allowedPopTransitions('PENDING').map((rule) => rule.to)).toContain('NEEDS_CLARIFICATION');
  });

  it('treats an approved payment as final', () => {
    expect(isPopTerminal('APPROVED')).toBe(true);
    expect(findPopTransition('APPROVED', 'REJECTED')).toBeUndefined();
  });

  it('lets a rejection be reopened, with a reason', () => {
    const rule = findPopTransition('REJECTED', 'UNDER_REVIEW');
    expect(rule).toBeDefined();
    expect(rule?.requiresNote).toBe(true);
  });

  it('requires a reason for every negative outcome', () => {
    expect(findPopTransition('PENDING', 'REJECTED')?.requiresNote).toBe(true);
    expect(findPopTransition('PENDING', 'NEEDS_CLARIFICATION')?.requiresNote).toBe(true);
  });
});

describe('duplicate detection', () => {
  it('is certain when the reference and amount both match', () => {
    const matches = findDuplicates(candidate(), [candidate({ id: 'pop2' })]);
    expect(matches[0]).toMatchObject({ candidateId: 'pop2', confidence: 'certain' });
  });

  it('ignores punctuation and case in a reference', () => {
    const matches = findDuplicates(candidate(), [candidate({ id: 'pop2', reference: 'kihl-202600001' })]);
    expect(matches[0]?.confidence).toBe('certain');
  });

  it('flags the same learner, amount and day as likely', () => {
    const matches = findDuplicates(candidate(), [candidate({ id: 'pop2', reference: 'OTHER REF' })]);
    expect(matches[0]).toMatchObject({ confidence: 'likely' });
  });

  it('leaves a different learner paying the same amount alone', () => {
    const matches = findDuplicates(
      candidate(),
      [candidate({ id: 'pop2', studentId: 'stu2', reference: 'OTHER REF' })],
    );
    expect(matches).toHaveLength(0);
  });

  it('does not match against something already rejected', () => {
    const matches = findDuplicates(candidate(), [candidate({ id: 'pop2', status: 'REJECTED' })]);
    expect(matches).toHaveLength(0);
  });

  it('never matches a document against itself', () => {
    expect(findDuplicates(candidate(), [candidate()])).toHaveLength(0);
  });

  it('normalises a reference for comparison', () => {
    expect(normaliseReference('kihl-2026/00001')).toBe('KIHL202600001');
  });
});

describe('what the reviewer is shown', () => {
  const submittedAt = new Date('2026-03-12T00:00:00Z');

  it('warns about a missing reference', () => {
    const flags = reviewFlags(
      { declaredAmount: 100_00, declaredDate: new Date('2026-03-10'), reference: null },
      { invoiceBalance: 100_00, duplicates: [], submittedAt },
    );
    expect(flags.some((flag) => flag.message.includes('reference'))).toBe(true);
  });

  it('explains an over payment and an under payment rather than blocking either', () => {
    const over = reviewFlags(
      { declaredAmount: 200_00, declaredDate: new Date('2026-03-10'), reference: 'REF' },
      { invoiceBalance: 100_00, duplicates: [], submittedAt },
    );
    expect(over.some((flag) => flag.message.includes('credit'))).toBe(true);
    expect(over.every((flag) => flag.severity !== 'warning')).toBe(true);

    const under = reviewFlags(
      { declaredAmount: 50_00, declaredDate: new Date('2026-03-10'), reference: 'REF' },
      { invoiceBalance: 100_00, duplicates: [], submittedAt },
    );
    expect(under.some((flag) => flag.message.includes('part payment'))).toBe(true);
  });

  it('flags a payment dated long before it was submitted', () => {
    const flags = reviewFlags(
      { declaredAmount: 100_00, declaredDate: new Date('2025-11-01'), reference: 'REF' },
      { invoiceBalance: 100_00, duplicates: [], submittedAt },
    );
    expect(flags.some((flag) => flag.message.includes('days before'))).toBe(true);
  });

  it('flags a payment dated in the future', () => {
    const flags = reviewFlags(
      { declaredAmount: 100_00, declaredDate: new Date('2026-04-01'), reference: 'REF' },
      { invoiceBalance: 100_00, duplicates: [], submittedAt },
    );
    expect(flags.some((flag) => flag.message.includes('future'))).toBe(true);
  });

  it('carries a duplicate through as a warning rather than a decision', () => {
    const flags = reviewFlags(
      { declaredAmount: 100_00, declaredDate: new Date('2026-03-10'), reference: 'REF' },
      {
        invoiceBalance: 100_00,
        duplicates: [{ candidateId: 'pop2', confidence: 'certain', reason: 'Same reference and the same amount.' }],
        submittedAt,
      },
    );
    expect(flags[0]!.severity).toBe('warning');
    expect(flags[0]!.message).toContain('duplicate');
  });
});
