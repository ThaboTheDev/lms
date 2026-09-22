/**
 * Proof of payment: the states a submission moves through, and the checks that
 * make a queue of twenty thousand documents reviewable by a handful of people.
 *
 * Pure, so the review screen, the API and the bulk tools cannot disagree about
 * what is allowed.
 */
import type { Cents } from '@/lib/money';

export type PopStatus =
  | 'PENDING' | 'UNDER_REVIEW' | 'APPROVED' | 'REJECTED' | 'DUPLICATE' | 'NEEDS_CLARIFICATION';

export interface PopTransition {
  to: PopStatus;
  /** Approving creates a payment, so it needs a reason only when overriding. */
  requiresNote: boolean;
}

/**
 * Nothing moves out of APPROVED. Reversing an approved payment is a credit
 * note or a refund, both of which leave their own trail, rather than an edit
 * that makes money disappear from the record.
 */
export const POP_TRANSITIONS: Record<PopStatus, PopTransition[]> = {
  PENDING: [
    { to: 'UNDER_REVIEW', requiresNote: false },
    { to: 'APPROVED', requiresNote: false },
    { to: 'REJECTED', requiresNote: true },
    { to: 'DUPLICATE', requiresNote: false },
    { to: 'NEEDS_CLARIFICATION', requiresNote: true },
  ],
  UNDER_REVIEW: [
    { to: 'APPROVED', requiresNote: false },
    { to: 'REJECTED', requiresNote: true },
    { to: 'DUPLICATE', requiresNote: false },
    { to: 'NEEDS_CLARIFICATION', requiresNote: true },
  ],
  NEEDS_CLARIFICATION: [
    { to: 'UNDER_REVIEW', requiresNote: false },
    { to: 'APPROVED', requiresNote: false },
    { to: 'REJECTED', requiresNote: true },
    { to: 'DUPLICATE', requiresNote: false },
  ],
  REJECTED: [{ to: 'UNDER_REVIEW', requiresNote: true }],
  DUPLICATE: [{ to: 'UNDER_REVIEW', requiresNote: true }],
  APPROVED: [],
};

export function allowedPopTransitions(status: PopStatus): PopTransition[] {
  return POP_TRANSITIONS[status];
}

export function findPopTransition(from: PopStatus, to: PopStatus): PopTransition | undefined {
  return POP_TRANSITIONS[from].find((rule) => rule.to === to);
}

export function isPopTerminal(status: PopStatus): boolean {
  return POP_TRANSITIONS[status].length === 0;
}

export const OPEN_POP_STATUSES: PopStatus[] = ['PENDING', 'UNDER_REVIEW', 'NEEDS_CLARIFICATION'];

export interface PopCandidate {
  id: string;
  studentId: string;
  declaredAmount: Cents;
  declaredDate: Date;
  reference: string | null;
  status: PopStatus;
}

export interface DuplicateMatch {
  candidateId: string;
  confidence: 'certain' | 'likely';
  reason: string;
}

/**
 * Duplicate detection. At scale the same proof gets uploaded twice: once by the
 * learner and once by a parent, or twice because the first upload seemed to
 * fail. Matching is a hint for the reviewer, never an automatic rejection, so
 * the output says how confident it is and why.
 */
export function findDuplicates(subject: PopCandidate, others: PopCandidate[]): DuplicateMatch[] {
  const matches: DuplicateMatch[] = [];

  for (const other of others) {
    if (other.id === subject.id) continue;
    if (other.status === 'REJECTED' || other.status === 'DUPLICATE') continue;

    const sameReference =
      Boolean(subject.reference) &&
      normaliseReference(subject.reference!) === normaliseReference(other.reference ?? '');
    const sameAmount = subject.declaredAmount === other.declaredAmount;
    const sameDay = isSameDay(subject.declaredDate, other.declaredDate);
    const sameStudent = subject.studentId === other.studentId;

    if (sameReference && sameAmount) {
      matches.push({
        candidateId: other.id,
        confidence: 'certain',
        reason: 'Same reference and the same amount.',
      });
      continue;
    }

    if (sameStudent && sameAmount && sameDay) {
      matches.push({
        candidateId: other.id,
        confidence: 'likely',
        reason: 'Same learner, amount and date, but a different reference.',
      });
      continue;
    }

    if (sameReference) {
      matches.push({
        candidateId: other.id,
        confidence: 'likely',
        reason: 'Same reference for a different amount.',
      });
    }
  }

  return matches;
}

export function normaliseReference(reference: string): string {
  return reference.replace(/[^0-9a-z]/gi, '').toUpperCase();
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
  );
}

export interface ReviewFlag {
  severity: 'warning' | 'info';
  message: string;
}

/**
 * What the reviewer should look at before approving. These are prompts, not
 * blocks: a learner who pays R50 more than the invoice is still paying, and the
 * reviewer decides what to do with the difference.
 */
export function reviewFlags(
  pop: { declaredAmount: Cents; declaredDate: Date; reference: string | null },
  context: { invoiceBalance: Cents | null; duplicates: DuplicateMatch[]; submittedAt: Date },
): ReviewFlag[] {
  const flags: ReviewFlag[] = [];

  for (const duplicate of context.duplicates) {
    flags.push({
      severity: 'warning',
      message:
        duplicate.confidence === 'certain'
          ? `Almost certainly a duplicate: ${duplicate.reason.toLowerCase()}`
          : `Possible duplicate: ${duplicate.reason.toLowerCase()}`,
    });
  }

  if (!pop.reference) {
    flags.push({ severity: 'warning', message: 'No payment reference was given.' });
  }

  if (context.invoiceBalance !== null) {
    if (pop.declaredAmount > context.invoiceBalance) {
      flags.push({
        severity: 'info',
        message: 'The amount is more than the outstanding balance, so this leaves a credit.',
      });
    } else if (pop.declaredAmount < context.invoiceBalance) {
      flags.push({
        severity: 'info',
        message: 'This is a part payment; a balance will remain on the account.',
      });
    }
  }

  const daysOld = Math.floor(
    (context.submittedAt.getTime() - pop.declaredDate.getTime()) / 86_400_000,
  );
  if (daysOld > 60) {
    flags.push({
      severity: 'warning',
      message: `The payment is dated ${daysOld} days before it was submitted.`,
    });
  }
  if (daysOld < 0) {
    flags.push({ severity: 'warning', message: 'The payment is dated in the future.' });
  }

  return flags;
}

export const POP_STATUS_LABELS: Record<PopStatus, string> = {
  PENDING: 'Pending',
  UNDER_REVIEW: 'Under review',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  DUPLICATE: 'Duplicate',
  NEEDS_CLARIFICATION: 'Needs clarification',
};
