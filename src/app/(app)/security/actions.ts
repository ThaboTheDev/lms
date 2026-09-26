'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requirePrincipal } from '@/lib/auth/current-user';
import { prisma } from '@/lib/db';
import { AppError } from '@/lib/errors';
import { disableMfa, enableMfa } from '@/lib/auth/mfa';
import { destroyCurrentSession, markSessionVerified, revokeAllSessions } from '@/lib/auth/session';
import { recordAudit } from '@/lib/audit';
import type { FormState } from '@/lib/validation/common';
import { changeOwnPassword, updateOwnProfile } from '@/server/services/account';

export async function confirmMfa(_prev: FormState, formData: FormData): Promise<FormState> {
  const principal = await requirePrincipal();
  const secret = String(formData.get('secret') ?? '');
  const token = String(formData.get('token') ?? '');

  try {
    const codes = await enableMfa(principal.userId, secret, token);
    // They have just proved they hold the authenticator, so this session counts
    // as verified. Without this the next render treated them as signed out,
    // bounced them to /login and lost the recovery codes shown below.
    await markSessionVerified();
    await recordAudit(principal, {
      action: 'security.mfa_enabled',
      entityType: 'User',
      entityId: principal.userId,
    });
    revalidatePath('/security');

    return {
      status: 'success',
      message: `Two step sign in is on. Save these recovery codes somewhere safe, they are shown once: ${codes.join('  ')}`,
    };
  } catch (error) {
    if (error instanceof AppError) return { status: 'error', message: error.message };
    throw error;
  }
}

export async function turnOffMfa(): Promise<void> {
  const principal = await requirePrincipal();
  await disableMfa(principal.userId);
  await recordAudit(principal, {
    action: 'security.mfa_disabled',
    entityType: 'User',
    entityId: principal.userId,
  });
  revalidatePath('/security');
}

export async function signOutEverywhere(): Promise<void> {
  const principal = await requirePrincipal();
  await revokeAllSessions(principal.userId);
  try {
    await recordAudit(principal, {
      action: 'security.sessions_revoked',
      entityType: 'User',
      entityId: principal.userId,
    });
  } catch (error) {
    // An audit write must not leave the person signed in. The sessions are
    // already revoked; finish the sign-out either way.
    console.error('[auth] session revoke audit failed', error);
  }
  await destroyCurrentSession();
  redirect('/login');
}

export async function downloadMyData(): Promise<void> {
  const principal = await requirePrincipal();
  await prisma.auditLog.create({
    data: {
      institutionId: principal.institutionId,
      actorId: principal.userId,
      actorEmail: principal.email,
      action: 'privacy.export_requested',
      entityType: 'User',
      entityId: principal.userId,
    },
  });
  revalidatePath('/security');
}

function accountFailure(error: unknown): FormState {
  if (error instanceof AppError) {
    const details = error.details && typeof error.details === 'object' ? (error.details as Record<string, string>) : undefined;
    return { status: 'error', message: error.message, fieldErrors: details };
  }
  throw error;
}

export async function changePassword(_prev: FormState, formData: FormData): Promise<FormState> {
  const principal = await requirePrincipal();
  try {
    await changeOwnPassword(
      principal,
      String(formData.get('currentPassword') ?? ''),
      String(formData.get('newPassword') ?? ''),
      String(formData.get('confirmPassword') ?? ''),
    );
  } catch (error) {
    return accountFailure(error);
  }
  revalidatePath('/security');
  return { status: 'success', message: 'Password changed. Every other session has been signed out.' };
}

export async function saveProfile(_prev: FormState, formData: FormData): Promise<FormState> {
  const principal = await requirePrincipal();
  try {
    await updateOwnProfile(principal, { preferredName: String(formData.get('preferredName') ?? ''), phone: String(formData.get('phone') ?? '') });
  } catch (error) {
    return accountFailure(error);
  }
  revalidatePath('/security');
  return { status: 'success', message: 'Saved.' };
}
