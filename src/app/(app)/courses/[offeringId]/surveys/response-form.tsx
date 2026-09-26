'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Button } from '@/components/ui/primitives';
import { FormMessage, Textarea } from '@/components/ui/form';
import type { FormState } from '@/lib/validation/common';
import { answerSurvey } from './actions';

const RATINGS = [
  [1, 'Strongly disagree'],
  [2, 'Disagree'],
  [3, 'Neutral'],
  [4, 'Agree'],
  [5, 'Strongly agree'],
] as const;

function Submit() {
  const { pending } = useFormStatus();
  return <Button type="submit" disabled={pending}>{pending ? 'Sending' : 'Send my response'}</Button>;
}

/** A plain form: every answer is a named field, so it works with or without scripts. */
export function SurveyResponseForm({
  offeringId,
  surveyId,
  anonymous,
  questions,
}: {
  offeringId: string;
  surveyId: string;
  anonymous: boolean;
  questions: { id: string; prompt: string; type: string; options: string[]; isRequired: boolean }[];
}) {
  const [state, action] = useActionState<FormState, FormData>(answerSurvey, {});
  if (state.status === 'success') return <FormMessage status="success" message={state.message} />;

  return (
    <form action={action} className="space-y-5">
      <FormMessage status={state.status} message={state.message} />
      <input type="hidden" name="surveyId" value={surveyId} />
      <input type="hidden" name="offeringId" value={offeringId} />
      <p className="text-sm text-muted">
        {anonymous
          ? 'This survey is anonymous: your answers are stored without your name, and results show only once five or more people have answered.'
          : 'This survey is not anonymous: your lecturer can see your name next to your answers.'}
      </p>
      {questions.map((question, index) => {
        const name = `q:${question.id}`;
        const error = state.fieldErrors?.[name];
        return (
          <fieldset key={question.id} className="space-y-2 border-t border-line pt-4" aria-describedby={error ? `${name}-error` : undefined}>
            <legend className="text-sm font-medium">
              {index + 1}. {question.prompt}
              {!question.isRequired && <span className="font-normal text-muted"> (optional)</span>}
            </legend>
            {question.type === 'RATING' && (
              <div className="flex flex-wrap gap-3">
                {RATINGS.map(([value, label]) => (
                  <label key={value} className="flex items-center gap-1.5 text-sm">
                    <input type="radio" name={name} value={value} required={question.isRequired} className="accent-[rgb(var(--brand))]" />
                    {label}
                  </label>
                ))}
              </div>
            )}
            {question.type === 'CHOICE' && (
              <div className="space-y-1.5">
                {question.options.map((option) => (
                  <label key={option} className="flex items-center gap-2 text-sm">
                    <input type="radio" name={name} value={option} required={question.isRequired} className="accent-[rgb(var(--brand))]" />
                    {option}
                  </label>
                ))}
              </div>
            )}
            {question.type === 'TEXT' && <Textarea name={name} rows={3} maxLength={2000} required={question.isRequired} aria-label={question.prompt} />}
            {error && (
              <p id={`${name}-error`} className="text-sm text-danger">
                {error}
              </p>
            )}
          </fieldset>
        );
      })}
      <Submit />
    </form>
  );
}
