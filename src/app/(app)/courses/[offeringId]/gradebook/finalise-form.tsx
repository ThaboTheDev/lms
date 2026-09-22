'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Button, Panel } from '@/components/ui/primitives';
import { FormMessage } from '@/components/ui/form';
import type { FormState } from '@/lib/validation/common';
import { finaliseResults } from '../assessments/actions';

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? 'Recording' : 'Record course results'}
    </Button>
  );
}

export function FinaliseForm({ offeringId }: { offeringId: string }) {
  const [state, action] = useActionState<FormState, FormData>(finaliseResults, {});

  return (
    <Panel title="Finalise the course">
      <form action={action} className="space-y-3 px-4 py-4">
        <FormMessage status={state.status} message={state.message} />
        <input type="hidden" name="offeringId" value={offeringId} />
        <p className="max-w-prose text-sm text-muted">
          This writes each learner&apos;s course mark and result onto their enrolment, which is what the
          transcript and progression read. Learners with work still outstanding are left alone rather
          than being failed on marks that were never entered.
        </p>
        <Submit />
      </form>
    </Panel>
  );
}
