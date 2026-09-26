import type { Metadata } from 'next';
import Link from 'next/link';
import { requirePrincipal } from '@/lib/auth/current-user';
import { can } from '@/lib/rbac/authorize';
import { openModeration } from '@/server/services/moderation';
import { toPercent } from '@/server/services/grading-rules';
import { DataTable, Panel, Tag } from '@/components/ui/primitives';
import { Breadcrumbs, DescriptionList } from '@/components/ui/navigation';
import { AdjustmentForm, ModerationForm } from './moderation-forms';

export const metadata: Metadata = { title: 'Moderation' };

const reasonLabels: Record<string, string> = {
  highest: 'highest mark',
  lowest: 'lowest mark',
  borderline: 'near the pass mark',
  failure: 'a failure',
  distinction: 'a distinction',
  spread: 'spread across the cohort',
};

export default async function ModerationPage({
  params,
}: {
  params: Promise<{ assessmentId: string }>;
}) {
  const principal = await requirePrincipal();
  const { assessmentId } = await params;
  const { assessment, submissions, sample, maxMark } = await openModeration(principal, assessmentId);

  const hasExternal = assessment.moderations.some(
    (record) => record.type === 'EXTERNAL' && record.outcome !== 'REJECTED',
  );

  return (
    <div className="space-y-6">
      <Breadcrumbs
        trail={[{ label: 'Quality assurance', href: '/quality' }, { label: assessment.title }]}
      />

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-serif text-2xl font-semibold">{assessment.title}</h1>
          <p className="mt-1 text-sm text-muted">
            {assessment.offering.course.code} · {submissions.length} marked submissions · out of {maxMark}
          </p>
        </div>
        <Tag tone={assessment.releaseResultsAt ? 'active' : 'neutral'}>
          {assessment.releaseResultsAt ? 'results released' : 'results held'}
        </Tag>
      </div>

      {assessment.releaseResultsAt && assessment.moderations.length === 0 && (
        <p className="border-l-2 border-danger bg-danger/5 px-4 py-3 text-sm text-danger">
          Results for this assessment were released to learners before any moderation was recorded.
          Moderating now is still worth doing, and the sequence stays visible in the audit log.
        </p>
      )}

      <Panel
        title="The sample"
        description={`${sample.length} scripts drawn from ${submissions.length}. The same sample is drawn every time this page is opened.`}
      >
        {sample.length === 0 ? (
          <p className="px-4 py-6 text-sm text-muted">Nothing has been marked yet.</p>
        ) : (
          <DataTable caption="Moderation sample" head={['Student number', 'Mark', 'Percent', 'Why it was drawn']}>
            {sample.map((entry) => (
              <tr key={entry.submissionId} className="border-b border-line last:border-0">
                <td className="px-4 py-2.5 tabular-nums">{entry.studentNumber}</td>
                <td className="px-4 py-2.5 tabular-nums">
                  {Math.round((entry.markPercent / 100) * maxMark * 100) / 100}
                </td>
                <td className="px-4 py-2.5 tabular-nums">{entry.markPercent}%</td>
                <td className="px-4 py-2.5 text-muted">{reasonLabels[entry.reason] ?? entry.reason}</td>
              </tr>
            ))}
          </DataTable>
        )}
      </Panel>

      <div className="grid gap-6 lg:grid-cols-[1.3fr_1fr]">
        <ModerationForm
          assessmentId={assessmentId}
          maxMark={maxMark}
          sample={sample.map((entry) => ({
            submissionId: entry.submissionId,
            studentNumber: entry.studentNumber,
            assessorMark: Math.round((entry.markPercent / 100) * maxMark * 100) / 100,
          }))}
        />

        <div className="space-y-6">
          <Panel title="Moderation history">
            {assessment.moderations.length === 0 ? (
              <p className="px-4 py-6 text-sm text-muted">Nothing recorded yet.</p>
            ) : (
              <ol className="divide-y divide-line">
                {assessment.moderations.map((record) => (
                  <li key={record.id} className="px-4 py-3 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium">
                        {record.type.toLowerCase().replace(/_/g, ' ')}
                      </span>
                      <Tag
                        tone={
                          record.outcome === 'APPROVED'
                            ? 'active'
                            : record.outcome === 'REJECTED'
                              ? 'danger'
                              : 'caution'
                        }
                      >
                        {record.outcome.toLowerCase().replace(/_/g, ' ')}
                      </Tag>
                    </div>
                    <p className="mt-0.5 text-xs text-muted">
                      {record.moderator.firstName} {record.moderator.lastName} ·{' '}
                      {record.moderatedAt.toLocaleDateString('en-ZA', { dateStyle: 'medium' })}
                      {record.sampleSize ? ` · ${record.sampleSize} scripts` : ''}
                    </p>
                    {record.comments && <p className="mt-1 text-muted">{record.comments}</p>}
                  </li>
                ))}
              </ol>
            )}
          </Panel>

          <Panel title="Assessment">
            <DescriptionList
              items={[
                { term: 'Type', value: assessment.type.toLowerCase().replace(/_/g, ' ') },
                { term: 'Out of', value: maxMark },
                { term: 'Pass mark', value: `${Number(assessment.passMark)} (${toPercent(Number(assessment.passMark), maxMark)}%)` },
                {
                  term: 'Marking',
                  value:
                    can(principal, 'course.manage', { institutionId: assessment.institutionId, courseOfferingId: assessment.offering.id }) &&
                    can(principal, 'submission.read', { institutionId: assessment.institutionId, courseOfferingId: assessment.offering.id }) ? (
                      <Link
                        href={`/courses/${assessment.offering.id}/assessments/${assessmentId}`}
                        className="text-accent underline underline-offset-2"
                      >
                        Open the assessment
                      </Link>
                    ) : (
                      'Marked by the course team; the sample below is what you moderate'
                    ),
                },
              ]}
            />
          </Panel>

          <AdjustmentForm
            assessmentId={assessmentId}
            hasExternalModeration={hasExternal}
            cohortSize={submissions.length}
          />
        </div>
      </div>
    </div>
  );
}
