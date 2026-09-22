'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Button, Field, Panel } from '@/components/ui/primitives';
import { FormMessage, Textarea } from '@/components/ui/form';
import type { FormState } from '@/lib/validation/common';
import { revokeCredential } from '../../records/actions';

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="danger" size="sm" disabled={pending}>
      {pending ? 'Revoking' : 'Revoke this certificate'}
    </Button>
  );
}

export function RevokeForm({ certificateId }: { certificateId: string }) {
  const [state, action] = useActionState<FormState, FormData>(revokeCredential, {});

  return (
    <Panel title="Revoke">
      <form action={action} className="space-y-3 px-4 py-4">
        <FormMessage status={state.status} message={state.message} />
        <input type="hidden" name="certificateId" value={certificateId} />

        <p className="max-w-prose text-sm text-muted">
          Nothing is deleted. The record stays and the verification page starts answering that the
          certificate was withdrawn, because a document already in circulation has to be answerable.
        </p>

        <Field label="Reason" htmlFor="reason" hint="Shown to staff, not to whoever checks the code">
          <Textarea id="reason" name="reason" rows={2} required />
        </Field>

        <Submit />
      </form>
    </Panel>
  );
}
