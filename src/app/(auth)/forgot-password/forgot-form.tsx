'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Button, Field, Input } from '@/components/ui/primitives';
import { FormMessage } from '@/components/ui/form';
import type { FormState } from '@/lib/validation/common';
import { sendResetLink } from './actions';

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} className="w-full">
      {pending ? 'Sending' : 'Send me a link'}
    </Button>
  );
}

export function ForgotPasswordForm() {
  const [state, action] = useActionState<FormState, FormData>(sendResetLink, {});

  return (
    <form action={action} className="mt-6 space-y-3">
      <FormMessage status={state.status} message={state.message} />

      <Field label="Email address" htmlFor="email" error={state.fieldErrors?.email}>
        <Input id="email" name="email" type="email" required autoComplete="email" />
      </Field>

      <Submit />
    </form>
  );
}
