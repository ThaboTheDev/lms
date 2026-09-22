import type { Metadata } from 'next';
import Link from 'next/link';
import { requirePrincipal } from '@/lib/auth/current-user';
import { can } from '@/lib/rbac/authorize';
import { loadGradebook } from '@/server/services/gradebook';
import { Panel, Tag } from '@/components/ui/primitives';
import { Breadcrumbs } from '@/components/ui/navigation';
import { FinaliseForm } from './finalise-form';

export const metadata: Metadata = { title: 'Gradebook' };

export default async function GradebookPage({
  params,
}: {
  params: Promise<{ offeringId: string }>;
}) {
  const principal = await requirePrincipal();
  const { offeringId } = await params;
  const { offering, assessments, rows, problems } = await loadGradebook(principal, offeringId);

  return (
    <div className="space-y-6">
      <Breadcrumbs
        trail={[
          { label: 'Courses', href: '/courses' },
          { label: offering.course.code, href: `/courses/${offeringId}` },
          { label: 'Gradebook' },
        ]}
      />

      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-serif text-2xl font-semibold">Gradebook</h1>
          <p className="mt-1 max-w-prose text-sm text-muted">
            The course mark counts only assessments that have been marked, so a figure shown
            mid-semester reads as a share of the work marked so far rather than punishing a learner
            for work nobody has got to yet.
          </p>
        </div>
        <Link href={`/courses/${offeringId}/assessments`} className="text-sm text-accent underline underline-offset-2">
          Assessment plan
        </Link>
      </div>

      {problems.length > 0 && (
        <ul className="border border-line bg-surface">
          {problems.map((problem) => (
            <li key={problem} className="flex items-start gap-3 px-4 py-3 text-sm">
              <Tag tone="caution">check</Tag>
              <span>{problem}</span>
            </li>
          ))}
        </ul>
      )}

      <Panel title="Marks" description={`${rows.length} learners, ${assessments.length} assessments`}>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <caption className="sr-only">Gradebook for {offering.course.code}</caption>
            <thead>
              <tr className="border-b border-line text-left">
                <th scope="col" className="px-4 py-2.5 font-medium text-muted">Learner</th>
                {assessments.map((assessment) => (
                  <th key={assessment.id} scope="col" className="px-3 py-2.5 font-medium text-muted">
                    {assessment.title}
                    <span className="block text-xs font-normal">
                      {Number(assessment.weight)}% · out of {Number(assessment.maxMark)}
                    </span>
                  </th>
                ))}
                <th scope="col" className="px-4 py-2.5 font-medium text-muted">Course mark</th>
                <th scope="col" className="px-4 py-2.5 font-medium text-muted">Recorded</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.enrolmentId} className="border-b border-line last:border-0">
                  <th scope="row" className="px-4 py-2.5 text-left font-normal">
                    <Link href={`/students/${row.student.id}`} className="text-accent underline-offset-2 hover:underline">
                      {row.student.user.lastName}, {row.student.user.firstName}
                    </Link>
                    <span className="block text-xs text-muted tabular-nums">{row.student.studentNumber}</span>
                  </th>
                  {row.results.map((result) => (
                    <td key={result.assessmentId} className="px-3 py-2.5 tabular-nums">
                      {result.mark !== null ? result.mark : <span className="text-muted">-</span>}
                    </td>
                  ))}
                  <td className="px-4 py-2.5 tabular-nums">
                    {row.courseMark.percent !== null ? (
                      <>
                        {row.courseMark.percent}%
                        {row.courseMark.provisional && (
                          <span className="block text-xs text-caution">
                            {row.courseMark.weightOutstanding}% outstanding
                          </span>
                        )}
                      </>
                    ) : (
                      <span className="text-muted">nothing marked</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    {row.recordedMark !== null ? (
                      <>
                        <span className="tabular-nums">{row.recordedMark}%</span>
                        <span className="block text-xs text-muted">
                          {row.recordedResult.toLowerCase().replace(/_/g, ' ')}
                        </span>
                      </>
                    ) : (
                      <span className="text-muted">not finalised</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      {can(principal, 'grade.publish', { institutionId: offering.institutionId, courseOfferingId: offeringId }) && (
        <FinaliseForm offeringId={offeringId} />
      )}
    </div>
  );
}
