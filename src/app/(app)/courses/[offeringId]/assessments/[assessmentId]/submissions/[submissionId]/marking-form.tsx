'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { Button, Field, Input, Panel } from '@/components/ui/primitives';
import { Checkbox, FormMessage, Textarea } from '@/components/ui/form';
import type { FormState } from '@/lib/validation/common';
import { recordGrade } from '../../../actions';

interface Criterion {
  id: string;
  title: string;
  description: string | null;
  weight: number;
  maxScore: number;
  levels: { id: string; label: string; descriptor: string | null; score: number }[];
  current: number | null;
}

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? 'Recording' : 'Record mark'}
    </Button>
  );
}

export function MarkingForm({
  submissionId,
  offeringId,
  maxMark,
  autoMark,
  currentMark,
  currentFeedback,
  isLate,
  latePenaltyPct,
  rubric,
}: {
  submissionId: string;
  offeringId: string;
  maxMark: number;
  autoMark: number | null;
  currentMark: number | null;
  currentFeedback: string | null;
  isLate: boolean;
  latePenaltyPct: number | null;
  rubric: { title: string; criteria: Criterion[] } | null;
}) {
  const [state, action] = useActionState<FormState, FormData>(recordGrade, {});
  const [scores, setScores] = useState<Record<string, number>>(
    Object.fromEntries(
      (rubric?.criteria ?? [])
        .filter((criterion) => criterion.current !== null)
        .map((criterion) => [criterion.id, criterion.current!]),
    ),
  );

  // Mirrors the server calculation so the assessor sees the mark the rubric
  // will produce before they save it.
  const rubricPercent = rubric
    ? (() => {
        const weightTotal = rubric.criteria.reduce((sum, criterion) => sum + criterion.weight, 0) || 1;
        const weighted = rubric.criteria.reduce((sum, criterion) => {
          const score = scores[criterion.id];
          if (score === undefined || criterion.maxScore === 0) return sum;
          return sum + (Math.min(score, criterion.maxScore) / criterion.maxScore) * criterion.weight;
        }, 0);
        return Math.round((weighted / weightTotal) * 10000) / 100;
      })()
    : null;

  const rubricMark = rubricPercent !== null ? Math.round((rubricPercent / 100) * maxMark * 100) / 100 : null;

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="submissionId" value={submissionId} />
      <input type="hidden" name="offeringId" value={offeringId} />

      {rubric && (
        <Panel title={rubric.title} description="The rubric decides the mark.">
          <div className="divide-y divide-line">
            {rubric.criteria.map((criterion) => (
              <fieldset key={criterion.id} className="px-4 py-3">
                <legend className="text-sm font-medium">
                  {criterion.title}{' '}
                  <span className="font-normal text-muted">
                    (weight {criterion.weight}, out of {criterion.maxScore})
                  </span>
                </legend>
                {criterion.description && (
                  <p className="mt-0.5 text-xs text-muted">{criterion.description}</p>
                )}

                {criterion.levels.length > 0 ? (
                  <div className="mt-2 space-y-1.5">
                    {criterion.levels.map((level) => (
                      <label key={level.id} className="flex items-start gap-2 text-sm">
                        <input
                          type="radio"
                          name={`level-${criterion.id}`}
                          checked={scores[criterion.id] === level.score}
                          onChange={() =>
                            setScores((current) => ({ ...current, [criterion.id]: level.score }))
                          }
                          className="mt-1 accent-[rgb(var(--brand))]"
                        />
                        <span>
                          {level.label} <span className="tabular-nums text-muted">({level.score})</span>
                          {level.descriptor && (
                            <span className="block text-xs text-muted">{level.descriptor}</span>
                          )}
                        </span>
                      </label>
                    ))}
                  </div>
                ) : (
                  <Input
                    type="number"
                    min={0}
                    max={criterion.maxScore}
                    step="0.5"
                    value={scores[criterion.id] ?? ''}
                    onChange={(event) =>
                      setScores((current) => ({ ...current, [criterion.id]: Number(event.target.value) }))
                    }
                    className="mt-2 w-32"
                  />
                )}

                <input type="hidden" name={`rubric[${criterion.id}]`} value={scores[criterion.id] ?? ''} />
              </fieldset>
            ))}
          </div>

          {rubricMark !== null && (
            <p className="border-t border-line px-4 py-3 text-sm">
              Rubric total: <span className="font-serif text-lg tabular-nums">{rubricMark}</span> of {maxMark}{' '}
              <span className="text-muted">({rubricPercent}%)</span>
            </p>
          )}
        </Panel>
      )}

      <Panel title="Mark and feedback">
        <div className="space-y-3 px-4 py-4">
          <FormMessage status={state.status} message={state.message} />

          {autoMark !== null && (
            <p className="text-sm text-muted">
              Machine marked so far: <span className="tabular-nums text-ink">{autoMark}</span>
            </p>
          )}

          {!rubric && (
            <Field
              label="Mark"
              htmlFor="manualMark"
              hint={`Out of ${maxMark}`}
              error={state.fieldErrors?.manualMark}
            >
              <Input
                id="manualMark"
                name="manualMark"
                type="number"
                min={0}
                max={maxMark}
                step="0.5"
                defaultValue={currentMark ?? autoMark ?? ''}
              />
            </Field>
          )}

          {isLate && latePenaltyPct ? (
            <p className="border-l-2 border-caution bg-caution/5 px-3 py-2 text-sm text-caution">
              This was submitted late. A penalty of {latePenaltyPct}% a day is applied to whatever you
              record here, calculated from the submission time.
            </p>
          ) : null}

          <Field label="Feedback for the learner" htmlFor="feedback">
            <Textarea id="feedback" name="feedback" rows={6} defaultValue={currentFeedback ?? ''} />
          </Field>

          <Checkbox
            id="requestResubmission"
            name="requestResubmission"
            label="Ask the learner to resubmit instead of finalising this mark"
          />

          <p className="text-sm text-muted">
            The learner sees nothing until results are released for the whole assessment.
          </p>

          <Submit />
        </div>
      </Panel>
    </form>
  );
}
