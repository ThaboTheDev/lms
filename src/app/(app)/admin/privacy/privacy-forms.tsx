'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { Button, Field, Panel } from '@/components/ui/primitives';
import { FormMessage, Select, Textarea } from '@/components/ui/form';
import type { FormState } from '@/lib/validation/common';
import { checkErasure, performErasure, sweep } from './actions';

function Submit({ label, variant }: { label: string; variant?: 'primary' | 'secondary' | 'danger' }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" variant={variant} disabled={pending}>
      {pending ? 'Working' : label}
    </Button>
  );
}

export function SweepButton({ category }: { category: string }) {
  const [state, action] = useActionState<FormState, FormData>(sweep, {});

  if (state.message) {
    return <span className="text-xs text-muted">{state.message}</span>;
  }

  return (
    <form action={action} className="inline">
      <input type="hidden" name="category" value={category} />
      <button type="submit" className="rounded border border-line px-2 py-0.5 text-xs hover:border-ink/40">
        Sweep
      </button>
    </form>
  );
}

export function ErasureForms({ people }: { people: { id: string; label: string }[] }) {
  const [checkState, check] = useActionState<FormState, FormData>(checkErasure, {});
  const [eraseState, erase] = useActionState<FormState, FormData>(performErasure, {});
  const [userId, setUserId] = useState('');

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Panel title="Check an erasure request" description="What could be done, before anything is done.">
        <form action={check} className="space-y-3 px-4 py-4">
          <FormMessage status={checkState.status} message={checkState.message} />

          <Field label="Person" htmlFor="check-user">
            <Select
              id="check-user"
              name="userId"
              required
              value={userId}
              onChange={(event) => setUserId(event.target.value)}
            >
              <option value="" disabled>Choose a person</option>
              {people.map((person) => (
                <option key={person.id} value={person.id}>{person.label}</option>
              ))}
            </Select>
          </Field>

          <Submit label="Check what is possible" variant="secondary" />
        </form>
      </Panel>

      <Panel title="Carry out the erasure">
        <form action={erase} className="space-y-3 px-4 py-4">
          <FormMessage status={eraseState.status} message={eraseState.message} />
          <input type="hidden" name="userId" value={userId} />

          <p className="text-sm text-muted">
            Where there is an academic record, the record is kept and detached from the person:
            a qualification has to stay verifiable, and erasing it would harm the learner as much as
            the institution. Everything that identifies them beyond that goes.
          </p>

          <Field label="The request this answers" htmlFor="reason" hint="Recorded in the audit log">
            <Textarea id="reason" name="reason" rows={2} required />
          </Field>

          <Submit label="Erase" variant="danger" />
        </form>
      </Panel>
    </div>
  );
}
