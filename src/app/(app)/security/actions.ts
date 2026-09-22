'use server';

import { revalidatePath } from 'next/cache';
import { requirePrincipal } from '@/lib/auth/current-user';
import { prisma } from '@/lib/db';
import { AppError } from '@/lib/errors';
import { disableMfa, enableMfa } from '@/lib/auth/mfa';
import { revokeAllSessions } from '@/lib/auth/session';
import { recordAudit } from '@/lib/audit';
import type { FormState } from '@/lib/validation/common';

export async function confirmMfa(_prev: FormState, formData: FormData): Promise<FormState> {
  const principal = await requirePrincipal();
  const secret = String(formData.get('secret') ?? '');
  const token = String(formData.get('token') ?? '');

  try {
    const codes = await enableMfa(principal.userId, secret, token);
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
  await recordAudit(principal, {
    action: 'security.sessions_revoked',
    entityType: 'User',
    entityId: principal.userId,
  });
  revalidatePath('/security');
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
