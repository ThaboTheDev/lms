'use server';

import { revalidatePath } from 'next/cache';
import { requirePrincipal } from '@/lib/auth/current-user';
import { AppError } from '@/lib/errors';
import type { FormState } from '@/lib/validation/common';
import { updateStudentContact } from '@/server/services/students';
import { resendInvitation } from '@/server/services/user-admin';

const CONTACT_FIELDS = ['addressLine1', 'addressLine2', 'city', 'province', 'postalCode', 'homeLanguage', 'emergencyName', 'emergencyPhone', 'emergencyRelation'];

function failure(error: unknown): FormState {
  if (error instanceof AppError) return { status: 'error', message: error.message };
  throw error;
}

export async function saveStudentContact(_prev: FormState, formData: FormData): Promise<FormState> {
  const principal = await requirePrincipal();
  const studentId = String(formData.get('studentId') ?? '');
  const data = Object.fromEntries(CONTACT_FIELDS.map((field) => [field, String(formData.get(field) ?? '').trim() || null]));
  try {
    await updateStudentContact(principal, studentId, data);
  } catch (error) {
    return failure(error);
  }
  revalidatePath(`/students/${studentId}`);
  return { status: 'success', message: 'Contact details saved.' };
}

export async function resendStudentInvitation(_prev: FormState, formData: FormData): Promise<FormState> {
  const principal = await requirePrincipal();
  try {
    await resendInvitation(principal, String(formData.get('userId') ?? ''));
  } catch (error) {
    return failure(error);
  }
  return { status: 'success', message: 'A new invitation is on its way.' };
}
