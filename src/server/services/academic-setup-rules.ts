/**
 * src/server/services/academic-setup-rules.ts
 *
 * The decisions behind the academic setup screens, kept pure so they can be
 * tested without a database: how codes are written, when a year or a term is
 * sensible, and whether a set of grade bands actually describes a scale.
 */
import { z } from 'zod';

/** Anyone holding one of these may open the academic setup screens. */
export const SETUP_PERMISSIONS = ['programme.manage', 'course.manage', 'settings.manage', 'enrolment.manage'] as const;

/* ------------------------------------------------------------------ codes -- */

/** Upper case, digits and single hyphens: FAC-COM, HCBM, BUS101. */
export const CODE_PATTERN = /^[A-Z0-9]+(?:-[A-Z0-9]+)*$/;
export const CODE_MAX_LENGTH = 20;

export function normaliseCode(input: string): string {
  return input
    .trim()
    .toUpperCase()
    .replace(/[\s_]+/g, '-')
    .replace(/[^A-Z0-9-]/g, '')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, CODE_MAX_LENGTH);
}

const code = z
  .string()
  .transform(normaliseCode)
  .refine((value) => value.length > 0, 'Give it a short code, such as BUS101.')
  .refine((value) => CODE_PATTERN.test(value), 'Letters, digits and hyphens only.');

const name = (what: string) =>
  z.string().trim().min(2, `Give the ${what} a name.`).max(160, 'Keep it under 160 characters.');

const blankToUndefined = (value: unknown) => (typeof value === 'string' && value.trim() === '' ? undefined : value);
const optionalText = (max = 2000) => z.preprocess(blankToUndefined, z.string().trim().max(max).optional());
const optionalInt = (min: number, max: number, message: string) =>
  z.preprocess(blankToUndefined, z.coerce.number({ invalid_type_error: message }).int(message).min(min, message).max(max, message).optional());
const isoDate = (message: string) =>
  z.string().regex(/^\d{4}-\d{2}-\d{2}$/, message).transform((value) => new Date(`${value}T00:00:00.000Z`));
const optionalDate = z.preprocess(blankToUndefined, isoDate('Use a full date.').optional());
const id = z.string().min(1, 'Choose one.');

/* ---------------------------------------------------------- academic year -- */

export const academicYearSchema = z
  .object({
    year: z.coerce.number({ invalid_type_error: 'Enter the year, such as 2027.' }).int().min(2000, 'Enter a real year.').max(2100, 'Enter a real year.'),
    label: z.preprocess(blankToUndefined, z.string().trim().max(60).optional()),
    startsOn: isoDate('Enter the first day of the year.'),
    endsOn: isoDate('Enter the last day of the year.'),
    isCurrent: z.boolean().default(false),
  })
  .superRefine((value, ctx) => {
    for (const problem of yearProblems(value)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [problem.field], message: problem.message });
  })
  .transform((value) => ({ ...value, label: value.label ?? `${value.year} academic year` }));

export function yearProblems(value: { year: number; startsOn: Date; endsOn: Date }): { field: string; message: string }[] {
  const problems: { field: string; message: string }[] = [];
  if (value.endsOn <= value.startsOn) problems.push({ field: 'endsOn', message: 'The year has to end after it starts.' });
  const days = (value.endsOn.getTime() - value.startsOn.getTime()) / 86_400_000;
  if (days > 550) problems.push({ field: 'endsOn', message: 'An academic year longer than eighteen months is almost certainly a typing mistake.' });
  const startYear = value.startsOn.getUTCFullYear();
  if (Math.abs(startYear - value.year) > 1) problems.push({ field: 'startsOn', message: `The ${value.year} year should start in or next to ${value.year}.` });
  return problems;
}

/* ------------------------------------------------------------------ terms -- */

export const TERM_TYPES = ['SEMESTER', 'TRIMESTER', 'QUARTER', 'BLOCK', 'FULL_YEAR'] as const;

export const termSchema = z
  .object({
    academicYearId: id,
    code: code,
    name: name('term'),
    type: z.enum(TERM_TYPES).default('SEMESTER'),
    startsOn: isoDate('Enter the first day of the term.'),
    endsOn: isoDate('Enter the last day of the term.'),
    registrationOpensOn: optionalDate,
    registrationClosesOn: optionalDate,
    isCurrent: z.boolean().default(false),
  })
  .superRefine((value, ctx) => {
    for (const problem of termProblems(value)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [problem.field], message: problem.message });
  });

export function termProblems(
  term: { startsOn: Date; endsOn: Date; registrationOpensOn?: Date; registrationClosesOn?: Date },
  year?: { startsOn: Date; endsOn: Date },
): { field: string; message: string }[] {
  const problems: { field: string; message: string }[] = [];
  if (term.endsOn <= term.startsOn) problems.push({ field: 'endsOn', message: 'The term has to end after it starts.' });
  if (year && (term.startsOn < year.startsOn || term.endsOn > year.endsOn)) {
    problems.push({ field: 'startsOn', message: 'The term has to fall inside its academic year.' });
  }
  if (term.registrationOpensOn && term.registrationClosesOn && term.registrationClosesOn < term.registrationOpensOn) {
    problems.push({ field: 'registrationClosesOn', message: 'Registration has to close after it opens.' });
  }
  if (term.registrationClosesOn && term.registrationClosesOn > term.endsOn) {
    problems.push({ field: 'registrationClosesOn', message: 'Registration cannot stay open after the term ends.' });
  }
  return problems;
}

/* ---------------------------------------------------------- structure ------ */

export const facultySchema = z.object({ code, name: name('faculty'), description: optionalText(1000) });
export const departmentSchema = z.object({ facultyId: id, code, name: name('department') });

export const QUALIFICATION_TYPES = [
  'HIGHER_CERTIFICATE', 'DIPLOMA', 'ADVANCED_DIPLOMA', 'BACHELOR', 'POSTGRADUATE_DIPLOMA', 'HONOURS',
  'MASTERS', 'DOCTORAL', 'SHORT_COURSE', 'SKILLS_PROGRAMME', 'PROFESSIONAL_DEVELOPMENT',
] as const;

export const qualificationSchema = z.object({
  code,
  title: name('qualification'),
  type: z.enum(QUALIFICATION_TYPES, { errorMap: () => ({ message: 'Choose the kind of qualification.' }) }),
  nqfLevel: optionalInt(1, 10, 'NQF levels run from 1 to 10.'),
  minimumCredits: optionalInt(1, 1000, 'Enter the credits as a whole number.'),
  saqaId: optionalText(40),
  accreditationRef: optionalText(80),
});

export const DELIVERY_MODES = ['CONTACT', 'ONLINE', 'BLENDED', 'DISTANCE', 'WORKPLACE'] as const;

export const programmeSchema = z.object({
  code,
  title: name('programme'),
  departmentId: id,
  qualificationId: id,
  description: optionalText(4000),
  durationMonths: optionalInt(1, 120, 'Enter the duration in months.'),
  entryRequirements: optionalText(4000),
  deliveryModes: z.array(z.enum(DELIVERY_MODES)).min(1, 'Choose at least one way it is delivered.'),
  isActive: z.boolean().default(true),
});

export const courseSchema = z.object({
  code,
  title: name('course'),
  departmentId: z.preprocess(blankToUndefined, z.string().optional()),
  credits: z.coerce.number({ invalid_type_error: 'Enter the credits.' }).int('Credits are a whole number.').min(0).max(240),
  notionalHours: optionalInt(1, 2400, 'Enter the notional hours as a whole number.'),
  nqfLevel: optionalInt(1, 10, 'NQF levels run from 1 to 10.'),
  description: optionalText(4000),
  isActive: z.boolean().default(true),
});

export const OFFERING_STATUSES = ['DRAFT', 'OPEN', 'ACTIVE', 'CLOSED', 'ARCHIVED'] as const;

export const offeringSchema = z.object({
  courseId: id,
  academicTermId: id,
  sectionCode: z.preprocess(blankToUndefined, z.string().transform(normaliseCode).optional()).transform((value) => value || 'A'),
  deliveryMode: z.enum(DELIVERY_MODES).default('BLENDED'),
  capacity: optionalInt(1, 100000, 'Enter the capacity as a whole number.'),
  status: z.enum(OFFERING_STATUSES).default('OPEN'),
});

export const STAFF_ROLES = ['LECTURER', 'FACILITATOR', 'ASSESSOR', 'MODERATOR', 'TUTOR', 'EXTERNAL_EXAMINER'] as const;

/** Which system role a teaching-team assignment needs, so the person can actually act on the course. */
export const STAFF_ROLE_GRANTS: Record<(typeof STAFF_ROLES)[number], string> = {
  LECTURER: 'LECTURER',
  FACILITATOR: 'FACILITATOR',
  ASSESSOR: 'ASSESSOR',
  MODERATOR: 'MODERATOR',
  TUTOR: 'FACILITATOR',
  EXTERNAL_EXAMINER: 'EXTERNAL_EXAMINER',
};

export const staffAssignmentSchema = z.object({
  offeringId: id,
  userId: id,
  role: z.enum(STAFF_ROLES).default('LECTURER'),
});

export const cohortSchema = z.object({
  programmeId: id,
  academicYearId: id,
  code,
  name: name('cohort'),
  startsOn: optionalDate,
  endsOn: optionalDate,
});

/* ------------------------------------------------------------ grade bands -- */

export interface Band {
  label: string;
  minPercent: number;
  maxPercent: number;
  gradePoint: number | null;
  isPass: boolean;
  descriptor?: string | null;
}

export const GRADE_SCHEME_TYPES = ['PERCENTAGE', 'LETTER', 'PASS_FAIL', 'COMPETENCY', 'GPA'] as const;

/** A conventional South African higher education scale, as a starting point to edit. */
export const DEFAULT_BANDS: Band[] = [
  { label: 'Distinction', minPercent: 75, maxPercent: 100, gradePoint: 4, isPass: true },
  { label: 'Merit', minPercent: 60, maxPercent: 74.99, gradePoint: 3, isPass: true },
  { label: 'Pass', minPercent: 50, maxPercent: 59.99, gradePoint: 2, isPass: true },
  { label: 'Fail', minPercent: 0, maxPercent: 49.99, gradePoint: 0, isPass: false },
];

export function bandsToLines(bands: Band[]): string {
  return [...bands]
    .sort((a, b) => b.minPercent - a.minPercent)
    .map((band) => [band.label, band.minPercent, band.maxPercent, band.gradePoint ?? '', band.isPass ? 'pass' : 'fail'].join(', '))
    .join('\n');
}

/**
 * Reads bands written one per line: `Label, min, max, grade point, pass|fail`.
 * A plain text format keeps the editor usable without scripts, and pastes
 * straight out of an assessment policy document.
 */
export function parseBandLines(text: string): { bands: Band[]; problems: string[] } {
  const bands: Band[] = [];
  const problems: string[] = [];
  text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .forEach((line, index) => {
      const parts = line.split(',').map((part) => part.trim());
      const [label, min, max, point, outcome] = parts;
      const row = index + 1;
      if (!label || min === undefined || max === undefined) {
        problems.push(`Line ${row}: write it as "Label, min, max, grade point, pass or fail".`);
        return;
      }
      const minPercent = Number(min);
      const maxPercent = Number(max);
      if (!Number.isFinite(minPercent) || !Number.isFinite(maxPercent)) {
        problems.push(`Line ${row}: the minimum and maximum must be numbers.`);
        return;
      }
      const gradePoint = point === undefined || point === '' ? null : Number(point);
      if (gradePoint !== null && !Number.isFinite(gradePoint)) {
        problems.push(`Line ${row}: the grade point must be a number, or left empty.`);
        return;
      }
      const verdict = (outcome ?? '').toLowerCase();
      if (verdict && !['pass', 'fail'].includes(verdict)) {
        problems.push(`Line ${row}: end the line with "pass" or "fail".`);
        return;
      }
      bands.push({ label, minPercent, maxPercent, gradePoint, isPass: verdict ? verdict === 'pass' : minPercent >= 50 });
    });
  return { bands, problems };
}

/**
 * Whether a set of bands is a scale: every mark from 0 to 100 falls in exactly
 * one band, labels are distinct, and there is somewhere to pass and somewhere
 * to fail. A gap of up to 0.01 between bands is allowed, because marks are
 * stored to two decimal places (49.99, then 50).
 */
export function bandProblems(bands: Band[]): string[] {
  const problems: string[] = [];
  if (bands.length === 0) return ['Add at least one band.'];

  const labels = new Set<string>();
  for (const band of bands) {
    const key = band.label.toLowerCase();
    if (labels.has(key)) problems.push(`"${band.label}" appears twice.`);
    labels.add(key);
    if (band.minPercent < 0 || band.maxPercent > 100) problems.push(`${band.label}: marks run from 0 to 100.`);
    if (band.minPercent > band.maxPercent) problems.push(`${band.label}: the minimum is above the maximum.`);
    if (band.gradePoint !== null && (band.gradePoint < 0 || band.gradePoint > 99.99)) problems.push(`${band.label}: the grade point is out of range.`);
  }
  if (problems.length > 0) return problems;

  const sorted = [...bands].sort((a, b) => a.minPercent - b.minPercent);
  if (sorted[0]!.minPercent > 0) problems.push(`Marks below ${sorted[0]!.minPercent} fall in no band.`);
  if (sorted[sorted.length - 1]!.maxPercent < 100) problems.push(`Marks above ${sorted[sorted.length - 1]!.maxPercent} fall in no band.`);
  for (let index = 1; index < sorted.length; index += 1) {
    const previous = sorted[index - 1]!;
    const current = sorted[index]!;
    const gap = Math.round((current.minPercent - previous.maxPercent) * 100) / 100;
    if (gap <= 0) problems.push(`${previous.label} and ${current.label} overlap.`);
    else if (gap > 0.01) problems.push(`Marks between ${previous.maxPercent} and ${current.minPercent} fall in no band.`);
  }
  if (!bands.some((band) => band.isPass)) problems.push('No band is a pass.');
  if (!bands.some((band) => !band.isPass)) problems.push('No band is a fail: every mark would pass.');
  return problems;
}

export const gradingSchemeSchema = z
  .object({
    name: name('scheme'),
    type: z.enum(GRADE_SCHEME_TYPES).default('PERCENTAGE'),
    isDefault: z.boolean().default(false),
    bands: z.string().min(1, 'Add the bands, one per line.'),
  })
  .transform((value, ctx) => {
    const { bands, problems } = parseBandLines(value.bands);
    const all = [...problems, ...(problems.length === 0 ? bandProblems(bands) : [])];
    if (all.length > 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['bands'], message: all.join(' ') });
      return z.NEVER;
    }
    return { name: value.name, type: value.type, isDefault: value.isDefault, bands };
  });

/* --------------------------------------------------------- email templates -- */

/** The variables every notification email can use; anything else renders empty. */
export const TEMPLATE_VARIABLES = ['firstName', 'title', 'body', 'institution', 'link'] as const;

export function unknownTemplateVariables(...texts: string[]): string[] {
  const found = new Set<string>();
  for (const text of texts) {
    for (const match of text.matchAll(/\{\{\s*(\w+)\s*\}\}/g)) {
      if (!(TEMPLATE_VARIABLES as readonly string[]).includes(match[1]!)) found.add(match[1]!);
    }
  }
  return [...found];
}

export const emailTemplateSchema = z
  .object({
    key: z.string().min(1),
    subject: z.string().trim().min(2, 'Write a subject line.').max(200),
    bodyHtml: z.string().trim().min(2, 'Write the message.').max(20000),
    bodyText: optionalText(20000),
    isActive: z.boolean().default(true),
  })
  .superRefine((value, ctx) => {
    const unknown = unknownTemplateVariables(value.subject, value.bodyHtml, value.bodyText ?? '');
    if (unknown.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['bodyHtml'],
        message: `Unknown variable${unknown.length > 1 ? 's' : ''}: ${unknown.map((name) => `{{${name}}}`).join(', ')}. Use ${TEMPLATE_VARIABLES.map((name) => `{{${name}}}`).join(', ')}.`,
      });
    }
  });
