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

export function MfaSetup({ secret, qr, uri }: { secret: string; qr: string; uri: string }) {
  const [state, action] = useActionState<FormState, FormData>(confirmMfa, {});

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
