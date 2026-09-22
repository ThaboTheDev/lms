'use server';

import { revalidatePath } from 'next/cache';
import { requirePrincipal } from '@/lib/auth/current-user';
import { AppError } from '@/lib/errors';
import { createRole, setRolePermissions, deleteRole } from '@/server/services/roles';
import { isPermissionKey } from '@/lib/rbac/permissions';
import type { FormState } from '@/lib/validation/common';

function refresh() {
  revalidatePath('/admin/roles');
  revalidatePath('/admin/users');
}

function fail(error: unknown): FormState {
  if (error instanceof AppError) return { status: 'error', message: error.message };
  throw error;
}

export async function createRoleAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const principal = await requirePrincipal();

  const name = String(formData.get('name') ?? '').trim();
  const key = String(formData.get('key') ?? '').trim();
  const description = String(formData.get('description') ?? '').trim();
  const permissions = formData.getAll('permissions').map(String).filter(isPermissionKey);

  if (!name || !key) {
    return { status: 'error', message: 'A role needs a name and a key.' };
  }

  try {
    await createRole(principal, { name, key, description: description || null, permissionKeys: permissions });
    refresh();
    return { status: 'success', message: `${name} created. Grant it to somebody to put it to work.` };
  } catch (error) {
    return fail(error);
  }
}

export async function saveRolePermissionsAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const principal = await requirePrincipal();

  const roleId = String(formData.get('roleId') ?? '');
  const permissions = formData.getAll('permissions').map(String).filter(isPermissionKey);

  if (!roleId) return { status: 'error', message: 'That role no longer exists.' };

  try {
    await setRolePermissions(principal, roleId, permissions);
    refresh();
    return { status: 'success', message: 'Permissions saved. They apply from the next request.' };
  } catch (error) {
    return fail(error);
  }
}

export async function deleteRoleAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const principal = await requirePrincipal();

  const roleId = String(formData.get('roleId') ?? '');
  if (!roleId) return { status: 'error', message: 'That role no longer exists.' };

  try {
    await deleteRole(principal, roleId);
    refresh();
    return { status: 'success', message: 'Role deleted.' };
  } catch (error) {
    return fail(error);
  }
}
