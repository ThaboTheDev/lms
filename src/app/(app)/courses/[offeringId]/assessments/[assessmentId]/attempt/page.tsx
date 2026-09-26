import type { Metadata } from 'next';
import { prisma } from '@/lib/db';
import { requirePrincipal } from '@/lib/auth/current-user';
import { loadAttemptForLearner } from '@/server/services/submissions';
import { learnerQuestion } from '@/server/services/attempt-form';
import { humanFileSize } from '@/lib/storage/keys';
import { Panel } from '@/components/ui/primitives';
import { Breadcrumbs } from '@/components/ui/navigation';
import { AttemptForm } from './attempt-form';
import { AssignmentSubmission } from './assignment-submission';

export const metadata: Metadata = { title: 'Attempt' };

export default async function AttemptPage({
  params,
  searchParams,
}: {
  params: Promise<{ offeringId: string; assessmentId: string }>;
  searchParams: Promise<{ id?: string }>;
}) {
  const principal = await requirePrincipal();
  const { offeringId, assessmentId } = await params;
  const { id } = await searchParams;

  if (!id) {
    return (
      <Panel title="Attempt">
        <p className="px-4 py-6 text-sm text-muted">Start the assessment from its page first.</p>
      </Panel>
    );
  }

  const { submission, paper, responses, questions, deadline } = await loadAttemptForLearner(principal, id);

  const files = await prisma.submissionFile.findMany({
    where: { submissionId: id },
    select: { fileId: true, file: { select: { originalName: true, sizeBytes: true } } },
  });

  const isQuiz = ['QUIZ', 'TEST', 'EXAMINATION'].includes(submission.assessment.type);

  return (
    <div className="max-w-3xl space-y-6">
      <Breadcrumbs
        trail={[
          { label: 'Courses', href: '/courses' },
          { label: 'Assessments', href: `/courses/${offeringId}/assessments` },
          { label: submission.assessment.title, href: `/courses/${offeringId}/assessments/${assessmentId}` },
          { label: `Attempt ${submission.attemptNumber}` },
        ]}
      />

      <div>
        <h1 className="font-serif text-2xl font-semibold">{submission.assessment.title}</h1>
        <p className="mt-1 text-sm text-muted">
          Attempt {submission.attemptNumber} · out of {Number(submission.assessment.maxMark)}
        </p>
        {deadline && (
          <p className="mt-1 text-sm">
            Closes at{' '}
            <time dateTime={deadline.toISOString()} className="font-medium">
              {deadline.toLocaleString('en-ZA', { dateStyle: 'medium', timeStyle: 'short' })}
            </time>
            . Submit before then: whatever has not been submitted or saved by that time is lost.
          </p>
        )}
      </div>

      {isQuiz ? (
        <AttemptForm
          submissionId={id}
          offeringId={offeringId}
          assessmentId={assessmentId}
          deadlineIso={deadline?.toISOString() ?? null}
          paper={paper}
          responses={responses as never}
          // Projected here, on the server: the browser gets what the learner
          // needs to answer, never what marks the answer.
          questions={questions.map((question) => learnerQuestion(question, id))}
        />
      ) : (
        <AssignmentSubmission
          submissionId={id}
          offeringId={offeringId}
          assessmentId={assessmentId}
          instructions={submission.assessment.instructions}
          files={files.map((entry) => ({
            fileId: entry.fileId,
            name: entry.file.originalName,
            size: humanFileSize(entry.file.sizeBytes),
          }))}
        />
      )}
    </div>
  );
}
