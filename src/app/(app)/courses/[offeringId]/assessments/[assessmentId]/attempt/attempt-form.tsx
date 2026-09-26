'use client';

import { useActionState, useEffect, useMemo, useRef, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { Button, Panel } from '@/components/ui/primitives';
import { FormMessage, Textarea } from '@/components/ui/form';
import { FileUploader } from '@/components/ui/file-uploader';
import type { FormState } from '@/lib/validation/common';
import { attemptField, orderFromPositions, type LearnerQuestion } from '@/server/services/attempt-form';
import { finishAttempt } from '../../actions';

type Answer =
  | { kind: 'choice'; optionId: string }
  | { kind: 'choices'; optionIds: string[] }
  | { kind: 'boolean'; value: boolean }
  | { kind: 'text'; value: string }
  | { kind: 'number'; value: number }
  | { kind: 'pairs'; pairs: { optionId: string; matchKey: string }[] }
  | { kind: 'order'; optionIds: string[] }
  | { kind: 'blanks'; values: Record<string, string> }
  | { kind: 'files'; fileIds: string[] };

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

const selectClass = 'h-9 rounded border border-line bg-surface px-2 text-sm';

function isAnswered(answer: Answer | undefined): boolean {
  if (!answer) return false;
  switch (answer.kind) {
    case 'text':
      return answer.value.trim() !== '';
    case 'number':
      return Number.isFinite(answer.value);
    case 'choices':
    case 'order':
      return answer.optionIds.length > 0;
    case 'pairs':
      return answer.pairs.length > 0;
    case 'files':
      return answer.fileIds.length > 0;
    case 'blanks':
      return Object.values(answer.values).some((value) => value.trim() !== '');
    default:
      return true;
  }
}

/** Positions shown in an ordering question's selects, recovered from a saved order. */
function positionsFrom(answer: Answer | undefined): Record<string, string> {
  if (answer?.kind !== 'order') return {};
  return Object.fromEntries(answer.optionIds.map((optionId, index) => [optionId, String(index + 1)]));
}

/**
 * The paper is fixed server side when the attempt starts, and the questions
 * arrive without anything that scores them. Every answer is an ordinary named
 * form field, so submitting works as a plain HTML form even before (or
 * without) the scripts. With scripts, it also autosaves every fifteen seconds
 * and submits itself when the clock runs out.
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
  questions: LearnerQuestion[];
}) {
  const [state, action] = useActionState<FormState, FormData>(finishAttempt, {});
  const [answers, setAnswers] = useState<Record<string, Answer>>(responses ?? {});
  const [positions, setPositions] = useState<Record<string, Record<string, string>>>(() =>
    Object.fromEntries(Object.entries(responses ?? {}).map(([id, answer]) => [id, positionsFrom(answer)])),
  );
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

  function clear(questionId: string) {
    dirty.current = true;
    setAnswers((current) => {
      const next = { ...current };
      delete next[questionId];
      return next;
    });
  }

  function place(question: LearnerQuestion, optionId: string, position: string) {
    const next = { ...(positions[question.id] ?? {}), [optionId]: position };
    setPositions((current) => ({ ...current, [question.id]: next }));
    update(question.id, {
      kind: 'order',
      optionIds: orderFromPositions(question.options.map((option) => ({ optionId: option.id, position: next[option.id] ?? '' }))),
    });
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
        // did not happen; the form's own fields still carry every answer.
        dirty.current = true;
      }
    }, 15_000);
    return () => clearInterval(timer);
  }, [answers, submissionId]);

  const answeredCount = ordered.filter((item) => isAnswered(answers[item.questionId])).length;

  return (
    <form ref={formRef} action={action} className="space-y-4">
      <FormMessage status={state.status} message={state.message} />
      <input type="hidden" name="submissionId" value={submissionId} />
      <input type="hidden" name="offeringId" value={offeringId} />
      <input type="hidden" name="assessmentId" value={assessmentId} />

      <div className="flex items-center justify-between border border-line bg-surface px-4 py-3 text-sm">
        <span className="text-muted">
          {answeredCount} of {ordered.length} answered
          {savedAt ? ` · saved at ${savedAt}` : ''}
        </span>
        {deadlineIso && (
          <Countdown deadlineIso={deadlineIso} onExpire={() => formRef.current?.requestSubmit()} />
        )}
      </div>

      {ordered.map((item, index) => {
        const question = item.question!;
        const answer = answers[question.id];
        const name = attemptField.answer(question.id);

        return (
          <Panel key={question.id} title={`Question ${index + 1}`} description={`${item.mark} marks`}>
            <div className="space-y-3 px-4 py-4">
              <input type="hidden" name={attemptField.shown} value={question.id} />
              <p className="whitespace-pre-line text-sm">{question.text}</p>

              {(question.type === 'MULTIPLE_CHOICE' || question.type === 'TRUE_FALSE') && (
                <fieldset className="space-y-2">
                  <legend className="sr-only">Choose one answer</legend>
                  {question.options.map((option) => (
                    <label key={option.id} className="flex items-start gap-2 text-sm">
                      <input
                        type="radio"
                        name={name}
                        value={option.id}
                        checked={answer?.kind === 'choice' && answer.optionId === option.id}
                        onChange={() => update(question.id, { kind: 'choice', optionId: option.id })}
                        className="mt-1 accent-[rgb(var(--brand))]"
                      />
                      <span>{option.label}</span>
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
                          name={name}
                          value={option.id}
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
                        <span>{option.label}</span>
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
                    name={name}
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
                    name={name}
                    inputMode="decimal"
                    autoComplete="off"
                    // Uncontrolled, so "3," can be typed on the way to "3,14".
                    defaultValue={answer?.kind === 'number' && Number.isFinite(answer.value) ? String(answer.value) : ''}
                    onChange={(event) => {
                      const raw = event.target.value.trim().replace(/\s/g, '').replace(',', '.');
                      if (raw === '') clear(question.id);
                      else if (Number.isFinite(Number(raw))) update(question.id, { kind: 'number', value: Number(raw) });
                    }}
                    className="h-10 w-40 rounded border border-line bg-surface px-3 text-sm"
                  />
                </>
              )}

              {question.type === 'FILL_BLANK' && (
                <div className="space-y-2">
                  {question.blanks.map((blank) => (
                    <div key={blank} className="flex items-center gap-2">
                      <label htmlFor={`blank-${question.id}-${blank}`} className="w-32 text-sm text-muted">
                        {blank}
                      </label>
                      <input
                        id={`blank-${question.id}-${blank}`}
                        name={attemptField.blank(question.id, blank)}
                        autoComplete="off"
                        value={answer?.kind === 'blanks' ? (answer.values[blank] ?? '') : ''}
                        onChange={(event) =>
                          update(question.id, {
                            kind: 'blanks',
                            values: {
                              ...(answer?.kind === 'blanks' ? answer.values : {}),
                              [blank]: event.target.value,
                            },
                          })
                        }
                        className="h-9 flex-1 rounded border border-line bg-surface px-3 text-sm"
                      />
                    </div>
                  ))}
                </div>
              )}

              {question.type === 'MATCHING' && (
                <div className="space-y-2">
                  <p className="text-xs text-muted">Choose the match for each item.</p>
                  {question.options.map((option) => {
                    const pairs = answer?.kind === 'pairs' ? answer.pairs : [];
                    const current = pairs.find((pair) => pair.optionId === option.id)?.matchKey ?? '';
                    return (
                      <div key={option.id} className="flex flex-wrap items-center gap-2">
                        <label htmlFor={`match-${option.id}`} className="min-w-40 flex-1 text-sm">
                          {option.label}
                        </label>
                        <select
                          id={`match-${option.id}`}
                          name={attemptField.match(question.id, option.id)}
                          value={current}
                          onChange={(event) =>
                            update(question.id, {
                              kind: 'pairs',
                              pairs: [
                                ...pairs.filter((pair) => pair.optionId !== option.id),
                                ...(event.target.value ? [{ optionId: option.id, matchKey: event.target.value }] : []),
                              ],
                            })
                          }
                          className={selectClass}
                        >
                          <option value="">Choose</option>
                          {question.matches.map((match) => (
                            <option key={match} value={match}>{match}</option>
                          ))}
                        </select>
                      </div>
                    );
                  })}
                </div>
              )}

              {question.type === 'ORDERING' && (
                <div className="space-y-2">
                  <p className="text-xs text-muted">
                    Give each item its position, 1 for the first. The order has to be exactly right.
                  </p>
                  {question.options.map((option) => (
                    <div key={option.id} className="flex flex-wrap items-center gap-2">
                      <select
                        id={`order-${option.id}`}
                        name={attemptField.order(question.id, option.id)}
                        value={positions[question.id]?.[option.id] ?? ''}
                        onChange={(event) => place(question, option.id, event.target.value)}
                        className={selectClass}
                        aria-label={`Position of ${option.label}`}
                      >
                        <option value="">Position</option>
                        {question.options.map((_, position) => (
                          <option key={position} value={String(position + 1)}>{position + 1}</option>
                        ))}
                      </select>
                      <span className="text-sm">{option.label}</span>
                    </div>
                  ))}
                </div>
              )}

              {question.type === 'FILE_UPLOAD' && (
                <div className="space-y-2">
                  {answer?.kind === 'files' &&
                    answer.fileIds.map((fileId) => (
                      <input key={fileId} type="hidden" name={attemptField.file(question.id)} value={fileId} />
                    ))}
                  {answer?.kind === 'files' && answer.fileIds.length > 0 && (
                    <p className="text-sm text-muted">
                      {answer.fileIds.length === 1 ? 'One file uploaded.' : `${answer.fileIds.length} files uploaded.`}{' '}
                      Upload another to add it.
                    </p>
                  )}
                  <FileUploader
                    name={attemptField.file(question.id)}
                    folder="submissions"
                    label="Upload your answer"
                    onUploaded={(file) =>
                      update(question.id, {
                        kind: 'files',
                        fileIds: [...(answer?.kind === 'files' ? answer.fileIds : []), file.fileId],
                      })
                    }
                  />
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
