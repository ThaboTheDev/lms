import type { Metadata } from 'next';
import Link from 'next/link';
import { requirePrincipal } from '@/lib/auth/current-user';
import { can } from '@/lib/rbac/authorize';
import { listCourseAssessments } from '@/server/services/assessments';
import { describeState } from '@/server/services/assessment-window';
import { DataTable, EmptyState, Panel, Tag } from '@/components/ui/primitives';
import { Breadcrumbs } from '@/components/ui/navigation';
import { NewAssessmentForm } from './assessment-forms';

export const metadata: Metadata = { title: 'Assessments' };

export default async function CourseAssessmentsPage({
  params,
}: {
  params: Promise<{ offeringId: string }>;
}) {
  const principal = await requirePrincipal();
  const { offeringId } = await params;
  const { offering, viewer, assessments, problems } = await listCourseAssessments(principal, offeringId);
  // Staff who manage the course without marking rights (an institution
  // administrator, say) can see the plan but not the scripts: no dead links.
  const readsWork = viewer === 'learner' || can(principal, 'submission.read', {
    institutionId: offering.institutionId,
    courseOfferingId: offeringId,
  });

  return (
    <div className="space-y-6">
      <Breadcrumbs
        trail={[
          { label: 'Courses', href: '/courses' },
          { label: offering.course.code, href: `/courses/${offeringId}` },
          { label: 'Assessments' },
        ]}
      />

      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-serif text-2xl font-semibold">Assessments</h1>
          <p className="mt-1 text-sm text-muted">
            {offering.course.code} · {offering.academicTerm.name} {offering.academicTerm.academicYear.year}
          </p>
        </div>
        {viewer === 'staff' && readsWork && (
          <Link href={`/courses/${offeringId}/gradebook`} className="text-sm text-accent underline underline-offset-2">
            Open the gradebook
          </Link>
        )}
      </div>

      {problems.length > 0 && (
        <Panel title="Assessment plan">
          <ul className="divide-y divide-line">
            {problems.map((problem) => (
              <li key={problem} className="flex items-start gap-3 px-4 py-3 text-sm">
                <Tag tone="caution">check</Tag>
                <span>{problem}</span>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <Panel title={viewer === 'learner' ? 'Your assessments' : 'Assessment plan'}>
        {assessments.length === 0 ? (
          <EmptyState
            title="Nothing set yet"
            hint={
              viewer === 'staff'
                ? 'Add the assignments, tests and examination that make up this course.'
                : 'Your lecturer has not published any assessments for this course.'
            }
          />
        ) : (
          <DataTable
            caption="Assessments"
            head={
              viewer === 'learner'
                ? ['Assessment', 'Type', 'Due', 'Weight', 'Status']
                : ['Assessment', 'Type', 'Due', 'Weight', 'Out of', 'Submissions', 'Status']
            }
          >
            {assessments.map((assessment) => {
              const submissions = (assessment as { submissions?: unknown[] }).submissions ?? [];
              const learnerState = describeState(
                {
                  status: assessment.status,
                  opensAt: assessment.opensAt,
                  dueAt: assessment.dueAt,
                  closesAt: assessment.closesAt,
                  timeLimitMinutes: assessment.timeLimitMinutes,
                  maxAttempts: assessment.maxAttempts,
                  allowLate: assessment.allowLate,
                },
                submissions as never,
                Boolean(assessment.releaseResultsAt),
              );

              return (
                <tr key={assessment.id} className="border-b border-line last:border-0">
                  <td className="px-4 py-2.5">
                    {readsWork ? (
                      <Link
                        href={`/courses/${offeringId}/assessments/${assessment.id}`}
                        className="font-medium text-accent underline-offset-2 hover:underline"
                      >
                        {assessment.title}
                      </Link>
                    ) : (
                      <span className="font-medium">{assessment.title}</span>
                    )}
                    <span className="block text-xs text-muted">
                      {assessment.category.toLowerCase()}
                      {assessment.timeLimitMinutes ? ` · ${assessment.timeLimitMinutes} minutes` : ''}
                      {assessment.maxAttempts > 1 ? ` · ${assessment.maxAttempts} attempts` : ''}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-muted">{assessment.type.toLowerCase().replace(/_/g, ' ')}</td>
                  <td className="px-4 py-2.5 tabular-nums text-muted">
                    {assessment.dueAt
                      ? assessment.dueAt.toLocaleDateString('en-ZA', { day: '2-digit', month: 'short' })
                      : 'No date'}
                  </td>
                  <td className="px-4 py-2.5 tabular-nums">{Number(assessment.weight)}%</td>
                  {viewer === 'staff' && (
                    <>
                      <td className="px-4 py-2.5 tabular-nums text-muted">{Number(assessment.maxMark)}</td>
                      <td className="px-4 py-2.5 tabular-nums text-muted">{assessment._count.submissions}</td>
                    </>
                  )}
                  <td className="px-4 py-2.5">
                    {viewer === 'learner' ? (
                      <Tag tone={learnerState.tone}>{learnerState.label}</Tag>
                    ) : (
                      <Tag tone={assessment.status === 'PUBLISHED' ? 'active' : assessment.status === 'DRAFT' ? 'caution' : 'neutral'}>
                        {assessment.status.toLowerCase()}
                      </Tag>
                    )}
                  </td>
                </tr>
              );
            })}
          </DataTable>
        )}
      </Panel>

      {viewer === 'staff' && (
        <Panel title="Add an assessment" description="It stays a draft until you publish it.">
          <div className="px-4 py-4">
            <NewAssessmentForm offeringId={offeringId} />
          </div>
        </Panel>
      )}
    </div>
  );
}
