'use server';

import { revalidatePath } from 'next/cache';
import { requirePrincipal } from '@/lib/auth/current-user';
import { AppError } from '@/lib/errors';
import { assessErasureRequest, eraseSubject, runRetentionSweep } from '@/server/services/privacy';
import type { FormState } from '@/lib/validation/common';

function fail(error: unknown): FormState {
  if (error instanceof AppError) return { status: 'error', message: error.message };
  throw error;
}

export async function checkErasure(_prev: FormState, formData: FormData): Promise<FormState> {
  const principal = await requirePrincipal();
  const userId = String(formData.get('userId') ?? '');

  if (!userId) return { status: 'error', message: 'Choose a person.' };

  try {
    const assessment = await assessErasureRequest(principal, userId);
    return {
      status: assessment.canErase ? 'success' : 'error',
      message: `${assessment.explanation}${
        assessment.canErase ? ` Kept: ${assessment.keep.join('; ')}. Removed: ${assessment.remove.join('; ')}.` : ''
      }`,
    };
  } catch (error) {
    return fail(error);
  }
}

export async function performErasure(_prev: FormState, formData: FormData): Promise<FormState> {
  const principal = await requirePrincipal();
  const userId = String(formData.get('userId') ?? '');
  const reason = String(formData.get('reason') ?? '');

  try {
    const result = await eraseSubject(principal, userId, reason);
    revalidatePath('/admin/privacy');
    return {
      status: 'success',
      message: `Done, by ${result.approach.toLowerCase()}. ${result.explanation}`,
    };
  } catch (error) {
    return fail(error);
  }
}

export async function sweep(_prev: FormState, formData: FormData): Promise<FormState> {
  const principal = await requirePrincipal();
  const category = String(formData.get('category') ?? '');

  try {
    const result = await runRetentionSweep(principal, category);
    revalidatePath('/admin/privacy');
    return {
      status: 'success',
      message: `${result.removed} records removed, everything older than ${result.before.toLocaleDateString('en-ZA', { dateStyle: 'long' })}.`,
    };
  } catch (error) {
    return fail(error);
  }
}
