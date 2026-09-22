import type { Metadata } from 'next';
import Link from 'next/link';
import { requirePrincipal } from '@/lib/auth/current-user';
import { can } from '@/lib/rbac/authorize';
import { markingQueue } from '@/server/services/assessments';
import { myResults } from '@/server/services/gradebook';
import { DataTable, EmptyState, Panel, Tag } from '@/components/ui/primitives';

export const metadata: Metadata = { title: 'Assessments' };

export default async function AssessmentsPage() {
  const principal = await requirePrincipal();

  if (can(principal, 'submission.grade')) {
    const queue = await markingQueue(principal);

    return (
      <div className="space-y-6">
        <div>
          <h1 className="font-serif text-2xl font-semibold">Marking</h1>
          <p className="mt-1 text-sm text-muted">
            {queue.length === 0
              ? 'Nothing is waiting for you.'
              : `${queue.length} submissions waiting, oldest first.`}
          </p>
        </div>

        <Panel>
          {queue.length === 0 ? (
            <EmptyState
              title="The queue is clear"
              hint="Submissions appear here as learners hand work in on your courses."
            />
          ) : (
            <DataTable
              caption="Submissions awaiting marking"
              head={['Learner', 'Course', 'Assessment', 'Submitted', 'Auto mark', 'Status']}
            >
              {queue.map((submission) => (
                <tr key={submission.id} className="border-b border-line last:border-0">
                  <td className="px-4 py-2.5">
                    <Link
                      href={`/courses/${submission.assessment.offering.id}/assessments/${submission.assessment.id}/submissions/${submission.id}`}
                      className="font-medium text-accent underline-offset-2 hover:underline"
                    >
                      {submission.student.user.lastName}, {submission.student.user.firstName}
                    </Link>
                    <span className="block text-xs tabular-nums text-muted">
                      {submission.student.studentNumber}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-muted">{submission.assessment.offering.course.code}</td>
                  <td className="px-4 py-2.5">{submission.assessment.title}</td>
                  <td className="px-4 py-2.5 tabular-nums text-muted">
                    {submission.submittedAt?.toLocaleDateString('en-ZA', { day: '2-digit', month: 'short' })}
                  </td>
                  <td className="px-4 py-2.5 tabular-nums text-muted">
                    {submission.autoMark !== null ? Number(submission.autoMark) : '-'}
                  </td>
                  <td className="px-4 py-2.5">
                    <Tag tone={submission.isLate ? 'caution' : 'neutral'}>
                      {submission.isLate ? 'late' : submission.status.toLowerCase()}
                    </Tag>
                  </td>
                </tr>
              ))}
            </DataTable>
          )}
        </Panel>
      </div>
    );
  }

  const courses = await myResults(principal);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-serif text-2xl font-semibold">Your assessments</h1>
        <p className="mt-1 max-w-prose text-sm text-muted">
          Marks appear once your lecturer releases the results for the whole class. The running mark
          counts only what has been released.
        </p>
      </div>

      {courses.length === 0 ? (
        <Panel>
          <EmptyState title="No courses yet" hint="Assessments appear here once you are registered for courses." />
        </Panel>
      ) : (
        courses.map((course) => (
          <Panel
            key={course.id}
            title={`${course.offering.course.code} · ${course.offering.course.title}`}
            description={`${course.offering.academicTerm.name} ${course.offering.academicTerm.academicYear.year}`}
            action={
              course.runningMark.percent !== null ? (
                <span className="font-serif text-lg tabular-nums">
                  {course.runningMark.percent}%
                  <span className="block text-xs font-normal text-muted">
                    {course.runningMark.provisional ? 'of the work released so far' : 'final'}
                  </span>
                </span>
              ) : undefined
            }
          >
            {course.assessmentResults.length === 0 ? (
              <p className="px-4 py-4 text-sm text-muted">No assessments published yet.</p>
            ) : (
              <ul className="divide-y divide-line">
                {course.assessmentResults.map((result) => (
                  <li key={result.assessmentId} className="flex items-center justify-between px-4 py-3 text-sm">
                    <div>
                      <Link
                        href={`/courses/${course.offering.id}/assessments/${result.assessmentId}`}
                        className="text-accent underline-offset-2 hover:underline"
                      >
                        {result.title}
                      </Link>
                      <span className="block text-xs text-muted">
                        {result.weight}% of the course · out of {result.maxMark}
                      </span>
                    </div>
                    <span className="tabular-nums">
                      {result.mark !== null ? (
                        `${result.mark} / ${result.maxMark}`
                      ) : (
                        <Tag tone="neutral">not released</Tag>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        ))
      )}
    </div>
  );
}
