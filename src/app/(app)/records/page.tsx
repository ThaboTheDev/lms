import type { Metadata } from 'next';
import Link from 'next/link';
import { prisma } from '@/lib/db';
import { requirePrincipal } from '@/lib/auth/current-user';
import { can } from '@/lib/rbac/authorize';
import { progressionBoard } from '@/server/services/progression';
import { loadTranscript } from '@/server/services/academic-records';
import { myCertificates } from '@/server/services/certificates';
import { transcriptFooter } from '@/server/services/transcript-builder';
import { DataTable, EmptyState, Panel, Tag } from '@/components/ui/primitives';
import { Button } from '@/components/ui/primitives';
import { Select } from '@/components/ui/form';

export const metadata: Metadata = { title: 'Academic records' };

const outcomeTone: Record<string, 'active' | 'caution' | 'danger' | 'neutral'> = {
  PROGRESS: 'active',
  GRADUATE: 'active',
  PROGRESS_WITH_CONDITIONS: 'caution',
  REPEAT_MODULES: 'caution',
  REPEAT_YEAR: 'caution',
  EXCLUDE: 'danger',
};

export default async function RecordsPage({
  searchParams,
}: {
  searchParams: Promise<{ programme?: string; year?: string }>;
}) {
  const principal = await requirePrincipal();
  const params = await searchParams;

  // ------------------------------------------------------------ learner ---
  if (!can(principal, 'academic_record.read') && principal.studentId) {
    const [transcript, certificates] = await Promise.all([
      loadTranscript(principal, principal.studentId),
      myCertificates(principal),
    ]);

    return (
      <div className="max-w-3xl space-y-6">
        <div>
          <h1 className="font-serif text-2xl font-semibold">Your academic record</h1>
          <p className="mt-1 text-sm text-muted">
            {transcript.header.programmeTitle} · {transcriptFooter(transcript)}
          </p>
        </div>

        {transcript.provisional && (
          <p className="border-l-2 border-caution bg-caution/5 px-4 py-3 text-sm text-caution">
            Some results are still being marked, so this record is provisional.
          </p>
        )}

        {transcript.periods.map((period) => (
          <Panel
            key={`${period.academicYear}-${period.termLabel}`}
            title={`${period.termLabel} ${period.academicYear}`}
            description={`${period.creditsEarned} credits earned`}
          >
            <DataTable caption={`Results for ${period.termLabel}`} head={['Course', 'Credits', 'Mark', 'Result']}>
              {period.lines.map((line) => (
                <tr key={line.code} className="border-b border-line last:border-0">
                  <td className="px-4 py-2.5">
                    {line.code}
                    <span className="block text-xs text-muted">{line.title}</span>
                  </td>
                  <td className="px-4 py-2.5 tabular-nums">{line.credits}</td>
                  <td className="px-4 py-2.5 tabular-nums">{line.mark ?? '-'}</td>
                  <td className="px-4 py-2.5">
                    <Tag tone={line.creditsEarned > 0 ? 'active' : 'caution'}>
                      {line.result.toLowerCase().replace(/_/g, ' ')}
                    </Tag>
                  </td>
                </tr>
              ))}
            </DataTable>
          </Panel>
        ))}

        <Panel title="Your certificates">
          {certificates.length === 0 ? (
            <EmptyState
              title="Nothing issued yet"
              hint="Certificates appear here once your institution issues them."
            />
          ) : (
            <ul className="divide-y divide-line">
              {certificates.map((certificate) => (
                <li key={certificate.id} className="flex items-center justify-between px-4 py-3 text-sm">
                  <div>
                    <Link href={`/certificates/${certificate.id}`} className="text-accent underline-offset-2 hover:underline">
                      {certificate.title}
                    </Link>
                    <span className="block text-xs tabular-nums text-muted">
                      {certificate.number} · issued{' '}
                      {certificate.issuedOn.toLocaleDateString('en-ZA', { dateStyle: 'long' })}
                    </span>
                  </div>
                  <span className="text-xs tabular-nums text-muted">{certificate.verificationCode}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    );
  }

  // ---------------------------------------------------------- registrar ---
  const [programmes, years] = await Promise.all([
    prisma.programme.findMany({
      where: { institutionId: principal.institutionId ?? undefined, isActive: true },
      select: { id: true, code: true, title: true },
      orderBy: { code: 'asc' },
    }),
    prisma.academicYear.findMany({
      where: { institutionId: principal.institutionId ?? undefined },
      select: { id: true, label: true, isCurrent: true },
      orderBy: { year: 'desc' },
    }),
  ]);

  const programmeId = params.programme ?? programmes[0]?.id;
  const academicYearId = params.year ?? years.find((year) => year.isCurrent)?.id ?? years[0]?.id;

  if (!programmeId || !academicYearId) {
    return (
      <Panel title="Academic records">
        <EmptyState title="Nothing to show yet" hint="Set up a programme and an academic year first." />
      </Panel>
    );
  }

  const { programme, rows, policy } = await progressionBoard(principal, programmeId, academicYearId);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-serif text-2xl font-semibold">Academic records</h1>
          <p className="mt-1 max-w-prose text-sm text-muted">
            Each recommendation is worked out from the learner&apos;s results and the institution&apos;s
            progression policy. A registrar records the decision and may record a different one, with
            the reason.
          </p>
        </div>
        <form className="flex items-end gap-2">
          <div>
            <label htmlFor="programme" className="block text-sm font-medium">Programme</label>
            <Select id="programme" name="programme" defaultValue={programmeId} className="mt-1 h-9 w-56">
              {programmes.map((option) => (
                <option key={option.id} value={option.id}>{option.code}</option>
              ))}
            </Select>
          </div>
          <div>
            <label htmlFor="year" className="block text-sm font-medium">Year</label>
            <Select id="year" name="year" defaultValue={academicYearId} className="mt-1 h-9 w-48">
              {years.map((year) => (
                <option key={year.id} value={year.id}>{year.label}</option>
              ))}
            </Select>
          </div>
          <Button type="submit" variant="secondary" size="sm">Show</Button>
        </form>
      </div>

      <p className="text-xs text-muted">
        Policy: progress at {Math.round(policy.progressThreshold * 100)}%, repeat the year below{' '}
        {Math.round(policy.repeatYearThreshold * 100)}%, carry at most {policy.maximumCarryCredits} credits.
      </p>

      <Panel title={`${programme.code} progression board`} description={`${rows.length} learners`}>
        {rows.length === 0 ? (
          <EmptyState title="No active enrolments" hint="Nobody is enrolled in this programme for that year." />
        ) : (
          <DataTable
            caption="Progression board"
            head={['Learner', 'Year', 'Credits earned', 'Pass rate', 'Recommendation', 'Recorded']}
          >
            {rows.map((row) => (
              <tr key={row.enrolmentId} className="border-b border-line last:border-0">
                <td className="px-4 py-2.5">
                  <Link href={`/records/${row.student.id}`} className="font-medium text-accent underline-offset-2 hover:underline">
                    {row.student.user.lastName}, {row.student.user.firstName}
                  </Link>
                  <span className="block text-xs tabular-nums text-muted">{row.student.studentNumber}</span>
                </td>
                <td className="px-4 py-2.5 tabular-nums">{row.yearOfStudy}</td>
                <td className="px-4 py-2.5 tabular-nums">
                  {row.recommendation.summary.earned}
                  {row.recommendation.summary.outstanding > 0 && (
                    <span className="block text-xs text-caution">
                      {row.recommendation.summary.outstanding} outstanding
                    </span>
                  )}
                </td>
                <td className="px-4 py-2.5 tabular-nums">
                  {Math.round(row.recommendation.summary.passRate * 100)}%
                </td>
                <td className="px-4 py-2.5">
                  <Tag tone={outcomeTone[row.recommendation.outcome] ?? 'neutral'}>
                    {row.recommendation.outcome.toLowerCase().replace(/_/g, ' ')}
                  </Tag>
                </td>
                <td className="px-4 py-2.5">
                  {row.recorded ? (
                    <>
                      <span className="text-sm">{row.recorded.outcome.toLowerCase().replace(/_/g, ' ')}</span>
                      <span className="block text-xs text-muted">
                        {row.recorded.decidedOn.toLocaleDateString('en-ZA', { day: '2-digit', month: 'short' })}
                      </span>
                    </>
                  ) : (
                    <span className="text-sm text-muted">not recorded</span>
                  )}
                </td>
              </tr>
            ))}
          </DataTable>
        )}
      </Panel>
    </div>
  );
}
