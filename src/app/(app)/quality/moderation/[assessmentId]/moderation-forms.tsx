'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { Button, Field, Input, Panel } from '@/components/ui/primitives';
import { FormMessage, Select, Textarea } from '@/components/ui/form';
import type { FormState } from '@/lib/validation/common';
import { adjustMarks, submitModeration } from '../../actions';

function Submit({ label, variant }: { label: string; variant?: 'primary' | 'secondary' | 'danger' }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" variant={variant} disabled={pending}>
      {pending ? 'Recording' : label}
    </Button>
  );
}

export function ModerationForm({
  assessmentId,
  maxMark,
  sample,
}: {
  assessmentId: string;
  maxMark: number;
  sample: { submissionId: string; studentNumber: string; assessorMark: number }[];
}) {
  const [state, action] = useActionState<FormState, FormData>(submitModeration, {});
  const [marks, setMarks] = useState<Record<string, string>>({});

  // Mirrors the server comparison so the moderator sees the picture before
  // recording it. The server recomputes it; this is only the preview.
  const entered = sample
    .map((entry) => ({ ...entry, moderatorMark: Number(marks[entry.submissionId]) }))
    .filter((entry) => Number.isFinite(entry.moderatorMark) && marks[entry.submissionId] !== '');

  const differences = entered.map((entry) => entry.moderatorMark - entry.assessorMark);
  const mean =
    differences.length > 0
      ? Math.round((differences.reduce((total, value) => total + value, 0) / differences.length) * 100) / 100
      : 0;

  return (
    <Panel title="Record moderation" description="Enter your own mark where you re-marked a script.">
      <form action={action} className="space-y-4 px-4 py-4">
        <FormMessage status={state.status} message={state.message} />
        <input type="hidden" name="assessmentId" value={assessmentId} />

        <Field label="Kind of moderation" htmlFor="type">
          <Select id="type" name="type" defaultValue="INTERNAL">
            <option value="INTERNAL">Internal</option>
            <option value="EXTERNAL">External</option>
            <option value="PRE_ASSESSMENT">Before the assessment was set</option>
            <option value="POST_ASSESSMENT">After results</option>
          </Select>
        </Field>

        {sample.length > 0 && (
          <div className="space-y-2">
            <p className="text-sm font-medium">Your marks</p>
            <ul className="divide-y divide-line border border-line">
              {sample.map((entry) => (
                <li key={entry.submissionId} className="flex items-center justify-between gap-3 px-3 py-2">
                  <span className="text-sm tabular-nums">
                    {entry.studentNumber}
                    <span className="ml-2 text-muted">assessor gave {entry.assessorMark}</span>
                  </span>
                  <span className="flex items-center gap-2">
                    <label htmlFor={`sample-${entry.submissionId}`} className="sr-only">
                      Your mark for {entry.studentNumber}
                    </label>
                    <Input
                      id={`sample-${entry.submissionId}`}
                      name={`sample[${entry.submissionId}]`}
                      type="number"
                      min={0}
                      max={maxMark}
                      step="0.5"
                      value={marks[entry.submissionId] ?? ''}
                      onChange={(event) =>
                        setMarks((current) => ({ ...current, [entry.submissionId]: event.target.value }))
                      }
                      className="h-9 w-24"
                    />
                  </span>
                </li>
              ))}
            </ul>

            {entered.length > 0 && (
              <p className="text-sm text-muted">
                {entered.length} compared, average difference {mean > 0 ? '+' : ''}
                {mean} marks.
                {Math.abs(mean) > 2.5 && differences.every((value) => value > 0) &&
                  ' You are marking higher across the board, which points at the standard rather than at individual scripts.'}
                {Math.abs(mean) > 2.5 && differences.every((value) => value < 0) &&
                  ' You are marking lower across the board, which points at the standard rather than at individual scripts.'}
              </p>
            )}
          </div>
        )}

        <Field label="Outcome" htmlFor="outcome" hint="Leave blank to use what the comparison suggests">
          <Select id="outcome" name="outcome" defaultValue="">
            <option value="">Use the suggestion</option>
            <option value="APPROVED">Approved</option>
            <option value="APPROVED_WITH_CHANGES">Approved with changes</option>
            <option value="REFERRED_BACK">Referred back</option>
            <option value="REJECTED">Rejected</option>
          </Select>
        </Field>

        <Field label="Comments" htmlFor="comments">
          <Textarea id="comments" name="comments" rows={3} />
        </Field>

        <Submit label="Record moderation" />
      </form>
    </Panel>
  );
}

export function AdjustmentForm({
  assessmentId,
  hasExternalModeration,
  cohortSize,
}: {
  assessmentId: string;
  hasExternalModeration: boolean;
  cohortSize: number;
}) {
  const [state, action] = useActionState<FormState, FormData>(adjustMarks, {});

  return (
    <Panel title="Adjust the cohort" description={`${cohortSize} marks would be affected.`}>
      <form action={action} className="space-y-3 px-4 py-4">
        <FormMessage status={state.status} message={state.message} />
        <input type="hidden" name="assessmentId" value={assessmentId} />

        <p className="text-sm text-muted">
          Moving a whole cohort is a decision about the assessment, not about the learners. Every
          mark that changes is written to the audit log with its before and after.
          {!hasExternalModeration && ' A large adjustment needs an external moderation record first.'}
        </p>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="How" htmlFor="kind">
            <Select id="kind" name="kind" defaultValue="SHIFT">
              <option value="SHIFT">Add marks to every script</option>
              <option value="SCALE">Scale every mark by a percentage</option>
            </Select>
          </Field>
          <Field label="By" htmlFor="value" hint="Negative to reduce">
            <Input id="value" name="value" type="number" step="0.5" required />
          </Field>
        </div>

        <Field label="Reason" htmlFor="reason" hint="Recorded against every affected script">
          <Textarea id="reason" name="reason" rows={2} required />
        </Field>

        <Submit label="Apply adjustment" variant="danger" />
      </form>
    </Panel>
  );
}
