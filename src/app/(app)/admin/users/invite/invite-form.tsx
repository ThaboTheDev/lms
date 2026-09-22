'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Button, Field, Input, Panel } from '@/components/ui/primitives';
import { Checkbox, FormMessage } from '@/components/ui/form';
import type { FormState } from '@/lib/validation/common';
import { invitePerson } from '../actions';

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? 'Sending' : 'Send the invitation'}
    </Button>
  );
}

export function InviteForm({ roles }: { roles: { id: string; name: string; isSystem: boolean }[] }) {
  const [state, action] = useActionState<FormState, FormData>(invitePerson, {});

  return (
    <Panel
      title="Invite somebody"
      description="They get an email with a single-use link and choose their own password. Nothing is sent to them in the clear."
    >
      <form action={action} className="space-y-4 px-4 py-4">
        <FormMessage status={state.status} message={state.message} />

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="First name" htmlFor="firstName" error={state.fieldErrors?.firstName}>
            <Input id="firstName" name="firstName" required maxLength={80} autoComplete="off" />
          </Field>

          <Field label="Last name" htmlFor="lastName" error={state.fieldErrors?.lastName}>
            <Input id="lastName" name="lastName" required maxLength={80} autoComplete="off" />
          </Field>
        </div>

        <Field label="Email address" htmlFor="email" error={state.fieldErrors?.email}>
          <Input id="email" name="email" type="email" required autoComplete="off" />
        </Field>

        <fieldset className="border border-line px-3 py-3">
          <legend className="px-1 text-xs font-medium uppercase tracking-wide text-muted">
            Roles they should hold
          </legend>
          {roles.length === 0 ? (
            <p className="mt-2 text-sm text-muted">There are no roles at this institution yet.</p>
          ) : (
            <div className="mt-2 space-y-1.5">
              {roles.map((role) => (
                <Checkbox
                  key={role.id}
                  id={`role-${role.id}`}
                  name="roleIds"
                  value={role.id}
                  label={role.name}
                />
              ))}
            </div>
          )}
        </fieldset>

        <Submit />
      </form>
    </Panel>
  );
}
