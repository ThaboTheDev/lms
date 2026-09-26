import type { Metadata } from 'next';
import { requirePrincipal } from '@/lib/auth/current-user';
import { loadSurvey } from '@/server/services/surveys';
import { MINIMUM_RESPONSES_FOR_RESULTS, RATING_LABELS } from '@/server/services/survey-rules';
import { Panel, Tag } from '@/components/ui/primitives';
import { Breadcrumbs } from '@/components/ui/navigation';
import { ActionButton, ActionForm } from '@/components/ui/action-form';
import { changeSurveyStatus, deleteSurveyQuestion, newSurveyQuestion } from '../actions';
import { SurveyResponseForm } from '../response-form';

export const metadata: Metadata = { title: 'Survey' };

export default async function SurveyPage({ params }: { params: Promise<{ offeringId: string; surveyId: string }> }) {
  const principal = await requirePrincipal();
  const { offeringId, surveyId } = await params;
  const { survey, viewer, answered, open, results } = await loadSurvey(principal, surveyId);
  const hidden = { offeringId, surveyId };

  return (
    <div className="max-w-4xl space-y-6">
      <Breadcrumbs
        trail={[
          { label: 'Courses', href: '/courses' },
          { label: 'Course', href: `/courses/${offeringId}` },
          { label: 'Surveys', href: `/courses/${offeringId}/surveys` },
          { label: survey.title },
        ]}
      />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-serif text-2xl font-semibold">{survey.title}</h1>
          {survey.description && <p className="mt-1 max-w-prose text-sm text-muted">{survey.description}</p>}
        </div>
        <Tag tone={survey.status === 'OPEN' ? 'active' : survey.status === 'CLOSED' ? 'caution' : 'neutral'}>{survey.status.toLowerCase()}</Tag>
      </div>

      {viewer === 'learner' && (
        <Panel title="Your response">
          <div className="px-4 py-4">
            {answered ? (
              <p className="text-sm">You have answered this survey. Thank you.</p>
            ) : open ? (
              <SurveyResponseForm offeringId={offeringId} surveyId={surveyId} anonymous={survey.isAnonymous} questions={survey.questions} />
            ) : (
              <p className="text-sm text-muted">This survey is not taking responses.</p>
            )}
          </div>
        </Panel>
      )}

      {viewer === 'staff' && (
        <>
          <Panel
            title="Questions"
            description={survey._count.responses > 0 ? 'People have answered, so the questions are fixed.' : 'Ratings use a five point scale from strongly disagree to strongly agree.'}
          >
            <ol className="divide-y divide-line">
              {survey.questions.map((question, index) => (
                <li key={question.id} className="flex items-start justify-between gap-3 px-4 py-3 text-sm">
                  <div>
                    <p>{index + 1}. {question.prompt}</p>
                    <p className="text-xs text-muted">
                      {question.type === 'RATING' ? 'Rating' : question.type === 'CHOICE' ? `Choice: ${question.options.join(' / ')}` : 'Comment'}
                      {question.isRequired ? '' : ' · optional'}
                    </p>
                  </div>
                  {survey._count.responses === 0 && (
                    <ActionButton action={deleteSurveyQuestion} hidden={{ ...hidden, questionId: question.id }} label="Remove" variant="ghost" />
                  )}
                </li>
              ))}
              {survey.questions.length === 0 && <li className="px-4 py-4 text-sm text-muted">No questions yet.</li>}
            </ol>
            <div className="flex flex-wrap gap-2 border-t border-line px-4 py-3">
              {survey.status !== 'OPEN' && (
                <ActionButton action={changeSurveyStatus} hidden={{ ...hidden, status: 'OPEN' }} label={survey.status === 'CLOSED' ? 'Reopen' : 'Open to learners'} variant="primary" />
              )}
              {survey.status === 'OPEN' && <ActionButton action={changeSurveyStatus} hidden={{ ...hidden, status: 'CLOSED' }} label="Close the survey" />}
            </div>
          </Panel>

          {survey._count.responses === 0 && (
            <ActionForm
              title="Add a question"
              action={newSurveyQuestion}
              submitLabel="Add"
              fields={[
                { name: 'offeringId', label: '', type: 'hidden', defaultValue: offeringId },
                { name: 'surveyId', label: '', type: 'hidden', defaultValue: surveyId },
                { name: 'prompt', label: 'Question', required: true, wide: true, placeholder: 'The lectures helped me understand the material.' },
                {
                  name: 'type',
                  label: 'Answered with',
                  type: 'select',
                  defaultValue: 'RATING',
                  options: [
                    { value: 'RATING', label: 'A rating, strongly disagree to strongly agree' },
                    { value: 'CHOICE', label: 'One of several options' },
                    { value: 'TEXT', label: 'A comment' },
                  ],
                },
                { name: 'isRequired', label: 'Required', type: 'checkbox', defaultValue: true },
                { name: 'options', label: 'Options (for a choice question)', type: 'textarea', rows: 3, wide: true, hint: 'One per line.' },
              ]}
            />
          )}

          <Panel title="Results" description={`${survey._count.responses} responses`}>
            {!results || !results.shown ? (
              <p className="px-4 py-4 text-sm text-muted">
                Results appear once {MINIMUM_RESPONSES_FOR_RESULTS} people have answered: with fewer, an anonymous answer could be traced to its author.
              </p>
            ) : (
              <ol className="divide-y divide-line">
                {results.questions.map((result, index) => {
                  const question = survey.questions.find((candidate) => candidate.id === result.questionId)!;
                  return (
                    <li key={result.questionId} className="space-y-2 px-4 py-4 text-sm">
                      <p className="font-medium">{index + 1}. {question.prompt}</p>
                      {result.type === 'RATING' && (
                        <>
                          <p className="text-muted">Average {result.mean ?? '—'} out of 5, from {result.answered} answers</p>
                          <ul className="space-y-1">
                            {Object.entries(result.distribution).map(([point, count]) => (
                              <li key={point} className="flex items-center gap-2">
                                <span className="w-36 text-xs text-muted">{RATING_LABELS[Number(point)]}</span>
                                <span className="h-2 bg-[rgb(var(--brand))]" style={{ width: `${result.answered ? (count / result.answered) * 60 : 0}%` }} aria-hidden />
                                <span className="tabular-nums text-xs">{count}</span>
                              </li>
                            ))}
                          </ul>
                        </>
                      )}
                      {result.type === 'CHOICE' && (
                        <ul className="space-y-1">
                          {Object.entries(result.counts).map(([option, count]) => (
                            <li key={option} className="flex justify-between"><span>{option}</span><span className="tabular-nums">{count}</span></li>
                          ))}
                        </ul>
                      )}
                      {result.type === 'TEXT' && (
                        <ul className="space-y-2">
                          {result.comments.map((comment, commentIndex) => (
                            <li key={commentIndex} className="border-l-2 border-line pl-3">{comment}</li>
                          ))}
                          {result.comments.length === 0 && <li className="text-muted">No comments.</li>}
                        </ul>
                      )}
                    </li>
                  );
                })}
              </ol>
            )}
          </Panel>
        </>
      )}
    </div>
  );
}
