'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Button, Field, Input } from '@/components/ui/primitives';
import { signIn, type LoginState } from './actions';

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" className="w-full" disabled={pending}>
      {pending ? 'Signing in' : 'Sign in'}
    </Button>
  );
}

export function LoginForm({ redirectTo }: { redirectTo?: string }) {
  const [state, formAction] = useActionState<LoginState, FormData>(signIn, {});

  return (
    <form action={formAction} className="mt-6 space-y-4">
      {state.error && (
        <p role="alert" className="border-l-2 border-danger bg-danger/5 px-3 py-2 text-sm text-danger">
          {state.error}
        </p>
      )}

      <input type="hidden" name="redirectTo" value={redirectTo ?? ''} />

      <Field label="Email address" htmlFor="email" error={state.fieldErrors?.email}>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          required
          aria-invalid={Boolean(state.fieldErrors?.email)}
          aria-describedby={state.fieldErrors?.email ? 'email-error' : undefined}
        />
      </Field>

      <Field label="Password" htmlFor="password" error={state.fieldErrors?.password}>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          aria-invalid={Boolean(state.fieldErrors?.password)}
          aria-describedby={state.fieldErrors?.password ? 'password-error' : undefined}
        />
      </Field>

      <SubmitButton />

      <Link href="/forgot-password" className="block text-sm text-accent underline underline-offset-2">
        Forgot your password?
      </Link>
    </form>
  );
}
