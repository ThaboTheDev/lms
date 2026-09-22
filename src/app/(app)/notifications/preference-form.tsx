'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Tag } from '@/components/ui/primitives';
import type { FormState } from '@/lib/validation/common';
import { updatePreference } from './actions';

function Save() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded border border-line px-3 py-1 text-xs hover:border-ink/40 disabled:opacity-60"
    >
      {pending ? 'Saving' : 'Save'}
    </button>
  );
}

export function PreferenceRow({
  type,
  label,
  mandatory,
  current,
}: {
  type: string;
  label: string;
  mandatory: boolean;
  current: { inApp: boolean; email: boolean; sms: boolean; push: boolean };
}) {
  const [state, action] = useActionState<FormState, FormData>(updatePreference, {});

  return (
    <form action={action} className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <input type="hidden" name="type" value={type} />

      <span className="min-w-[16rem] flex-1 text-sm">
        {label}
        {mandatory && (
          <span className="ml-2">
            <Tag tone="caution">always sent</Tag>
          </span>
        )}
        {state.message && <span className="block text-xs text-muted">{state.message}</span>}
      </span>

      <label className="flex items-center gap-1.5 text-sm">
        <input type="checkbox" name="inApp" defaultChecked={current.inApp} className="accent-[rgb(var(--brand))]" />
        In app
      </label>
      <label className="flex items-center gap-1.5 text-sm">
        <input type="checkbox" name="email" defaultChecked={current.email} className="accent-[rgb(var(--brand))]" />
        Email
      </label>

      <Save />
    </form>
  );
}
