'use server';

import { revalidatePath } from 'next/cache';
import { requirePrincipal } from '@/lib/auth/current-user';
import { AppError } from '@/lib/errors';
import type { FormState } from '@/lib/validation/common';
import { acknowledgeAtRiskFlag, refreshAtRiskFlags } from '@/server/services/analytics';

export async function followUp(_prev: FormState, formData: FormData): Promise<FormState> {
  const principal = await requirePrincipal();
  try {
    await acknowledgeAtRiskFlag(principal, String(formData.get('flagId') ?? ''));
  } catch (error) {
    if (error instanceof AppError) return { status: 'error', message: error.message };
    throw error;
  }
  revalidatePath('/analytics');
  return { status: 'success', message: 'Marked as followed up.' };
}

export async function evaluateNow(): Promise<FormState> {
  const principal = await requirePrincipal();
  let written = 0;
  try {
    ({ written } = await refreshAtRiskFlags(principal));
  } catch (error) {
    if (error instanceof AppError) return { status: 'error', message: error.message };
    throw error;
  }
  revalidatePath('/analytics');
  return { status: 'success', message: `${written} learners on the list.` };
}
