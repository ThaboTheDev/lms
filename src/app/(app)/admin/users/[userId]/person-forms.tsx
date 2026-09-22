'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Button, Field, Panel } from '@/components/ui/primitives';
import { FormMessage, Select } from '@/components/ui/form';
import type { FormState } from '@/lib/validation/common';
import { grantRoleAction, revokeRoleAction, setStatusAction } from '../actions';

function Submit({ label, busy, variant }: { label: string; busy: string; variant?: 'primary' | 'secondary' }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant={variant} size="sm" disabled={pending}>
      {pending ? busy : label}
    </Button>
  );
}

export function GrantRoleForm({
  userId,
  available,
}: {
  userId: string;
  available: { id: string; name: string }[];
}) {
  const [state, action] = useActionState<FormState, FormData>(grantRoleAction, {});

  if (available.length === 0) return null;

  return (
    <div className="border-t border-line px-4 py-4">
      <form action={action} className="flex flex-wrap items-end gap-3">
        <input type="hidden" name="userId" value={userId} />

        <div className="min-w-56">
          <Field label="Grant a role" htmlFor="roleId">
            <Select id="roleId" name="roleId" defaultValue={available[0]?.id ?? ''}>
              {available.map((role) => (
                <option key={role.id} value={role.id}>
                  {role.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <Submit label="Grant" busy="Granting" />
      </form>

      <FormMessage status={state.status} message={state.message} />
    </div>
  );
}

export function RevokeRoleForm({
  userId,
  roleId,
  roleName,
}: {
  userId: string;
  roleId: string;
  roleName: string;
}) {
  const [state, action] = useActionState<FormState, FormData>(revokeRoleAction, {});

  return (
    <form action={action} className="inline">
      <input type="hidden" name="userId" value={userId} />
      <input type="hidden" name="roleId" value={roleId} />
      <button
        type="submit"
        className="text-xs text-muted underline underline-offset-2 hover:text-danger"
        aria-label={`Remove the ${roleName} role`}
        title={state.message ?? undefined}
      >
        remove
      </button>
    </form>
  );
}

export function StatusForm({ userId, status }: { userId: string; status: string }) {
  const [state, action] = useActionState<FormState, FormData>(setStatusAction, {});
  const suspended = status === 'SUSPENDED';

  return (
    <Panel
      title="Access"
      description={
        suspended
          ? 'A suspended account keeps its records and loses its access. Nothing is deleted.'
          : 'Suspending stops this person signing in without touching anything they have done.'
      }
    >
      <form action={action} className="flex flex-wrap items-center gap-3 px-4 py-4">
        <FormMessage status={state.status} message={state.message} />
        <input type="hidden" name="userId" value={userId} />
        <input type="hidden" name="status" value={suspended ? 'ACTIVE' : 'SUSPENDED'} />

        <Submit
          label={suspended ? 'Reactivate the account' : 'Suspend the account'}
          busy="Working"
          variant={suspended ? 'primary' : 'secondary'}
        />
      </form>
    </Panel>
  );
}
