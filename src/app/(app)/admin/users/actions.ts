'use server';

import { revalidatePath } from 'next/cache';
import { requirePrincipal } from '@/lib/auth/current-user';
import { AppError } from '@/lib/errors';
import { emailSchema } from '@/lib/validation/common';
import { grantRole, inviteUser, revokeRole, setPersonStatus, resendInvitation } from '@/server/services/user-admin';
import type { FormState } from '@/lib/validation/common';

function refresh(userId?: string) {
  revalidatePath('/admin/users');
  if (userId) revalidatePath(`/admin/users/${userId}`);
}

function fail(error: unknown): FormState {
  if (error instanceof AppError) return { status: 'error', message: error.message };
  throw error;
}

export async function invitePerson(_prev: FormState, formData: FormData): Promise<FormState> {
  const principal = await requirePrincipal();

  const firstName = String(formData.get('firstName') ?? '').trim();
  const lastName = String(formData.get('lastName') ?? '').trim();
  const email = String(formData.get('email') ?? '').trim();
  const roleIds = formData.getAll('roleIds').map(String);

  const parsed = emailSchema.safeParse(email);
  if (!parsed.success) {
    return {
      status: 'error',
      message: 'Enter a valid email address.',
      fieldErrors: { email: 'That does not look like an email address.' },
    };
  }
  if (firstName.length < 2 || lastName.length < 2) {
    return { status: 'error', message: 'Enter their first and last name.' };
  }

  try {
    const user = await inviteUser(principal, {
      firstName,
      lastName,
      email: parsed.data,
      roleIds,
    });

    refresh();
    return {
      status: 'success',
      message: `Invitation sent to ${user.email}. They choose their own password from the link.`,
    };
  } catch (error) {
    return fail(error);
  }
}

export async function grantRoleAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const principal = await requirePrincipal();

  const userId = String(formData.get('userId') ?? '');
  const roleId = String(formData.get('roleId') ?? '');
  const where = String(formData.get('scope') ?? 'INSTITUTION');
  const [scopeType, scopeId] = where === 'INSTITUTION' ? ['INSTITUTION', null] : where.split(':');
  const expires = String(formData.get('expiresAt') ?? '');

  if (!userId || !roleId) return { status: 'error', message: 'Choose a role to grant.' };

  try {
    await grantRole(principal, userId, roleId, {
      scopeType: scopeType as 'INSTITUTION' | 'PROGRAMME' | 'COURSE',
      scopeId,
      expiresAt: expires ? new Date(`${expires}T23:59:59`) : null,
    });
    refresh(userId);
    return { status: 'success', message: 'Role granted.' };
  } catch (error) {
    return fail(error);
  }
}

export async function revokeRoleAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const principal = await requirePrincipal();

  const userId = String(formData.get('userId') ?? '');
  const roleId = String(formData.get('roleId') ?? '');

  if (!userId || !roleId) return { status: 'error', message: 'That grant no longer exists.' };

  try {
    await revokeRole(principal, userId, roleId);
    refresh(userId);
    return { status: 'success', message: 'Role revoked. It stops applying at their next request.' };
  } catch (error) {
    return fail(error);
  }
}

export async function setStatusAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const principal = await requirePrincipal();

  const userId = String(formData.get('userId') ?? '');
  const status = String(formData.get('status') ?? '');

  if (!userId || (status !== 'ACTIVE' && status !== 'SUSPENDED')) {
    return { status: 'error', message: 'That is not a status this account can be put into.' };
  }

  try {
    await setPersonStatus(principal, userId, status);
    refresh(userId);
    return {
      status: 'success',
      message: status === 'SUSPENDED' ? 'Account suspended. Their records are untouched.' : 'Account reactivated.',
    };
  } catch (error) {
    return fail(error);
  }
}

export async function resendInvitationAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const principal = await requirePrincipal();
  try {
    await resendInvitation(principal, String(formData.get('userId') ?? ''));
    return { status: 'success', message: 'A new invitation is on its way.' };
  } catch (error) {
    return fail(error);
  }
}
