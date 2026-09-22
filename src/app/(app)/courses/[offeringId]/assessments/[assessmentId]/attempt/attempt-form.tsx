'use client';

import { useActionState, useEffect, useMemo, useRef, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { Button, Panel } from '@/components/ui/primitives';
import { FormMessage, Textarea } from '@/components/ui/form';
import type { FormState } from '@/lib/validation/common';
import { finishAttempt } from '../../actions';

type Answer =
  | { kind: 'choice'; optionId: string }
  | { kind: 'choices'; optionIds: string[] }
  | { kind: 'boolean'; value: boolean }
  | { kind: 'text'; value: string }
  | { kind: 'number'; value: number }
  | { kind: 'order'; optionIds: string[] }
  | { kind: 'blanks'; values: Record<string, string> };

interface Question {
  id: string;
  type: string;
  text: string;
  options: { id: string; content: string; matchKey: string | null }[];
}

function Countdown({ deadlineIso, onExpire }: { deadlineIso: string; onExpire: () => void }) {
  const [remaining, setRemaining] = useState(() =>
    Math.max(0, Math.round((new Date(deadlineIso).getTime() - Date.now()) / 1000)),
  );

  useEffect(() => {
    const timer = setInterval(() => {
      const next = Math.max(0, Math.round((new Date(deadlineIso).getTime() - Date.now()) / 1000));
      setRemaining(next);
      if (next === 0) onExpire();
    }, 1000);
    return () => clearInterval(timer);
  }, [deadlineIso, onExpire]);

  const minutes = Math.floor(remaining / 60);
  const seconds = remaining % 60;
  const urgent = remaining < 300;

  return (
    <p
      role="timer"
      aria-live={urgent ? 'assertive' : 'off'}
      className={`tabular-nums ${urgent ? 'text-danger' : 'text-muted'}`}
    >
      {minutes}:{String(seconds).padStart(2, '0')} left
    </p>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? 'Submitting' : 'Submit this attempt'}
    </Button>
  );
}

/**
 * The paper is fixed server side when the attempt starts, so this component
 * only collects answers. It autosaves every fifteen seconds and on every
 * change after a pause, and submits itself when the clock runs out, so a
 * learner who loses their connection does not lose their work.
 */
export function AttemptForm({
  submissionId,
  offeringId,
  assessmentId,
  deadlineIso,
  paper,
  responses,
  questions,
}: {
  submissionId: string;
  offeringId: string;
  assessmentId: string;
  deadlineIso: string | null;
  paper: { questionId: string; mark: number }[];
  responses: Record<string, Answer>;
  questions: Question[];
}) {
  const [state, action] = useActionState<FormState, FormData>(finishAttempt, {});
  const [answers, setAnswers] = useState<Record<string, Answer>>(responses ?? {});
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const dirty = useRef(false);

  const ordered = useMemo(
    () =>
      paper
        .map((item) => ({ ...item, question: questions.find((q) => q.id === item.questionId) }))
        .filter((item) => item.question),
    [paper, questions],
  );

  function update(questionId: string, answer: Answer) {
    dirty.current = true;
    setAnswers((current) => ({ ...current, [questionId]: answer }));
  }

  useEffect(() => {
    const timer = setInterval(async () => {
      if (!dirty.current) return;
      dirty.current = false;

      const saved = await fetch(`/api/v1/attempts/${submissionId}/autosave`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ responses: answers }),
      }).catch(() => null);

      if (saved?.ok) {
        setSavedAt(new Date().toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' }));
      } else {
        // Put the work back in the queue rather than reporting a save that
        // did not happen; the hidden field still carries every answer.
        dirty.current = true;
      }
    }, 15_000);
    return () => clearInterval(timer);
  }, [answers, submissionId]);

  return (
    <form ref={formRef} action={action} className="space-y-4">
      <FormMessage status={state.status} message={state.message} />
      <input type="hidden" name="submissionId" value={submissionId} />
      <input type="hidden" name="offeringId" value={offeringId} />
      <input type="hidden" name="assessmentId" value={assessmentId} />
      <input type="hidden" name="responses" value={JSON.stringify(answers)} />

      <div className="flex items-center justify-between border border-line bg-surface px-4 py-3 text-sm">
        <span className="text-muted">
          {Object.keys(answers).length} of {ordered.length} answered
          {savedAt ? ` · saved at ${savedAt}` : ''}
        </span>
        {deadlineIso && (
          <Countdown deadlineIso={deadlineIso} onExpire={() => formRef.current?.requestSubmit()} />
        )}
      </div>

      {ordered.map((item, index) => {
        const question = item.question!;
        const answer = answers[question.id];

        return (
          <Panel key={question.id} title={`Question ${index + 1}`} description={`${item.mark} marks`}>
            <div className="space-y-3 px-4 py-4">
              <p className="text-sm">{question.text}</p>

              {(question.type === 'MULTIPLE_CHOICE' || question.type === 'TRUE_FALSE') && (
                <fieldset className="space-y-2">
                  <legend className="sr-only">Choose one answer</legend>
                  {question.options.map((option) => (
                    <label key={option.id} className="flex items-start gap-2 text-sm">
                      <input
                        type="radio"
                        name={`q-${question.id}`}
                        checked={answer?.kind === 'choice' && answer.optionId === option.id}
                        onChange={() => update(question.id, { kind: 'choice', optionId: option.id })}
                        className="mt-1 accent-[rgb(var(--brand))]"
                      />
                      <span>{option.content}</span>
                    </label>
                  ))}
                </fieldset>
              )}

              {question.type === 'MULTIPLE_RESPONSE' && (
                <fieldset className="space-y-2">
                  <legend className="text-xs text-muted">
                    Choose all that apply. A wrong choice cancels out a right one.
                  </legend>
                  {question.options.map((option) => {
                    const chosen = answer?.kind === 'choices' ? answer.optionIds : [];
                    return (
                      <label key={option.id} className="flex items-start gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={chosen.includes(option.id)}
                          onChange={(event) =>
                            update(question.id, {
                              kind: 'choices',
                              optionIds: event.target.checked
                                ? [...chosen, option.id]
                                : chosen.filter((id) => id !== option.id),
                            })
                          }
                          className="mt-1 accent-[rgb(var(--brand))]"
                        />
                        <span>{option.content}</span>
                      </label>
                    );
                  })}
                </fieldset>
              )}

              {(question.type === 'SHORT_ANSWER' || question.type === 'LONG_ANSWER' || question.type === 'ESSAY') && (
                <>
                  <label htmlFor={`answer-${question.id}`} className="sr-only">
                    Your answer
                  </label>
                  <Textarea
                    id={`answer-${question.id}`}
                    rows={question.type === 'SHORT_ANSWER' ? 2 : 8}
                    value={answer?.kind === 'text' ? answer.value : ''}
                    onChange={(event) => update(question.id, { kind: 'text', value: event.target.value })}
                  />
                </>
              )}

              {question.type === 'NUMERICAL' && (
                <>
                  <label htmlFor={`answer-${question.id}`} className="sr-only">
                    Your answer
                  </label>
                  <input
                    id={`answer-${question.id}`}
                    type="number"
                    step="any"
                    value={answer?.kind === 'number' ? answer.value : ''}
                    onChange={(event) => update(question.id, { kind: 'number', value: Number(event.target.value) })}
                    className="h-10 w-40 rounded border border-line bg-surface px-3 text-sm"
                  />
                </>
              )}

              {question.type === 'FILL_BLANK' && (
                <div className="space-y-2">
                  {question.options.map((option) => (
                    <div key={option.id} className="flex items-center gap-2">
                      <label htmlFor={`blank-${option.id}`} className="w-32 text-sm text-muted">
                        {option.matchKey}
                      </label>
                      <input
                        id={`blank-${option.id}`}
                        value={answer?.kind === 'blanks' ? (answer.values[option.matchKey ?? ''] ?? '') : ''}
                        onChange={(event) =>
                          update(question.id, {
                            kind: 'blanks',
                            values: {
                              ...(answer?.kind === 'blanks' ? answer.values : {}),
                              [option.matchKey ?? '']: event.target.value,
                            },
                          })
                        }
                        className="h-9 flex-1 rounded border border-line bg-surface px-3 text-sm"
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>
          </Panel>
        );
      })}

      <div className="flex items-center justify-between border-t border-line pt-4">
        <p className="text-sm text-muted">
          Once you submit you cannot change your answers.
        </p>
        <SubmitButton />
      </div>
    </form>
  );
}
