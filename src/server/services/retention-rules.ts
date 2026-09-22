/**
 * Retention and erasure under POPIA. What may be deleted, what has to be kept,
 * and what "delete" means for a record an institution is legally required to
 * hold. Pure, so the policy can be read and argued about in one place.
 */

export type RetentionAction = 'DELETE' | 'ANONYMISE' | 'RETAIN';

export interface RetentionRule {
  category: string;
  label: string;
  /** Months after the trigger date, or null where the record is kept. */
  retainMonths: number | null;
  action: RetentionAction;
  basis: string;
}

/**
 * The default policy. Academic records are kept, because an institution has to
 * be able to confirm a qualification decades later, and a learner asking for
 * erasure cannot erase the fact that a degree was awarded. Everything that is
 * not a statutory record has an end date.
 */
export const RETENTION_RULES: RetentionRule[] = [
  {
    category: 'ACADEMIC_RECORD',
    label: 'Results, transcripts and certificates',
    retainMonths: null,
    action: 'RETAIN',
    basis: 'The institution must be able to confirm a qualification for as long as it is relied on.',
  },
  {
    category: 'APPLICATION_UNSUCCESSFUL',
    label: 'Unsuccessful applications',
    retainMonths: 24,
    action: 'DELETE',
    basis: 'No longer needed once the intake has closed and any appeal period has passed.',
  },
  {
    category: 'FINANCIAL',
    label: 'Invoices, payments and receipts',
    retainMonths: 60,
    action: 'RETAIN',
    basis: 'Five years, in line with ordinary tax record keeping.',
  },
  {
    category: 'PROOF_OF_PAYMENT',
    label: 'Proof of payment documents',
    retainMonths: 24,
    action: 'DELETE',
    basis: 'The payment record survives; the bank slip itself does not need to.',
  },
  {
    category: 'SUBMISSION_FILES',
    label: 'Assignment files',
    retainMonths: 36,
    action: 'DELETE',
    basis: 'The mark and the feedback are the record; the uploaded file is the working.',
  },
  {
    category: 'ATTENDANCE',
    label: 'Attendance registers',
    retainMonths: 60,
    action: 'ANONYMISE',
    basis: 'Kept as counts for reporting, without naming who was where.',
  },
  {
    category: 'MESSAGES',
    label: 'Internal messages',
    retainMonths: 36,
    action: 'DELETE',
    basis: 'Correspondence, not a record of the institution.',
  },
  {
    category: 'AUDIT',
    label: 'Audit log',
    retainMonths: 84,
    action: 'RETAIN',
    basis: 'Seven years, so that a decision can still be explained.',
  },
  {
    category: 'SESSIONS',
    label: 'Sign-in sessions and attempts',
    retainMonths: 12,
    action: 'DELETE',
    basis: 'Security telemetry, useful for a year.',
  },
];

export interface RetentionCandidate {
  category: string;
  triggerDate: Date;
}

export interface RetentionDecision {
  category: string;
  label: string;
  action: RetentionAction;
  due: boolean;
  dueOn: Date | null;
  basis: string;
}

export function decideRetention(
  candidate: RetentionCandidate,
  now: Date = new Date(),
): RetentionDecision | null {
  const rule = RETENTION_RULES.find((entry) => entry.category === candidate.category);
  if (!rule) return null;

  if (rule.retainMonths === null) {
    return {
      category: rule.category,
      label: rule.label,
      action: 'RETAIN',
      due: false,
      dueOn: null,
      basis: rule.basis,
    };
  }

  const dueOn = new Date(candidate.triggerDate);
  dueOn.setMonth(dueOn.getMonth() + rule.retainMonths);

  return {
    category: rule.category,
    label: rule.label,
    action: rule.action,
    due: now >= dueOn,
    dueOn,
    basis: rule.basis,
  };
}

export interface ErasureRequest {
  hasAcademicRecord: boolean;
  hasOutstandingBalance: boolean;
  hasActiveEnrolment: boolean;
}

export interface ErasureAssessment {
  canErase: boolean;
  approach: 'DELETE' | 'ANONYMISE' | 'REFUSE';
  keep: string[];
  remove: string[];
  explanation: string;
}

/**
 * What can actually be done when someone asks to be erased. Answering "yes" to
 * everything would be dishonest, and answering "no" to everything would be
 * lazy: most of a person's data can go even when the academic record cannot.
 */
export function assessErasure(request: ErasureRequest): ErasureAssessment {
  if (request.hasActiveEnrolment) {
    return {
      canErase: false,
      approach: 'REFUSE',
      keep: ['Everything, while the enrolment is active'],
      remove: [],
      explanation:
        'The person is currently enrolled, so the institution needs their information to deliver the programme they registered for. They can withdraw first, and then ask again.',
    };
  }

  if (request.hasOutstandingBalance) {
    return {
      canErase: false,
      approach: 'REFUSE',
      keep: ['Account and contact details, while the balance stands'],
      remove: [],
      explanation:
        'There is money outstanding on the account, so the institution has a lawful basis to keep enough information to pursue it.',
    };
  }

  if (request.hasAcademicRecord) {
    return {
      canErase: true,
      approach: 'ANONYMISE',
      keep: [
        'Results, credits and any qualification awarded',
        'Certificate numbers and their verification codes',
        'Financial records for the statutory period',
        'Audit entries about decisions taken',
      ],
      remove: [
        'Contact details, address and next of kin',
        'Identity and passport numbers',
        'Uploaded documents and assignment files',
        'Messages, discussion posts and support tickets',
        'Sign-in history',
      ],
      explanation:
        'The academic record stays, because a qualification has to remain verifiable and erasing it would harm the person as much as the institution. Everything that identifies them beyond that record is removed, and the record is detached from their personal details.',
    };
  }

  return {
    canErase: true,
    approach: 'DELETE',
    keep: ['Audit entries about the erasure itself'],
    remove: ['Everything held about this person'],
    explanation:
      'There is no academic record and nothing outstanding, so the personal information can be deleted outright.',
  };
}

export const EXPORT_SECTIONS = [
  'profile',
  'studentRecord',
  'enrolments',
  'results',
  'attendance',
  'submissions',
  'certificates',
  'finance',
  'messages',
  'notifications',
] as const;

export type ExportSection = (typeof EXPORT_SECTIONS)[number];
