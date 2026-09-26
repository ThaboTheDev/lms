'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Button, Field, Input, Panel } from '@/components/ui/primitives';
import { FormMessage } from '@/components/ui/form';
import type { FormState } from '@/lib/validation/common';
import { confirmMfa } from './actions';

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? 'Checking' : 'Turn it on'}
    </Button>
  );
}

/**
 * Rendered at the same place whether or not two step sign in is on, so the
 * recovery codes returned when it is turned on stay on screen: the page
 * re-renders into its "on" state straight away, and a component that
 * disappeared with it took the only copy of the codes with it.
 */
export function MfaSetup({ secret, qr, uri, enabled = false }: { secret: string | null; qr: string | null; uri: string | null; enabled?: boolean }) {
  const [state, action] = useActionState<FormState, FormData>(confirmMfa, {});

  if (state.status === 'success' && state.message) {
    return (
      <Panel title="Save your recovery codes" description="They are shown once. Each one gets you in once if you lose your phone.">
        <div className="px-4 py-4">
          <FormMessage status={state.status} message={state.message} />
        </div>
      </Panel>
    );
  }
  if (enabled || !secret || !qr) return null;

  return (
    <Panel
      title="Turn on two step sign in"
      description="A password alone is one stolen note away from somebody else's account."
    >
      <form action={action} className="space-y-4 px-4 py-4">
        <FormMessage status={state.status} message={state.message} />
        <input type="hidden" name="secret" value={secret} />

        <ol className="list-decimal space-y-2 pl-5 text-sm">
          <li>Open an authenticator app on your phone.</li>
          <li>Scan this code, or type the key underneath it.</li>
          <li>Enter the six digit code the app shows.</li>
        </ol>

        <div className="flex flex-wrap items-center gap-6">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={qr} alt={`Set up code for ${uri}`} width={160} height={160} />
          <p className="font-mono text-sm tracking-wide text-muted">{secret}</p>
        </div>

        <Field label="Code from your app" htmlFor="token">
          <Input
            id="token"
            name="token"
            inputMode="numeric"
            autoComplete="one-time-code"
            required
            className="w-40 font-serif text-lg tracking-widest"
          />
        </Field>

        <Submit />
      </form>
    </Panel>
  );
}
