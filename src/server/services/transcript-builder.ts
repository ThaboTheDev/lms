/**
 * Assembles a transcript from course records. Pure: the same function builds
 * the on-screen transcript, the stored snapshot and the printed document, so
 * the three can never disagree about what a learner achieved.
 */
import { calculateGpa } from './grading-rules';
import { summariseCredits, isPassing, type CourseRecord, type CreditSummary } from './progression-rules';

export interface TranscriptHeader {
  institutionName: string;
  studentNumber: string;
  fullName: string;
  programmeTitle: string;
  programmeCode: string;
  qualificationTitle: string;
  nqfLevel: number | null;
  generatedAt: Date;
}

export interface TranscriptLine {
  code: string;
  title: string;
  credits: number;
  mark: number | null;
  grade: string | null;
  result: string;
  creditsEarned: number;
}

export interface TranscriptPeriod {
  academicYear: number;
  yearOfStudy: number;
  termLabel: string;
  lines: TranscriptLine[];
  creditsEarned: number;
}

export interface Transcript {
  header: TranscriptHeader;
  periods: TranscriptPeriod[];
  summary: CreditSummary;
  gpa: number | null;
  /** True while any result is still outstanding, so the document says so. */
  provisional: boolean;
}

export function buildTranscript(
  header: TranscriptHeader,
  records: CourseRecord[],
  gradePoints: { grade: string; point: number }[] = [],
): Transcript {
  const pointByGrade = new Map(gradePoints.map((entry) => [entry.grade, entry.point]));

  // Grouped the way a printed transcript reads: academic year, then term.
  const grouped = new Map<string, TranscriptPeriod>();

  for (const record of [...records].sort(
    (a, b) => a.academicYear - b.academicYear || a.termLabel.localeCompare(b.termLabel) || a.code.localeCompare(b.code),
  )) {
    const key = `${record.academicYear}:${record.termLabel}`;
    const period = grouped.get(key) ?? {
      academicYear: record.academicYear,
      yearOfStudy: record.yearOfStudy,
      termLabel: record.termLabel,
      lines: [],
      creditsEarned: 0,
    };

    const creditsEarned = isPassing(record.result) ? record.creditsAwarded ?? record.credits : 0;

    period.lines.push({
      code: record.code,
      title: record.title,
      credits: record.credits,
      mark: record.finalMark,
      grade: record.finalGrade,
      result: record.result,
      creditsEarned,
    });
    period.creditsEarned += creditsEarned;
    grouped.set(key, period);
  }

  const summary = summariseCredits(records);

  const gpa = calculateGpa(
    records
      .filter((record) => isPassing(record.result) || record.result === 'FAIL')
      .map((record) => ({
        credits: record.credits,
        gradePoint: record.finalGrade ? pointByGrade.get(record.finalGrade) ?? null : null,
      })),
  );

  return {
    header,
    periods: [...grouped.values()],
    summary,
    gpa,
    provisional: summary.coursesOutstanding > 0,
  };
}

/** One line of standing text for the foot of the document. */
export function transcriptFooter(transcript: Transcript): string {
  const parts = [
    `${transcript.summary.earned} credits earned`,
    `${transcript.summary.coursesPassed} courses passed`,
  ];
  if (transcript.gpa !== null) parts.push(`grade point average ${transcript.gpa}`);
  if (transcript.provisional) {
    parts.push(`${transcript.summary.coursesOutstanding} results outstanding, so this record is provisional`);
  }
  return parts.join(', ');
}
