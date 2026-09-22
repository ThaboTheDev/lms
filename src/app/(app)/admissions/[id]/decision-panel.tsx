'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { Button, Field, Panel } from '@/components/ui/primitives';
import { FormMessage, Select, Textarea } from '@/components/ui/form';
import type { FormState } from '@/lib/validation/common';
import { decideApplication, enrolApplicant } from './actions';

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? 'Working' : label}
    </Button>
  );
}

/**
 * Only the moves the pipeline allows from the current status are offered, so a
 * reviewer cannot put an application into a state the process does not permit.
 */
export function DecisionPanel({
  applicationId,
  status,
  transitions,
  cohorts,
  alreadyEnrolled,
}: {
  applicationId: string;
  status: string;
  transitions: { to: string; label: string; requiresDecision: boolean }[];
  cohorts: { id: string; code: string; name: string }[];
  alreadyEnrolled: boolean;
}) {
  const [state, formAction] = useActionState<FormState, FormData>(decideApplication, {});
  const [enrolState, enrolAction] = useActionState<FormState, FormData>(enrolApplicant, {});
  const [decision, setDecision] = useState(transitions[0]?.to ?? '');

  const selected = transitions.find((transition) => transition.to === decision);

  if (status === 'ACCEPTED' || alreadyEnrolled) {
    return (
      <Panel title="Enrolment" description="The offer has been accepted.">
        <form action={enrolAction} className="space-y-4 px-4 py-4">
          <FormMessage status={enrolState.status} message={enrolState.message} />
          <input type="hidden" name="applicationId" value={applicationId} />
          {cohorts.length > 0 && (
            <Field label="Cohort" htmlFor="cohortId" hint="Optional">
              <Select id="cohortId" name="cohortId" defaultValue="">
                <option value="">No cohort</option>
                {cohorts.map((cohort) => (
                  <option key={cohort.id} value={cohort.id}>
                    {cohort.code} · {cohort.name}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <p className="text-sm text-muted">
            Enrolling creates the learner account, allocates a student number and records the
            programme enrolment. Running it twice is safe.
          </p>
          <Submit label={alreadyEnrolled ? 'Open the student record' : 'Enrol this applicant'} />
        </form>
      </Panel>
    );
  }

  if (transitions.length === 0) {
    return (
      <Panel title="Decision">
        <p className="px-4 py-6 text-sm text-muted">
          This application has reached the end of the pipeline. Nothing further can be recorded
          against it.
        </p>
      </Panel>
    );
  }

  return (
    <Panel title="Decision">
      <form action={formAction} className="space-y-4 px-4 py-4">
        <FormMessage status={state.status} message={state.message} />
        <input type="hidden" name="applicationId" value={applicationId} />

        <Field label="Move this application to" htmlFor="decision">
          <Select
            id="decision"
            name="decision"
            value={decision}
            onChange={(event) => setDecision(event.target.value)}
          >
            {transitions.map((transition) => (
              <option key={transition.to} value={transition.to}>
                {transition.label}
              </option>
            ))}
          </Select>
        </Field>

        <Field
          label="Reason and notes"
          htmlFor="notes"
          hint={selected?.requiresDecision ? 'Required for a decision' : 'Optional'}
          error={state.fieldErrors?.notes}
        >
          <Textarea id="notes" name="notes" required={selected?.requiresDecision} />
        </Field>

        {decision === 'CONDITIONAL_OFFER' && (
          <Field label="Conditions" htmlFor="conditions" hint="What the applicant must still meet">
            <Textarea id="conditions" name="conditions" rows={3} />
          </Field>
        )}

        <Submit label="Record decision" />
      </form>
    </Panel>
  );
}
