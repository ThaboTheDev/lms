'use server';

import { revalidatePath } from 'next/cache';
import { requirePrincipal } from '@/lib/auth/current-user';
import { AppError } from '@/lib/errors';
import type { FormState } from '@/lib/validation/common';
import { createPackage, deletePackage } from '@/server/services/packages';

export async function uploadPackage(_prev: FormState, formData: FormData): Promise<FormState> {
  const principal = await requirePrincipal();
  const offeringId = String(formData.get('offeringId') ?? '');
  const fileId = String(formData.get('fileId') ?? '');
  if (!fileId) return { status: 'error', message: 'Upload the package file first.', fieldErrors: { fileId: 'Choose a file.' } };
  try {
    await createPackage(principal, offeringId, { fileId, title: String(formData.get('title') ?? '') });
  } catch (error) {
    if (error instanceof AppError) return { status: 'error', message: error.message };
    throw error;
  }
  revalidatePath(`/courses/${offeringId}/packages`);
  return { status: 'success', message: 'Uploaded. It is being unpacked; refresh in a moment to see it ready.' };
}

export async function removePackage(_prev: FormState, formData: FormData): Promise<FormState> {
  const principal = await requirePrincipal();
  const offeringId = String(formData.get('offeringId') ?? '');
  try {
    await deletePackage(principal, String(formData.get('packageId') ?? ''));
  } catch (error) {
    if (error instanceof AppError) return { status: 'error', message: error.message };
    throw error;
  }
  revalidatePath(`/courses/${offeringId}/packages`);
  return { status: 'success', message: 'Removed.' };
}
