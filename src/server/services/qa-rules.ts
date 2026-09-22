/**
 * Quality assurance: what a programme review needs before it can be signed off,
 * and what an accreditation panel will ask for. Pure, so the checklist on the
 * screen and the compliance report cannot disagree about what is missing.
 */

export type ReviewStage = 'PLANNED' | 'EVIDENCE' | 'IN_REVIEW' | 'FINDINGS' | 'COMPLETE' | 'OVERDUE';

export interface ReviewState {
  status: string;
  dueOn: Date | null;
  completedOn: Date | null;
  hasFindings: boolean;
  hasActions: boolean;
  evidenceCount: number;
}

export function reviewStage(state: ReviewState, now: Date = new Date()): ReviewStage {
  if (state.completedOn) return 'COMPLETE';
  if (state.dueOn && now > state.dueOn) return 'OVERDUE';
  if (state.hasFindings) return 'FINDINGS';
  if (state.evidenceCount > 0) return 'IN_REVIEW';
  if (state.status === 'PLANNED') return 'PLANNED';
  return 'EVIDENCE';
}

export interface EvidenceRequirement {
  category: string;
  label: string;
  /** Why an accreditation panel asks for it, shown next to the gap. */
  rationale: string;
  required: boolean;
}

/**
 * The evidence a South African institution is ordinarily asked for at a
 * programme review. Categories rather than named documents, because every
 * institution files these differently.
 */
export const EVIDENCE_REQUIREMENTS: EvidenceRequirement[] = [
  {
    category: 'CURRICULUM',
    label: 'Approved curriculum and outcomes',
    rationale: 'Shows what the qualification claims to teach.',
    required: true,
  },
  {
    category: 'ASSESSMENT_POLICY',
    label: 'Assessment policy',
    rationale: 'Shows how marks are arrived at and what a learner may appeal.',
    required: true,
  },
  {
    category: 'MODERATION',
    label: 'Moderation records',
    rationale: 'Shows that marking was checked, internally and externally.',
    required: true,
  },
  {
    category: 'RESULTS',
    label: 'Results and pass rates',
    rationale: 'Shows outcomes across cohorts, with the trend.',
    required: true,
  },
  {
    category: 'STAFF',
    label: 'Staff qualifications',
    rationale: 'Shows that whoever taught the programme was qualified to.',
    required: true,
  },
  {
    category: 'LEARNER_FEEDBACK',
    label: 'Learner feedback',
    rationale: 'Shows what the people on the programme said about it.',
    required: false,
  },
  {
    category: 'RESOURCES',
    label: 'Teaching and learning resources',
    rationale: 'Shows what was actually available to learners.',
    required: false,
  },
];

export interface EvidenceGap {
  category: string;
  label: string;
  rationale: string;
  required: boolean;
}

export interface EvidenceCheck {
  present: string[];
  gaps: EvidenceGap[];
  requiredGaps: number;
  readyToSubmit: boolean;
  completeness: number;
}

export function checkEvidence(categoriesOnFile: string[]): EvidenceCheck {
  const onFile = new Set(categoriesOnFile);

  const gaps = EVIDENCE_REQUIREMENTS.filter((requirement) => !onFile.has(requirement.category)).map(
    (requirement) => ({
      category: requirement.category,
      label: requirement.label,
      rationale: requirement.rationale,
      required: requirement.required,
    }),
  );

  const requiredTotal = EVIDENCE_REQUIREMENTS.filter((requirement) => requirement.required).length;
  const requiredGaps = gaps.filter((gap) => gap.required).length;

  return {
    present: EVIDENCE_REQUIREMENTS.filter((requirement) => onFile.has(requirement.category)).map(
      (requirement) => requirement.label,
    ),
    gaps,
    requiredGaps,
    readyToSubmit: requiredGaps === 0,
    completeness: Math.round(((requiredTotal - requiredGaps) / requiredTotal) * 100),
  };
}

export interface ComplianceSignal {
  key: string;
  label: string;
  status: 'ok' | 'attention' | 'breach';
  detail: string;
}

export interface ComplianceInput {
  assessmentsPublished: number;
  assessmentsModerated: number;
  resultsReleasedWithoutModeration: number;
  programmesWithoutReview: number;
  programmesTotal: number;
  certificatesIssuedByException: number;
  overdueReviews: number;
}

/**
 * The handful of signals an academic board looks at. Each says plainly what was
 * measured, so nobody has to guess what a red light means.
 */
export function complianceSignals(input: ComplianceInput): ComplianceSignal[] {
  const moderationRate =
    input.assessmentsPublished > 0
      ? Math.round((input.assessmentsModerated / input.assessmentsPublished) * 100)
      : 100;

  return [
    {
      key: 'moderation',
      label: 'Assessments moderated',
      status: moderationRate >= 80 ? 'ok' : moderationRate >= 50 ? 'attention' : 'breach',
      detail: `${input.assessmentsModerated} of ${input.assessmentsPublished} published assessments have a moderation record (${moderationRate}%).`,
    },
    {
      key: 'release_before_moderation',
      label: 'Results released before moderation',
      status: input.resultsReleasedWithoutModeration === 0 ? 'ok' : 'breach',
      detail:
        input.resultsReleasedWithoutModeration === 0
          ? 'Every released result had been moderated first.'
          : `${input.resultsReleasedWithoutModeration} assessments released results with no moderation record.`,
    },
    {
      key: 'programme_review',
      label: 'Programme review',
      status:
        input.programmesWithoutReview === 0
          ? 'ok'
          : input.programmesWithoutReview <= Math.ceil(input.programmesTotal / 3)
            ? 'attention'
            : 'breach',
      detail: `${input.programmesWithoutReview} of ${input.programmesTotal} programmes have no review on record.`,
    },
    {
      key: 'overdue_reviews',
      label: 'Reviews past their date',
      status: input.overdueReviews === 0 ? 'ok' : 'attention',
      detail: `${input.overdueReviews} reviews are past the date they were due.`,
    },
    {
      key: 'certificate_exceptions',
      label: 'Certificates issued by exception',
      status: input.certificatesIssuedByException === 0 ? 'ok' : 'attention',
      detail:
        input.certificatesIssuedByException === 0
          ? 'No certificate was issued to a learner who had not met the qualification.'
          : `${input.certificatesIssuedByException} certificates were issued by exception, each with a recorded reason.`,
    },
  ];
}
