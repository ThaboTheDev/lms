/**
 * Turning an audit row into something a person can read. An audit log nobody
 * can read is a log that gets exported once, during an investigation, and
 * misunderstood.
 */

export interface AuditRow {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  actorEmail: string | null;
  before: unknown;
  after: unknown;
  createdAt: Date;
}

export interface FieldChange {
  field: string;
  from: string;
  to: string;
}

const FIELD_LABELS: Record<string, string> = {
  finalMark: 'mark',
  finalGrade: 'grade',
  status: 'status',
  outcome: 'outcome',
  standing: 'academic standing',
  studentNumber: 'student number',
  creditsEarned: 'credits earned',
  reference: 'reference',
  amount: 'amount',
  receipt: 'receipt',
  title: 'title',
  isPublished: 'published',
  released: 'results released',
};

function readable(value: unknown): string {
  if (value === null || value === undefined) return 'not set';
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value).toLowerCase() === '[redacted]' ? 'redacted' : String(value);
}

/**
 * Diffs the before and after of an entry into the fields that actually moved.
 * An audit screen that prints two JSON blobs side by side is asking the reader
 * to do the work the system should have done.
 */
export function describeChanges(before: unknown, after: unknown): FieldChange[] {
  const from = (before ?? {}) as Record<string, unknown>;
  const to = (after ?? {}) as Record<string, unknown>;

  const keys = [...new Set([...Object.keys(from), ...Object.keys(to)])];

  return keys
    .filter((key) => readable(from[key]) !== readable(to[key]))
    .map((key) => ({
      field: FIELD_LABELS[key] ?? key.replace(/([A-Z])/g, ' $1').toLowerCase(),
      from: readable(from[key]),
      to: readable(to[key]),
    }));
}

const ACTION_PHRASES: Record<string, string> = {
  'auth.sign_out': 'signed out',
  'student.created': 'registered a learner',
  'student.contact_updated': 'updated a learner contact detail',
  'application.transitioned': 'moved an application',
  'application.enrolled': 'enrolled an applicant',
  'curriculum.item_added': 'added a course to a curriculum',
  'curriculum.item_removed': 'removed a course from a curriculum',
  'course.prerequisite_added': 'added a prerequisite rule',
  'enrolment.registered': 'registered a learner for courses',
  'assessment.created': 'created an assessment',
  'assessment.published': 'published an assessment',
  'assessment.results_released': 'released results',
  'submission.graded': 'recorded a mark',
  'course.results_finalised': 'finalised course results',
  'transcript.issued': 'issued a transcript',
  'progression.recorded': 'recorded a progression decision',
  'certificate.issued': 'issued a certificate',
  'certificate.revoked': 'revoked a certificate',
  'finance.invoice_created': 'raised an invoice',
  'finance.payment_recorded': 'recorded a payment',
  'finance.pop_reviewed': 'reviewed a proof of payment',
  'finance.plan_created': 'set up a payment plan',
  'file.downloaded': 'downloaded a file',
  'file.deleted': 'deleted a file',
  'attendance.marked': 'took a register',
  'announcement.published': 'published an announcement',
  'moderation.recorded': 'recorded a moderation outcome',
  'moderation.marks_adjusted': 'adjusted marks after moderation',
};

export function describeAction(row: AuditRow): string {
  const who = row.actorEmail ?? 'The system';
  const what = ACTION_PHRASES[row.action] ?? row.action.replace(/[._]/g, ' ');
  return `${who} ${what}`;
}

/** Actions worth watching, because each moves a record somebody relies on. */
export const SENSITIVE_ACTIONS = [
  'submission.graded',
  'assessment.results_released',
  'course.results_finalised',
  'progression.recorded',
  'certificate.issued',
  'certificate.revoked',
  'finance.payment_recorded',
  'finance.pop_reviewed',
  'student.created',
];

export interface AuditSummary {
  action: string;
  label: string;
  count: number;
}

export function summariseActions(rows: { action: string }[]): AuditSummary[] {
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(row.action, (counts.get(row.action) ?? 0) + 1);

  return [...counts.entries()]
    .map(([action, count]) => ({
      action,
      label: ACTION_PHRASES[action] ?? action.replace(/[._]/g, ' '),
      count,
    }))
    .sort((a, b) => b.count - a.count);
}
