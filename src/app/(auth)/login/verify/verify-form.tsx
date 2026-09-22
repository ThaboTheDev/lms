'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Button, Field, Input } from '@/components/ui/primitives';
import { FormMessage } from '@/components/ui/form';
import type { FormState } from '@/lib/validation/common';
import { verifyCode } from './actions';

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" className="w-full" disabled={pending}>
      {pending ? 'Checking' : 'Continue'}
    </Button>
  );
}

export function VerifyForm({ next }: { next: string }) {
  const [state, action] = useActionState<FormState, FormData>(verifyCode, {});

  return (
    <form action={action} className="mt-6 space-y-4">
      <FormMessage status={state.status} message={state.message} />
      <input type="hidden" name="next" value={next} />

      <Field label="Code" htmlFor="token">
        <Input
          id="token"
          name="token"
          autoComplete="one-time-code"
          autoFocus
          required
          className="font-serif text-lg tracking-widest"
        />
      </Field>

      <Submit />
    </form>
  );
}
