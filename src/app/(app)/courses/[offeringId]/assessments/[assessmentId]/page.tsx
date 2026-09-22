import type { Metadata } from 'next';
import Link from 'next/link';
import { prisma } from '@/lib/db';
import { requirePrincipal } from '@/lib/auth/current-user';
import { assertCanViewOffering } from '@/server/services/course-builder';
import { listSubmissions } from '@/server/services/submissions';
import { canStartAttempt } from '@/server/services/assessment-window';
import { NotFoundError } from '@/lib/errors';
import { Button, DataTable, Panel, Tag } from '@/components/ui/primitives';
import { Breadcrumbs, DescriptionList } from '@/components/ui/navigation';
import { PaperBuilder, PublishControls } from './assessment-admin';
import { beginAttempt } from '../actions';

export const metadata: Metadata = { title: 'Assessment' };

export default async function AssessmentPage({
  params,
}: {
  params: Promise<{ offeringId: string; assessmentId: string }>;
}) {
  const principal = await requirePrincipal();
  const { offeringId, assessmentId } = await params;
  const { viewer } = await assertCanViewOffering(principal, offeringId);

  if (viewer === 'staff') {
    const { assessment, submissions, enrolled, canRelease } = await listSubmissions(principal, assessmentId);

    const [questions, pools, banks] = await Promise.all([
      prisma.assessmentQuestion.findMany({
        where: { assessmentId },
        orderBy: { orderIndex: 'asc' },
        select: {
          id: true,
          mark: true,
          question: { select: { id: true, type: true, prompt: true, difficulty: true } },
        },
      }),
      prisma.questionPool.findMany({
        where: { assessmentId },
        select: { id: true, name: true, drawCount: true, markPerQuestion: true, bank: { select: { name: true } } },
      }),
      prisma.questionBank.findMany({
        where: { institutionId: assessment.institutionId },
        select: {
          id: true,
          name: true,
          questions: {
            where: { isActive: true },
            select: { id: true, type: true, prompt: true, defaultMark: true },
            take: 200,
          },
        },
      }),
    ]);

    const marked = submissions.filter((s) => s.finalMark !== null).length;
    const awaiting = submissions.filter((s) => ['SUBMITTED', 'LATE', 'UNDER_REVIEW'].includes(s.status)).length;
    const paperTotal =
      questions.reduce((sum, item) => sum + Number(item.mark), 0) +
      pools.reduce((sum, pool) => sum + pool.drawCount * Number(pool.markPerQuestion), 0);

    return (
      <div className="space-y-6">
        <Breadcrumbs
          trail={[
            { label: 'Courses', href: '/courses' },
            { label: assessment.offering.course.code, href: `/courses/${offeringId}` },
            { label: 'Assessments', href: `/courses/${offeringId}/assessments` },
            { label: assessment.title },
          ]}
        />

        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="font-serif text-2xl font-semibold">{assessment.title}</h1>
            <p className="mt-1 text-sm text-muted">
              {assessment.type.toLowerCase().replace(/_/g, ' ')} · out of {Number(assessment.maxMark)} ·{' '}
              {Number(assessment.weight)}% of the course mark
            </p>
          </div>
          <Tag tone={assessment.status === 'PUBLISHED' ? 'active' : assessment.status === 'DRAFT' ? 'caution' : 'neutral'}>
            {assessment.status.toLowerCase()}
          </Tag>
        </div>

        <div className="grid gap-px border border-line bg-line sm:grid-cols-4">
          {[
            { label: 'Enrolled', value: enrolled },
            { label: 'Submitted', value: submissions.filter((s) => s.submittedAt).length },
            { label: 'Awaiting marking', value: awaiting },
            { label: 'Marked', value: marked },
          ].map((metric) => (
            <div key={metric.label} className="bg-surface px-4 py-4">
              <p className="text-sm text-muted">{metric.label}</p>
              <p className="mt-1 font-serif text-2xl font-semibold tabular-nums">{metric.value}</p>
            </div>
          ))}
        </div>

        <PublishControls
          offeringId={offeringId}
          assessmentId={assessmentId}
          status={assessment.status}
          canRelease={canRelease}
          awaiting={awaiting}
          released={Boolean(assessment.releaseResultsAt)}
        />

        <Panel title="Setup">
          <DescriptionList
            items={[
              { term: 'Opens', value: assessment.opensAt?.toLocaleString('en-ZA', { dateStyle: 'medium', timeStyle: 'short' }) ?? 'Immediately' },
              { term: 'Due', value: assessment.dueAt?.toLocaleString('en-ZA', { dateStyle: 'medium', timeStyle: 'short' }) ?? 'Not set' },
              { term: 'Closes', value: assessment.closesAt?.toLocaleString('en-ZA', { dateStyle: 'medium', timeStyle: 'short' }) ?? 'Not set' },
              { term: 'Time limit', value: assessment.timeLimitMinutes ? `${assessment.timeLimitMinutes} minutes` : 'None' },
              { term: 'Attempts', value: assessment.maxAttempts },
              { term: 'Late work', value: assessment.allowLate ? `Accepted, ${Number(assessment.latePenaltyPct ?? 0)}% per day` : 'Not accepted' },
              { term: 'Pass mark', value: `${Number(assessment.passMark)} of ${Number(assessment.maxMark)}` },
              { term: 'Paper total', value: paperTotal ? `${paperTotal} marks across ${questions.length + pools.length} entries` : 'No questions yet' },
            ]}
          />
        </Panel>

        {['QUIZ', 'TEST', 'EXAMINATION'].includes(assessment.type) && (
          <PaperBuilder
            offeringId={offeringId}
            assessmentId={assessmentId}
            locked={submissions.some((s) => s.submittedAt !== null)}
            questions={questions.map((item) => ({
              id: item.id,
              mark: Number(item.mark),
              type: item.question?.type ?? '',
              text: ((item.question?.prompt ?? {}) as { text?: string }).text ?? '',
            }))}
            pools={pools.map((pool) => ({
              id: pool.id,
              name: pool.name,
              bank: pool.bank.name,
              drawCount: pool.drawCount,
              markPerQuestion: Number(pool.markPerQuestion),
            }))}
            banks={banks.map((bank) => ({
              id: bank.id,
              name: bank.name,
              questions: bank.questions.map((question) => ({
                id: question.id,
                type: question.type,
                text: ((question.prompt ?? {}) as { text?: string }).text ?? '',
                defaultMark: Number(question.defaultMark),
              })),
            }))}
          />
        )}

        <Panel title="Submissions" description={`${submissions.length} of ${enrolled} enrolled learners`}>
          {submissions.length === 0 ? (
            <p className="px-4 py-6 text-sm text-muted">Nothing has been submitted yet.</p>
          ) : (
            <DataTable
              caption="Submissions"
              head={['Learner', 'Student number', 'Submitted', 'Attempt', 'Mark', 'Status']}
            >
              {submissions.map((submission) => (
                <tr key={submission.id} className="border-b border-line last:border-0">
                  <td className="px-4 py-2.5">
                    <Link
                      href={`/courses/${offeringId}/assessments/${assessmentId}/submissions/${submission.id}`}
                      className="font-medium text-accent underline-offset-2 hover:underline"
                    >
                      {submission.student.user.lastName}, {submission.student.user.firstName}
                    </Link>
                  </td>
                  <td className="px-4 py-2.5 tabular-nums text-muted">{submission.student.studentNumber}</td>
                  <td className="px-4 py-2.5 tabular-nums text-muted">
                    {submission.submittedAt
                      ? submission.submittedAt.toLocaleString('en-ZA', { dateStyle: 'short', timeStyle: 'short' })
                      : 'In progress'}
                    {submission.isLate && <span className="ml-2 text-caution">late</span>}
                  </td>
                  <td className="px-4 py-2.5 tabular-nums text-muted">{submission.attemptNumber}</td>
                  <td className="px-4 py-2.5 tabular-nums">
                    {submission.finalMark !== null ? Number(submission.finalMark) : '-'}
                    {submission.grade ? ` (${submission.grade})` : ''}
                  </td>
                  <td className="px-4 py-2.5">
                    <Tag
                      tone={
                        submission.status === 'RETURNED'
                          ? 'active'
                          : submission.status === 'GRADED'
                            ? 'active'
                            : submission.status === 'IN_PROGRESS'
                              ? 'neutral'
                              : 'caution'
                      }
                    >
                      {submission.status.toLowerCase().replace(/_/g, ' ')}
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

  // ------------------------------------------------------------- learner --
  const assessment = await prisma.assessment.findFirst({
    where: { id: assessmentId, offeringId, status: { in: ['PUBLISHED', 'CLOSED'] } },
    select: {
      id: true, title: true, instructions: true, type: true, status: true,
      maxMark: true, passMark: true, weight: true, opensAt: true, dueAt: true,
      closesAt: true, timeLimitMinutes: true, maxAttempts: true, allowLate: true,
      latePenaltyPct: true, releaseResultsAt: true,
      offering: { select: { course: { select: { code: true } } } },
    },
  });
  if (!assessment) throw new NotFoundError('Assessment');

  const attempts = principal.studentId
    ? await prisma.submission.findMany({
        where: { assessmentId, studentId: principal.studentId },
        orderBy: { attemptNumber: 'asc' },
        select: {
          id: true, attemptNumber: true, status: true, startedAt: true, submittedAt: true,
          finalMark: true, grade: true, feedback: true, returnedAt: true, isLate: true,
        },
      })
    : [];

  const gate = canStartAttempt(
    {
      status: assessment.status,
      opensAt: assessment.opensAt,
      dueAt: assessment.dueAt,
      closesAt: assessment.closesAt,
      timeLimitMinutes: assessment.timeLimitMinutes,
      maxAttempts: assessment.maxAttempts,
      allowLate: assessment.allowLate,
    },
    attempts as never,
  );

  return (
    <div className="max-w-3xl space-y-6">
      <Breadcrumbs
        trail={[
          { label: 'Courses', href: '/courses' },
          { label: assessment.offering.course.code, href: `/courses/${offeringId}` },
          { label: 'Assessments', href: `/courses/${offeringId}/assessments` },
          { label: assessment.title },
        ]}
      />

      <div>
        <h1 className="font-serif text-2xl font-semibold">{assessment.title}</h1>
        <p className="mt-1 text-sm text-muted">
          Out of {Number(assessment.maxMark)} · {Number(assessment.weight)}% of your course mark
          {assessment.timeLimitMinutes ? ` · ${assessment.timeLimitMinutes} minutes once you start` : ''}
        </p>
      </div>

      <Panel title="Instructions">
        <p className="whitespace-pre-line px-4 py-4 text-sm leading-relaxed">
          {assessment.instructions ?? 'No instructions were given.'}
        </p>
        <DescriptionList
          items={[
            { term: 'Due', value: assessment.dueAt?.toLocaleString('en-ZA', { dateStyle: 'full', timeStyle: 'short' }) ?? 'No date set' },
            {
              term: 'Late work',
              value: assessment.allowLate
                ? `Accepted until ${assessment.closesAt?.toLocaleDateString('en-ZA', { dateStyle: 'long' }) ?? 'the closing date'}, losing ${Number(assessment.latePenaltyPct ?? 0)}% a day`
                : 'Not accepted after the due date',
            },
            { term: 'Attempts', value: `${attempts.length} used of ${assessment.maxAttempts}` },
          ]}
        />
      </Panel>

      {attempts.length > 0 && (
        <Panel title="Your attempts">
          <ul className="divide-y divide-line">
            {attempts.map((attempt) => (
              <li key={attempt.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
                <div>
                  <p className="font-medium">
                    Attempt {attempt.attemptNumber}
                    {attempt.isLate ? ' · submitted late' : ''}
                  </p>
                  <p className="text-xs text-muted">
                    {attempt.submittedAt
                      ? `Submitted ${attempt.submittedAt.toLocaleString('en-ZA', { dateStyle: 'medium', timeStyle: 'short' })}`
                      : 'Not submitted'}
                  </p>
                  {attempt.returnedAt && attempt.feedback && (
                    <p className="mt-1 max-w-prose text-muted">{attempt.feedback}</p>
                  )}
                </div>
                <div className="text-right">
                  {attempt.returnedAt ? (
                    <p className="font-serif text-xl font-semibold tabular-nums">
                      {Number(attempt.finalMark)} / {Number(assessment.maxMark)}
                      {attempt.grade ? <span className="block text-xs text-muted">{attempt.grade}</span> : null}
                    </p>
                  ) : (
                    <Tag tone="neutral">
                      {attempt.status === 'IN_PROGRESS' ? 'in progress' : 'awaiting marking'}
                    </Tag>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {gate.can === 'no' ? (
        <p className="border-l-2 border-line bg-paper px-4 py-3 text-sm text-muted">{gate.reason}</p>
      ) : (
        <form action={beginAttempt}>
          <input type="hidden" name="assessmentId" value={assessmentId} />
          <input type="hidden" name="offeringId" value={offeringId} />
          {gate.can === 'start' && gate.lateWarning && (
            <p className="mb-3 border-l-2 border-caution bg-caution/5 px-4 py-3 text-sm text-caution">
              The due date has passed. You can still submit, but a late penalty will be applied.
            </p>
          )}
          <Button type="submit">
            {gate.can === 'resume' ? 'Continue your attempt' : 'Start'}
          </Button>
        </form>
      )}
    </div>
  );
}
