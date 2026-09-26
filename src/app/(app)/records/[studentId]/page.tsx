import type { Metadata } from 'next';
import Link from 'next/link';
import { prisma } from '@/lib/db';
import { requirePrincipal } from '@/lib/auth/current-user';
import { can } from '@/lib/rbac/authorize';
import { listTranscriptSnapshots, loadTranscript } from '@/server/services/academic-records';
import { evaluateProgression } from '@/server/services/progression';
import { transcriptFooter } from '@/server/services/transcript-builder';
import { DataTable, Panel, Tag } from '@/components/ui/primitives';
import { Breadcrumbs, DescriptionList } from '@/components/ui/navigation';
import { ProgressionPanel, TranscriptActions, IssueCertificatePanel } from './record-actions';

export const metadata: Metadata = { title: 'Academic record' };

export default async function StudentRecordPage({
  params,
}: {
  params: Promise<{ studentId: string }>;
}) {
  const principal = await requirePrincipal();
  const { studentId } = await params;

  const [transcript, snapshots, enrolment, certificates] = await Promise.all([
    loadTranscript(principal, studentId),
    listTranscriptSnapshots(principal, studentId),
    prisma.programmeEnrolment.findFirst({
      where: { studentId },
      orderBy: { enrolledOn: 'desc' },
      select: {
        programmeId: true,
        academicYearId: true,
        yearOfStudy: true,
        status: true,
        programme: { select: { code: true, title: true } },
        academicYear: { select: { label: true } },
      },
    }),
    prisma.certificate.findMany({
      where: { studentId },
      orderBy: { issuedOn: 'desc' },
      select: { id: true, number: true, title: true, status: true, issuedOn: true },
    }),
  ]);

  const evaluation =
    enrolment && can(principal, 'academic_record.read')
      ? await evaluateProgression(principal, {
          studentId,
          programmeId: enrolment.programmeId,
          academicYearId: enrolment.academicYearId,
        })
      : null;

  return (
    <div className="space-y-6">
      <Breadcrumbs
        trail={[
          { label: 'Academic records', href: '/records' },
          { label: transcript.header.studentNumber },
        ]}
      />

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-serif text-2xl font-semibold">{transcript.header.fullName}</h1>
          <p className="mt-1 text-sm text-muted">
            {transcript.header.studentNumber} · {transcript.header.programmeTitle}
            {enrolment ? ` · year ${enrolment.yearOfStudy}` : ''}
          </p>
        </div>
        {can(principal, 'student.read') && <Link href={`/students/${studentId}`} className="text-sm text-accent underline underline-offset-2">
          Student profile
        </Link>}
      </div>

      <Panel title="Summary">
        <DescriptionList
          items={[
            { term: 'Qualification', value: transcript.header.qualificationTitle || 'Not enrolled' },
            { term: 'NQF level', value: transcript.header.nqfLevel ?? 'Not recorded' },
            { term: 'Credits earned', value: transcript.summary.earned },
            { term: 'Credits outstanding', value: transcript.summary.outstanding },
            { term: 'Courses passed', value: transcript.summary.coursesPassed },
            { term: 'Courses failed', value: transcript.summary.coursesFailed },
            { term: 'Grade point average', value: transcript.gpa ?? 'Not applicable' },
            { term: 'Enrolment', value: enrolment ? enrolment.status.toLowerCase() : 'none' },
          ]}
        />
      </Panel>

      {transcript.provisional && (
        <p className="border-l-2 border-caution bg-caution/5 px-4 py-3 text-sm text-caution">
          {transcript.summary.coursesOutstanding} results are still outstanding. Anything issued now
          will say that it is provisional.
        </p>
      )}

      <Panel title="Transcript" description={transcriptFooter(transcript)}>
        {transcript.periods.length === 0 ? (
          <p className="px-4 py-6 text-sm text-muted">No course records yet.</p>
        ) : (
          transcript.periods.map((period) => (
            <div key={`${period.academicYear}-${period.termLabel}`} className="border-b border-line last:border-0">
              <h3 className="bg-paper px-4 py-2 text-sm font-medium">
                {period.termLabel} {period.academicYear} · {period.creditsEarned} credits
              </h3>
              <DataTable
                caption={`${period.termLabel} ${period.academicYear}`}
                head={['Course', 'Credits', 'Mark', 'Grade', 'Result']}
              >
                {period.lines.map((line) => (
                  <tr key={`${line.code}-${period.termLabel}`} className="border-b border-line last:border-0">
                    <td className="px-4 py-2.5">
                      {line.code}
                      <span className="block text-xs text-muted">{line.title}</span>
                    </td>
                    <td className="px-4 py-2.5 tabular-nums">{line.credits}</td>
                    <td className="px-4 py-2.5 tabular-nums">{line.mark ?? '-'}</td>
                    <td className="px-4 py-2.5 text-muted">{line.grade ?? '-'}</td>
                    <td className="px-4 py-2.5">
                      <Tag tone={line.creditsEarned > 0 ? 'active' : 'caution'}>
                        {line.result.toLowerCase().replace(/_/g, ' ')}
                      </Tag>
                    </td>
                  </tr>
                ))}
              </DataTable>
            </div>
          ))
        )}
      </Panel>

      {can(principal, 'academic_record.read') && (
        <TranscriptActions studentId={studentId} snapshots={snapshots} />
      )}

      {evaluation && enrolment && can(principal, 'academic_record.manage') && (
        <ProgressionPanel
          studentId={studentId}
          programmeId={enrolment.programmeId}
          academicYearId={enrolment.academicYearId}
          academicYearLabel={enrolment.academicYear.label}
          recommendation={evaluation.outcome}
          standing={evaluation.standing}
          reasons={evaluation.reasons}
          mustRepeat={evaluation.mustRepeat}
          finalYear={evaluation.finalYear}
        />
      )}

      <Panel title="Certificates">
        {certificates.length === 0 ? (
          <p className="px-4 py-6 text-sm text-muted">Nothing has been issued to this learner.</p>
        ) : (
          <ul className="divide-y divide-line">
            {certificates.map((certificate) => (
              <li key={certificate.id} className="flex items-center justify-between px-4 py-3 text-sm">
                <div>
                  {can(principal, 'certificate.read') ? (<Link href={`/certificates/${certificate.id}`} className="text-accent underline-offset-2 hover:underline">
                    {certificate.title}
                  </Link>) : (<span>
                    {certificate.title}
                  </span>)}
                  <span className="block text-xs tabular-nums text-muted">{certificate.number}</span>
                </div>
                <Tag tone={certificate.status === 'REVOKED' ? 'danger' : 'active'}>
                  {certificate.status.toLowerCase()}
                </Tag>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {can(principal, 'certificate.issue') && (
        <IssueCertificatePanel
          studentId={studentId}
          eligible={evaluation?.outcome === 'GRADUATE'}
          blockers={evaluation?.outcome === 'GRADUATE' ? [] : (evaluation?.reasons ?? [])}
        />
      )}
    </div>
  );
}
