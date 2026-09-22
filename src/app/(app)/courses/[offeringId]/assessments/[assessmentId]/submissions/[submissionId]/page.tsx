import type { Metadata } from 'next';
import { requirePrincipal } from '@/lib/auth/current-user';
import { loadSubmissionForMarking } from '@/server/services/submissions';
import { humanFileSize } from '@/lib/storage/keys';
import { Panel, Tag } from '@/components/ui/primitives';
import { Breadcrumbs } from '@/components/ui/navigation';
import { MarkingForm } from './marking-form';

export const metadata: Metadata = { title: 'Marking' };

export default async function MarkingPage({
  params,
}: {
  params: Promise<{ offeringId: string; assessmentId: string; submissionId: string }>;
}) {
  const principal = await requirePrincipal();
  const { offeringId, assessmentId, submissionId } = await params;
  const { submission, paper, questions, canGrade } = await loadSubmissionForMarking(principal, submissionId);

  const assessment = submission.assessment;
  const answers = (submission.answers ?? {}) as { responses?: Record<string, unknown> };

  return (
    <div className="space-y-6">
      <Breadcrumbs
        trail={[
          { label: 'Courses', href: '/courses' },
          { label: assessment.offering.course.code, href: `/courses/${offeringId}` },
          { label: 'Assessments', href: `/courses/${offeringId}/assessments` },
          { label: assessment.title, href: `/courses/${offeringId}/assessments/${assessmentId}` },
          { label: submission.student.studentNumber },
        ]}
      />

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-serif text-2xl font-semibold">
            {submission.student.user.firstName} {submission.student.user.lastName}
          </h1>
          <p className="mt-1 text-sm text-muted">
            {submission.student.studentNumber} · attempt {submission.attemptNumber} ·{' '}
            {submission.submittedAt
              ? submission.submittedAt.toLocaleString('en-ZA', { dateStyle: 'medium', timeStyle: 'short' })
              : 'not submitted'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {submission.isLate && <Tag tone="caution">late</Tag>}
          <Tag tone={submission.returnedAt ? 'active' : 'neutral'}>
            {submission.status.toLowerCase().replace(/_/g, ' ')}
          </Tag>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <div className="space-y-6">
          {submission.files.length > 0 && (
            <Panel title="Submitted work">
              <ul className="divide-y divide-line">
                {submission.files.map((entry) => (
                  <li key={entry.fileId} className="flex items-center justify-between px-4 py-3 text-sm">
                    <a
                      href={`/api/v1/files/${entry.fileId}/download`}
                      className="text-accent underline underline-offset-2"
                    >
                      {entry.file.originalName}
                    </a>
                    <span className="text-xs text-muted">
                      {humanFileSize(entry.file.sizeBytes)}
                      {entry.file.scanStatus === 'INFECTED' ? ' · withheld by the scan' : ''}
                    </span>
                  </li>
                ))}
              </ul>
            </Panel>
          )}

          {paper.length > 0 && (
            <Panel
              title="Answers"
              description={`Auto marked: ${Number(submission.autoMark ?? 0)} of the machine-markable questions`}
            >
              <ol className="divide-y divide-line">
                {paper.map((item, index) => {
                  const question = questions.find((candidate) => candidate.id === item.questionId);
                  if (!question) return null;
                  const response = submission.responses.find((r) => r.questionId === question.id);
                  const given = (answers.responses ?? {})[question.id];

                  return (
                    <li key={question.id} className="space-y-2 px-4 py-4 text-sm">
                      <div className="flex items-start justify-between gap-3">
                        <p className="font-medium">
                          {index + 1}. {((question.prompt ?? {}) as { text?: string }).text}
                        </p>
                        <span className="shrink-0 tabular-nums text-muted">
                          {response?.awardedMark !== null && response?.awardedMark !== undefined
                            ? `${Number(response.awardedMark)} / ${item.mark}`
                            : `unmarked / ${item.mark}`}
                        </span>
                      </div>

                      <p className="text-muted">
                        Answer given: <span className="text-ink">{JSON.stringify(given) ?? 'none'}</span>
                      </p>

                      {question.options.some((option) => option.isCorrect) && (
                        <p className="text-xs text-muted">
                          Correct:{' '}
                          {question.options
                            .filter((option) => option.isCorrect)
                            .map((option) => option.content)
                            .join(', ')}
                        </p>
                      )}
                    </li>
                  );
                })}
              </ol>
            </Panel>
          )}

          <Panel title="History">
            <ol className="divide-y divide-line">
              {submission.events.map((event) => (
                <li key={event.id} className="px-4 py-3 text-sm">
                  <p>{event.action.replace(/[._]/g, ' ')}</p>
                  {event.note && <p className="text-muted">{event.note}</p>}
                  <p className="text-xs text-muted">
                    {event.createdAt.toLocaleString('en-ZA', { dateStyle: 'medium', timeStyle: 'short' })}
                  </p>
                </li>
              ))}
            </ol>
          </Panel>
        </div>

        <div>
          {canGrade ? (
            <MarkingForm
              submissionId={submissionId}
              offeringId={offeringId}
              maxMark={Number(assessment.maxMark)}
              autoMark={submission.autoMark !== null ? Number(submission.autoMark) : null}
              currentMark={submission.finalMark !== null ? Number(submission.finalMark) : null}
              currentFeedback={submission.feedback}
              isLate={submission.isLate}
              latePenaltyPct={assessment.latePenaltyPct ? Number(assessment.latePenaltyPct) : null}
              rubric={
                assessment.rubric
                  ? {
                      title: assessment.rubric.title,
                      criteria: assessment.rubric.criteria.map((criterion) => ({
                        id: criterion.id,
                        title: criterion.title,
                        description: criterion.description,
                        weight: Number(criterion.weight),
                        maxScore: Number(criterion.maxScore),
                        levels: criterion.levels.map((level) => ({
                          id: level.id,
                          label: level.label,
                          descriptor: level.descriptor,
                          score: Number(level.score),
                        })),
                        current:
                          submission.rubricScores.find((score) => score.criterionId === criterion.id)?.score !== undefined
                            ? Number(submission.rubricScores.find((score) => score.criterionId === criterion.id)!.score)
                            : null,
                      })),
                    }
                  : null
              }
            />
          ) : (
            <Panel title="Marking">
              <p className="px-4 py-6 text-sm text-muted">
                You can read this submission but not mark it.
              </p>
            </Panel>
          )}
        </div>
      </div>
    </div>
  );
}
