'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Button, Field, Input, Panel } from '@/components/ui/primitives';
import { Checkbox, FormMessage } from '@/components/ui/form';
import { PERMISSIONS, PERMISSION_KEYS, type PermissionKey } from '@/lib/rbac/permissions';
import type { FormState } from '@/lib/validation/common';
import { createRoleAction, saveRolePermissionsAction, deleteRoleAction } from './actions';

/**
 * The permission matrix. Grouped the way the catalogue groups them, so a role
 * reads as "what this person does with students" rather than as fifty keys.
 */
const GROUPS: [string, PermissionKey[]][] = (() => {
  const groups = new Map<string, PermissionKey[]>();
  for (const key of PERMISSION_KEYS) {
    const group = PERMISSIONS[key].group;
    const existing = groups.get(group);
    if (existing) existing.push(key);
    else groups.set(group, [key]);
  }
  return [...groups.entries()];
})();

function Submit({ label, busy }: { label: string; busy: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? busy : label}
    </Button>
  );
}

function Matrix({
  idPrefix,
  selected,
}: {
  idPrefix: string;
  selected?: readonly string[];
}) {
  const chosen = selected ? new Set(selected) : null;

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {GROUPS.map(([group, keys]) => (
        <fieldset key={group} className="border border-line px-3 py-3">
          <legend className="px-1 text-xs font-medium uppercase tracking-wide text-muted">{group}</legend>
          <div className="mt-2 space-y-1.5">
            {keys.map((key) => (
              <Checkbox
                key={key}
                id={`${idPrefix}-${key}`}
                name="permissions"
                value={key}
                defaultChecked={chosen ? chosen.has(key) : false}
                label={
                  <span>
                    <span className="font-mono text-xs text-muted">{key}</span>
                    <br />
                    {PERMISSIONS[key].description}
                  </span>
                }
              />
            ))}
          </div>
        </fieldset>
      ))}
    </div>
  );
}

export function CreateRoleForm() {
  const [state, action] = useActionState<FormState, FormData>(createRoleAction, {});

  return (
    <Panel
      title="Create a role"
      description="A role is a named bundle of permissions. Compose one for a job this institution actually has."
    >
      <form action={action} className="space-y-4 px-4 py-4">
        <FormMessage status={state.status} message={state.message} />

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Name" htmlFor="name" error={state.fieldErrors?.name}>
            <Input id="name" name="name" required maxLength={80} />
          </Field>

          <Field label="Key" htmlFor="key" hint="Capitals and underscores, e.g. EXAM_OFFICER">
            <Input id="key" name="key" required maxLength={40} placeholder="EXAM_OFFICER" />
          </Field>
        </div>

        <Field label="What it is for" htmlFor="description">
          <Input id="description" name="description" maxLength={200} />
        </Field>

        <Matrix idPrefix="new" />

        <Submit label="Create the role" busy="Creating" />
      </form>
    </Panel>
  );
}

/** System roles are shown read-only: the permission sync owns them. */
export function RolePermissionsForm({
  role,
}: {
  role: { id: string; name: string; permissionKeys: string[]; memberCount: number };
}) {
  const [state, action] = useActionState<FormState, FormData>(saveRolePermissionsAction, {});
  const [removeState, removeAction] = useActionState<FormState, FormData>(deleteRoleAction, {});

  return (
    <div className="border-t border-line px-4 py-4">
      <details>
        <summary className="cursor-pointer text-sm text-accent underline-offset-2 hover:underline">
          Edit the {role.permissionKeys.length} permissions in {role.name}
        </summary>

        <form action={action} className="mt-4 space-y-4">
          <FormMessage status={state.status} message={state.message} />
          <input type="hidden" name="roleId" value={role.id} />

          <Matrix idPrefix={role.id} selected={role.permissionKeys} />

          <Submit label="Save permissions" busy="Saving" />
        </form>
      </details>

      <form action={removeAction} className="mt-4">
        <FormMessage status={removeState.status} message={removeState.message} />
        <input type="hidden" name="roleId" value={role.id} />
        <Button
          type="submit"
          variant="secondary"
          size="sm"
          disabled={role.memberCount > 0}
          title={role.memberCount > 0 ? 'Remove this role from everybody first' : undefined}
        >
          Delete role
        </Button>
        {role.memberCount > 0 && (
          <p className="mt-1 text-xs text-muted">
            {role.memberCount} {role.memberCount === 1 ? 'person holds' : 'people hold'} this role.
          </p>
        )}
      </form>
    </div>
  );
}
