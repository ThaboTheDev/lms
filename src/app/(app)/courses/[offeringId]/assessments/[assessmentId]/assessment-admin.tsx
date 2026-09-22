'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { Button, Field, Input, Panel, Tag } from '@/components/ui/primitives';
import { FormMessage, Select } from '@/components/ui/form';
import type { FormState } from '@/lib/validation/common';
import { addQuestionPool, addQuestionToAssessment, publish, release } from '../actions';

function Submit({ label, variant }: { label: string; variant?: 'primary' | 'secondary' }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" variant={variant} disabled={pending}>
      {pending ? 'Working' : label}
    </Button>
  );
}

export function PublishControls({
  offeringId,
  assessmentId,
  status,
  canRelease,
  awaiting,
  released,
}: {
  offeringId: string;
  assessmentId: string;
  status: string;
  canRelease: boolean;
  awaiting: number;
  released: boolean;
}) {
  const [state, action] = useActionState<FormState, FormData>(release, {});

  return (
    <div className="space-y-3 border border-line bg-surface px-4 py-4">
      <FormMessage status={state.status} message={state.message} />

      {status === 'DRAFT' && (
        <form action={publish} className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted">
            Learners cannot see this assessment until it is published. Publishing also puts the due
            date on their calendar.
          </p>
          <input type="hidden" name="assessmentId" value={assessmentId} />
          <input type="hidden" name="offeringId" value={offeringId} />
          <Submit label="Publish to learners" />
        </form>
      )}

      {status === 'PUBLISHED' && canRelease && (
        <form action={action} className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted">
            {awaiting > 0
              ? `${awaiting} submissions are still unmarked. Results can be released once marking is done.`
              : 'Marking is done. Releasing shows every learner their mark and feedback at the same time.'}
          </p>
          <input type="hidden" name="assessmentId" value={assessmentId} />
          <input type="hidden" name="offeringId" value={offeringId} />
          <Submit label="Release results" />
        </form>
      )}

      {released && (
        <p className="text-sm text-muted">
          Results have been released. Learners can see their marks and feedback.
        </p>
      )}
    </div>
  );
}

interface BankOption {
  id: string;
  name: string;
  questions: { id: string; type: string; text: string; defaultMark: number }[];
}

export function PaperBuilder({
  offeringId,
  assessmentId,
  locked,
  questions,
  pools,
  banks,
}: {
  offeringId: string;
  assessmentId: string;
  locked: boolean;
  questions: { id: string; mark: number; type: string; text: string }[];
  pools: { id: string; name: string; bank: string; drawCount: number; markPerQuestion: number }[];
  banks: BankOption[];
}) {
  const [questionState, addQuestion] = useActionState<FormState, FormData>(addQuestionToAssessment, {});
  const [poolState, addPool] = useActionState<FormState, FormData>(addQuestionPool, {});
  const [bankId, setBankId] = useState(banks[0]?.id ?? '');

  const bank = banks.find((candidate) => candidate.id === bankId);

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Panel
        title="The paper"
        description={`${questions.length} fixed questions, ${pools.length} pools`}
      >
        {questions.length === 0 && pools.length === 0 ? (
          <p className="px-4 py-6 text-sm text-muted">
            No questions yet. Add them from a bank, or set up a pool so each learner draws a
            different paper.
          </p>
        ) : (
          <ol className="divide-y divide-line">
            {questions.map((question, index) => (
              <li key={question.id} className="flex items-start gap-3 px-4 py-3 text-sm">
                <span className="text-muted">{index + 1}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate">{question.text}</p>
                  <p className="text-xs text-muted">{question.type.toLowerCase().replace(/_/g, ' ')}</p>
                </div>
                <span className="tabular-nums text-muted">{question.mark}</span>
              </li>
            ))}
            {pools.map((pool) => (
              <li key={pool.id} className="flex items-start gap-3 px-4 py-3 text-sm">
                <Tag tone="active">pool</Tag>
                <div className="min-w-0 flex-1">
                  <p>{pool.name}</p>
                  <p className="text-xs text-muted">
                    {pool.drawCount} drawn from {pool.bank}, {pool.markPerQuestion} marks each
                  </p>
                </div>
                <span className="tabular-nums text-muted">{pool.drawCount * pool.markPerQuestion}</span>
              </li>
            ))}
          </ol>
        )}
      </Panel>

      <div className="space-y-6">
        {locked ? (
          <Panel title="Questions are fixed">
            <p className="px-4 py-6 text-sm text-muted">
              Learners have already sat this assessment, so the paper cannot change. Correct a
              question in the bank and re-mark, or moderate the marks instead.
            </p>
          </Panel>
        ) : (
          <>
            <Panel title="Add a question">
              <form action={addQuestion} className="space-y-3 px-4 py-4">
                <FormMessage status={questionState.status} message={questionState.message} />
                <input type="hidden" name="assessmentId" value={assessmentId} />
                <input type="hidden" name="offeringId" value={offeringId} />

                <Field label="Bank" htmlFor="bankId-question">
                  <Select
                    id="bankId-question"
                    value={bankId}
                    onChange={(event) => setBankId(event.target.value)}
                  >
                    {banks.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.name}
                      </option>
                    ))}
                  </Select>
                </Field>

                <Field label="Question" htmlFor="questionId">
                  <Select id="questionId" name="questionId" required defaultValue="">
                    <option value="" disabled>
                      Choose a question
                    </option>
                    {(bank?.questions ?? []).map((question) => (
                      <option key={question.id} value={question.id}>
                        {question.text.slice(0, 80)}
                      </option>
                    ))}
                  </Select>
                </Field>

                <Field label="Mark" htmlFor="mark" hint="Blank uses the bank default">
                  <Input id="mark" name="mark" type="number" min={0} max={100} step="0.5" />
                </Field>

                <Submit label="Add to paper" />
              </form>
            </Panel>

            <Panel title="Add a pool" description="Each learner draws their own questions from it.">
              <form action={addPool} className="space-y-3 px-4 py-4">
                <FormMessage status={poolState.status} message={poolState.message} />
                <input type="hidden" name="assessmentId" value={assessmentId} />
                <input type="hidden" name="offeringId" value={offeringId} />

                <Field label="Name" htmlFor="pool-name">
                  <Input id="pool-name" name="name" required placeholder="Section B: ratios" />
                </Field>

                <Field label="Bank" htmlFor="bankId-pool">
                  <Select id="bankId-pool" name="bankId" required defaultValue={banks[0]?.id ?? ''}>
                    {banks.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.name}
                      </option>
                    ))}
                  </Select>
                </Field>

                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Questions to draw" htmlFor="drawCount">
                    <Input id="drawCount" name="drawCount" type="number" min={1} max={100} defaultValue={5} />
                  </Field>
                  <Field label="Marks each" htmlFor="markPerQuestion">
                    <Input id="markPerQuestion" name="markPerQuestion" type="number" min={0.5} max={100} step="0.5" defaultValue={2} />
                  </Field>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Difficulty" htmlFor="difficulty" hint="Optional">
                    <Select id="difficulty" name="difficulty" defaultValue="">
                      <option value="">Any</option>
                      <option value="EASY">Easy</option>
                      <option value="MODERATE">Moderate</option>
                      <option value="CHALLENGING">Challenging</option>
                    </Select>
                  </Field>
                  <Field label="Topic" htmlFor="topic" hint="Optional">
                    <Input id="topic" name="topic" />
                  </Field>
                </div>

                <Submit label="Add pool" variant="secondary" />
              </form>
            </Panel>
          </>
        )}
      </div>
    </div>
  );
}
