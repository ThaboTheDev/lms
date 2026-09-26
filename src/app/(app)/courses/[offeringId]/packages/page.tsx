import type { Metadata } from 'next';
import { requirePrincipal } from '@/lib/auth/current-user';
import { listPackages } from '@/server/services/packages';
import { assertCanEditOffering } from '@/server/services/course-builder';
import { EmptyState, Panel, Tag } from '@/components/ui/primitives';
import { Breadcrumbs } from '@/components/ui/navigation';
import { ActionButton } from '@/components/ui/action-form';
import { PackageUploadForm } from './upload-form';
import { removePackage } from './actions';

export const metadata: Metadata = { title: 'Interactive packages' };

const statusTone = { READY: 'active', PROCESSING: 'caution', FAILED: 'danger' } as const;

function minutes(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.round(seconds / 60);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
}

export default async function PackagesPage({ params }: { params: Promise<{ offeringId: string }> }) {
  const principal = await requirePrincipal();
  const { offeringId } = await params;
  const offering = await assertCanEditOffering(principal, offeringId);
  const packages = await listPackages(principal, offeringId);

  return (
    <div className="max-w-5xl space-y-6">
      <Breadcrumbs
        trail={[
          { label: 'Courses', href: '/courses' },
          { label: 'Course', href: `/courses/${offeringId}` },
          { label: 'Interactive packages' },
        ]}
      />
      <div>
        <h1 className="font-serif text-2xl font-semibold">Interactive packages</h1>
        <p className="mt-1 max-w-prose text-sm text-muted">
          SCORM packages and H5P activities for {offering.course?.code ?? 'this course'}. Add one here, then link a lesson
          of type &ldquo;Interactive package&rdquo; or &ldquo;Activity&rdquo; to it in the builder. Packages run in a sandbox:
          they cannot see anything else on this site.
        </p>
      </div>

      <Panel title="Add a package">
        <div className="px-4 py-4">
          <PackageUploadForm offeringId={offeringId} />
        </div>
      </Panel>

      {packages.length === 0 ? (
        <EmptyState title="No packages yet" hint="Upload a SCORM ZIP or an .h5p file above." />
      ) : (
        packages.map((pkg) => (
          <Panel
            key={pkg.id}
            title={pkg.title}
            description={`${pkg.kind === 'SCORM' ? `SCORM ${pkg.version ?? ''}` : 'H5P'} · ${pkg._count.attempts} learners`}
          >
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2">
              <Tag tone={statusTone[pkg.status]}>{pkg.status.toLowerCase()}</Tag>
              {pkg.error && <p className="text-sm text-danger">{pkg.error}</p>}
              <ActionButton action={removePackage} hidden={{ offeringId, packageId: pkg.id }} label="Remove" variant="danger" />
            </div>
            {pkg.attempts.length === 0 ? (
              <p className="px-4 py-4 text-sm text-muted">Nobody has opened it yet.</p>
            ) : (
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase tracking-wide text-muted">
                  <tr>
                    <th className="px-4 py-2 font-medium">Learner</th>
                    <th className="px-4 py-2 font-medium">Progress</th>
                    <th className="px-4 py-2 font-medium">Score</th>
                    <th className="px-4 py-2 font-medium">Time</th>
                    <th className="px-4 py-2 font-medium">Last opened</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {pkg.attempts.map((attempt, index) => (
                    <tr key={index}>
                      <td className="px-4 py-2">{attempt.user.firstName} {attempt.user.lastName}</td>
                      <td className="px-4 py-2">
                        {[attempt.completion, attempt.success].filter((value) => value && value !== 'unknown').join(', ') || 'started'}
                      </td>
                      <td className="px-4 py-2 tabular-nums">
                        {attempt.scoreRaw !== null
                          ? `${Number(attempt.scoreRaw)}${attempt.scoreMax !== null ? ` / ${Number(attempt.scoreMax)}` : ''}`
                          : attempt.scoreScaled !== null
                            ? `${Math.round(Number(attempt.scoreScaled) * 100)}%`
                            : '—'}
                      </td>
                      <td className="px-4 py-2 tabular-nums">{minutes(attempt.totalTimeSec)}</td>
                      <td className="px-4 py-2 text-muted">{attempt.updatedAt.toLocaleString('en-ZA', { dateStyle: 'medium', timeStyle: 'short' })}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Panel>
        ))
      )}
    </div>
  );
}
