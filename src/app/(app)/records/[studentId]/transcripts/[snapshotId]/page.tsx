import type { Metadata } from 'next';
import { requirePrincipal } from '@/lib/auth/current-user';
import { NotFoundError } from '@/lib/errors';
import { loadSnapshot } from '@/server/services/academic-records';
import type { Transcript } from '@/server/services/transcript-builder';
import { Breadcrumbs } from '@/components/ui/navigation';
import { PrintButton } from '@/components/ui/print-button';

export const metadata: Metadata = { title: 'Issued transcript' };

export default async function IssuedTranscriptPage({ params }: { params: Promise<{ studentId: string; snapshotId: string }> }) {
  const principal = await requirePrincipal();
  const { studentId, snapshotId } = await params;
  const snapshot = await loadSnapshot(principal, snapshotId);
  if (snapshot.studentId !== studentId) throw new NotFoundError('Transcript');
  const transcript = snapshot.payload as unknown as Transcript;
  const issued = snapshot.generatedAt.toLocaleDateString('en-ZA', { dateStyle: 'long' });

  return (
    <div className="space-y-6">
      <div data-print="hide">
        <Breadcrumbs trail={[{ label: 'Academic records', href: '/records' }, { label: transcript.header.studentNumber, href: `/records/${studentId}` }, { label: `Issued ${issued}` }]} />
      </div>
      <article className="mx-auto max-w-3xl space-y-5 rounded-md border border-line bg-surface p-8 print:border-0 print:p-0">
        <header className="space-y-1 border-b border-line pb-4">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">{transcript.header.institutionName}</p>
          <h1 className="font-serif text-2xl font-semibold">Academic transcript</h1>
          <p className="text-sm">{transcript.header.fullName} · {transcript.header.studentNumber}</p>
          <p className="text-sm text-muted">
            {transcript.header.programmeTitle}
            {transcript.header.qualificationTitle ? ` · ${transcript.header.qualificationTitle}` : ''}
            {transcript.header.nqfLevel ? ` · NQF ${transcript.header.nqfLevel}` : ''}
          </p>
          <p className="text-xs text-muted">Issued {issued}. This copy is fixed as at that day and does not change if a mark is later corrected.</p>
          {transcript.provisional && <p className="text-sm font-medium text-danger">Provisional: some results were still outstanding when this was issued.</p>}
        </header>
        {transcript.periods.map((period) => (
          <section key={`${period.academicYear}-${period.termLabel}`}>
            <h2 className="mb-2 text-sm font-semibold">{period.academicYear} · {period.termLabel} · year {period.yearOfStudy}</h2>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs text-muted">
                  <th className="py-1.5 pr-3 font-medium">Code</th><th className="py-1.5 pr-3 font-medium">Course</th>
                  <th className="py-1.5 pr-3 font-medium">Credits</th><th className="py-1.5 pr-3 font-medium">Mark</th>
                  <th className="py-1.5 pr-3 font-medium">Grade</th><th className="py-1.5 font-medium">Result</th>
                </tr>
              </thead>
              <tbody>
                {period.lines.map((line) => (
                  <tr key={line.code} className="border-b border-line last:border-0">
                    <td className="py-1.5 pr-3 font-medium">{line.code}</td>
                    <td className="py-1.5 pr-3">{line.title}</td>
                    <td className="py-1.5 pr-3 tabular-nums">{line.credits}</td>
                    <td className="py-1.5 pr-3 tabular-nums">{line.mark === null ? '-' : line.mark}</td>
                    <td className="py-1.5 pr-3">{line.grade ?? '-'}</td>
                    <td className="py-1.5">{line.result.toLowerCase().replace(/_/g, ' ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ))}
        <footer className="border-t border-line pt-4 text-sm">
          <p>Credits earned: {transcript.summary.earned}{transcript.gpa !== null ? ` · Grade point average: ${transcript.gpa}` : ''}</p>
        </footer>
      </article>
      <div data-print="hide" className="mx-auto max-w-3xl">
        <PrintButton />
      </div>
    </div>
  );
}
