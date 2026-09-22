'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Button, Field, Input } from '@/components/ui/primitives';
import { FormMessage } from '@/components/ui/form';
import type { FormState } from '@/lib/validation/common';
import { choosePassword } from './actions';

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} className="w-full">
      {pending ? 'Saving' : 'Set my password'}
    </Button>
  );
}

export function ResetPasswordForm({ token }: { token: string }) {
  const [state, action] = useActionState<FormState, FormData>(choosePassword, {});

  return (
    <form action={action} className="mt-6 space-y-3">
      <FormMessage status={state.status} message={state.message} />
      <input type="hidden" name="token" value={token} />

      <Field
        label="New password"
        htmlFor="password"
        hint="At least twelve characters. A short phrase of a few words is fine."
        error={state.fieldErrors?.password}
      >
        <Input
          id="password"
          name="password"
          type="password"
          required
          autoComplete="new-password"
          aria-describedby="password-hint"
        />
      </Field>

      <Field label="Type it again" htmlFor="confirmation" error={state.fieldErrors?.confirmation}>
        <Input id="confirmation" name="confirmation" type="password" required autoComplete="new-password" />
      </Field>

      <Submit />
    </form>
  );
}
